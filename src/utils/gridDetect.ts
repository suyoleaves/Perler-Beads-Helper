/**
 * Grid detection via **color-change frequency analysis** with background exclusion.
 *
 * Strategy:
 * 1. Sample image corners to estimate the background colour.
 * 2. Find the bounding box of non-background content (exclude plain border/backdrop).
 * 3. Within that bounding box, build 1-D color-change histograms.
 * 4. Find the dominant period (cell size) via exhaustive period search.
 * 5. Determine if the image already has visible grid lines.
 * 6. Return offsets adjusted to absolute image coordinates.
 */

export interface GridDetection {
  cols: number
  rows: number
  cellW: number
  cellH: number
  offsetX: number
  offsetY: number
  confidence: number
  hasGridLines: boolean
}

const CHANGE_THRESHOLD = 25

function colorDist(data: Uint8ClampedArray, i1: number, i2: number): number {
  const dr = data[i1] - data[i2]
  const dg = data[i1 + 1] - data[i2 + 1]
  const db = data[i1 + 2] - data[i2 + 2]
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

// ── Background / content-bounds detection ─────────────────────────────────────

/** Average the 4 corner pixels to estimate the background colour. */
function sampleBackgroundColor(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): [number, number, number] {
  const corners = [
    0,
    (width - 1) * 4,
    (height - 1) * width * 4,
    ((height - 1) * width + width - 1) * 4,
  ]
  let r = 0, g = 0, b = 0
  for (const i of corners) { r += data[i]; g += data[i + 1]; b += data[i + 2] }
  return [r >> 2, g >> 2, b >> 2]
}

/**
 * Find the tightest bounding box of pixels that differ from the background.
 * Scans at `step`-pixel intervals for speed; expands the result by `step`
 * to avoid clipping edge content.
 */
function findContentBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  bg: [number, number, number],
  threshold = 35,
): { x1: number; y1: number; x2: number; y2: number } | null {
  const [bgR, bgG, bgB] = bg
  const thr2 = threshold * threshold
  let x1 = width, y1 = height, x2 = -1, y2 = -1
  const step = 4

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4
      const dr = data[i] - bgR, dg = data[i + 1] - bgG, db = data[i + 2] - bgB
      if (dr * dr + dg * dg + db * db > thr2) {
        if (x < x1) x1 = x
        if (x > x2) x2 = x
        if (y < y1) y1 = y
        if (y > y2) y2 = y
      }
    }
  }

  if (x2 < x1 || y2 < y1) return null

  return {
    x1: Math.max(0, x1 - step),
    y1: Math.max(0, y1 - step),
    x2: Math.min(width - 1, x2 + step),
    y2: Math.min(height - 1, y2 + step),
  }
}

// ── Histogram builder (ROI-aware) ──────────────────────────────────────────────

/**
 * Build a histogram of color-change frequency at each position along an axis.
 * roiX/Y restrict the scan to a sub-region; the returned histogram is
 * ROI-relative (index 0 = roiX or roiY).
 */
function buildChangeHistogram(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  axis: 'x' | 'y',
  roiX = 0,
  roiY = 0,
  roiW = width - roiX,
  roiH = height - roiY,
): Float64Array {
  const len = axis === 'x' ? roiW : roiH
  const hist = new Float64Array(len)

  if (axis === 'x') {
    const sampleRows = Math.min(roiH, 300)
    const step = Math.max(1, Math.floor(roiH / sampleRows))
    for (let dy = 0; dy < roiH; dy += step) {
      const row = (roiY + dy) * width
      for (let dx = 1; dx < roiW; dx++) {
        const x = roiX + dx
        if (colorDist(data, (row + x - 1) * 4, (row + x) * 4) > CHANGE_THRESHOLD) {
          hist[dx]++
        }
      }
    }
  } else {
    const sampleCols = Math.min(roiW, 300)
    const step = Math.max(1, Math.floor(roiW / sampleCols))
    for (let dx = 0; dx < roiW; dx += step) {
      const x = roiX + dx
      for (let dy = 1; dy < roiH; dy++) {
        const y = roiY + dy
        if (colorDist(data, ((y - 1) * width + x) * 4, (y * width + x) * 4) > CHANGE_THRESHOLD) {
          hist[dy]++
        }
      }
    }
  }

  return hist
}

// ── Period search ──────────────────────────────────────────────────────────────

/**
 * Search for the dominant period in a histogram.
 *
 * Scoring: `hitCount - count/2`  (excess hits above the 50 % random baseline).
 *
 * For each candidate period P we count how many of its aligned positions
 * land on a histogram bin that is **above the global mean** (a "hit").
 * A purely random period gets ~50 % hits (score ≈ 0).
 * The true grid period consistently lands on cell-boundary bins that are
 * above average, earning a large positive score even when some cells share
 * the same colour and produce no transition.
 *
 * This is immune to a handful of extreme spikes (image borders, label rows)
 * that would inflate a `sum/count` or `sum/√count` scorer.
 */
function findBestPeriod(
  hist: Float64Array,
  minP: number,
  maxP: number,
): { period: number; offset: number; score: number } {
  const n = hist.length

  // Pre-compute global mean so we can threshold each bin.
  let total = 0
  for (let i = 1; i < n; i++) total += hist[i]       // skip always-zero index 0
  const globalMean = total / (n - 1)

  let bestPeriod = minP
  let bestOffset = 0
  let bestScore = -Infinity

  for (let p = minP; p <= maxP; p++) {
    for (let off = 0; off < p; off++) {
      let hitCount = 0
      let count = 0
      // Start from max(1, off) — hist[0] is always 0 (no left neighbour).
      for (let i = Math.max(1, off); i < n; i += p) {
        if (hist[i] > globalMean) hitCount++
        count++
      }
      // Require at least 3 aligned cells to form a valid grid direction.
      if (count < 3) continue
      // Excess hits above the 50 % random expectation.
      const score = hitCount - count * 0.5
      if (score > bestScore) {
        bestScore = score
        bestPeriod = p
        bestOffset = off
      }
    }
  }

  return { period: bestPeriod, offset: bestOffset, score: bestScore }
}

/** Check if the image has visible grid lines by peak/valley ratio in the histogram. */
function checkGridLines(hist: Float64Array, period: number, offset: number): boolean {
  if (period < 4) return false
  const n = hist.length
  let peakSum = 0, peakN = 0, valleySum = 0, valleyN = 0

  for (let i = 0; i < n; i++) {
    const relPos = ((i - offset) % period + period) % period
    const nearEdge = relPos <= 1 || relPos >= period - 1
    if (nearEdge) { peakSum += hist[i]; peakN++ }
    else { valleySum += hist[i]; valleyN++ }
  }

  const peakAvg = peakN > 0 ? peakSum / peakN : 0
  const valleyAvg = valleyN > 0 ? valleySum / valleyN : 0
  return peakAvg > valleyAvg * 2.0
}

// ── Main entry ────────────────────────────────────────────────────────────────

/**
 * Detect the grid cell size and offset from a canvas context.
 *
 * Key improvement: background colour is sampled from the image corners, and
 * the period search is restricted to the non-background content bounding box.
 * This prevents a large uniform background from producing a spurious 2×2 result.
 */
export function detectGrid(ctx: CanvasRenderingContext2D): GridDetection | null {
  const { width, height } = ctx.canvas
  if (width < 8 || height < 8) return null

  const data = ctx.getImageData(0, 0, width, height).data

  // ── Step 1: find the non-background content region ──────────────────────
  const bg = sampleBackgroundColor(data, width, height)
  const bounds = findContentBounds(data, width, height, bg)

  const rx = bounds?.x1 ?? 0
  const ry = bounds?.y1 ?? 0
  const rw = bounds ? bounds.x2 - bounds.x1 + 1 : width
  const rh = bounds ? bounds.y2 - bounds.y1 + 1 : height

  if (rw < 8 || rh < 8) return null

  // ── Step 2: build histograms within the content region ───────────────────
  const histX = buildChangeHistogram(data, width, height, 'x', rx, ry, rw, rh)
  const histY = buildChangeHistogram(data, width, height, 'y', rx, ry, rw, rh)

  // Limit search range to the content region dimensions
  const minP = Math.max(3, Math.floor(Math.min(rw, rh) / 200))
  const maxP = Math.floor(Math.min(rw, rh) / 2)

  const xRes = findBestPeriod(histX, minP, maxP)
  const yRes = findBestPeriod(histY, minP, maxP)

  const cellW = xRes.period
  const cellH = yRes.period
  if (cellW < 2 || cellH < 2) return null

  const cols = Math.round((rw - xRes.offset) / cellW)
  const rows = Math.round((rh - yRes.offset) / cellH)
  if (cols < 2 || rows < 2) return null

  // Confidence: average excess hit-rate, normalised to [0, 1].
  // Max possible score per axis = count/2 (every position is a hit).
  // We use the aligned sample count as denominator proxy.
  const xCount = Math.max(1, Math.round((rw - xRes.offset) / xRes.period))
  const yCount = Math.max(1, Math.round((rh - yRes.offset) / yRes.period))
  const xConf = Math.min(1, Math.max(0, xRes.score / (xCount * 0.5)))
  const yConf = Math.min(1, Math.max(0, yRes.score / (yCount * 0.5)))
  const confidence = (xConf + yConf) / 2

  const hasGridLines = checkGridLines(histX, cellW, xRes.offset)
    || checkGridLines(histY, cellH, yRes.offset)

  return {
    cols,
    rows,
    cellW,
    cellH,
    // Offsets are absolute image coordinates (content-region offset + detected phase)
    offsetX: rx + xRes.offset,
    offsetY: ry + yRes.offset,
    confidence,
    hasGridLines,
  }
}
