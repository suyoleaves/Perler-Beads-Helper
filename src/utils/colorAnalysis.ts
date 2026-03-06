import { rgbToLab, deltaE00, type Lab } from './colorScience'
import { MARD_PALETTE, type BeadColor } from '../data/mardPalette'
import { rgbToHex } from './pixel'

export interface MatchedColor {
  bead: BeadColor
  deltaE: number
}

export interface ColorFrequency {
  bead: BeadColor
  count: number
  percentage: number
  avgDeltaE: number
}

export interface AnalysisResult {
  frequencies: ColorFrequency[]
  totalPixels: number
  uniqueColors: number
  elapsed: number
}

// Pre-compute Lab values for the entire palette once at module load
const PALETTE_LAB: { bead: BeadColor; lab: Lab }[] = MARD_PALETTE.map((b) => ({
  bead: b,
  lab: rgbToLab(b.r, b.g, b.b),
}))

/**
 * Find the closest MARD bead color for a given RGB value using CIEDE2000.
 */
export function findClosestBead(r: number, g: number, b: number): MatchedColor {
  const lab = rgbToLab(r, g, b)
  let bestDist = Infinity
  let bestBead = PALETTE_LAB[0]

  for (const entry of PALETTE_LAB) {
    const d = deltaE00(lab, entry.lab)
    if (d < bestDist) {
      bestDist = d
      bestBead = entry
    }
  }

  return { bead: bestBead.bead, deltaE: bestDist }
}

/**
 * Sampling modes for quality adaptation.
 *
 * - "every":  sample every pixel (slow but precise)
 * - "center": sample center of each NxN block (fast, noise-resistant)
 *
 * `blockSize` controls the NxN grid.  Larger = faster + more noise-tolerant.
 */
export interface SamplingOptions {
  mode: 'every' | 'center'
  blockSize: number
}

export const SAMPLING_PRESETS: { label: string; desc: string; options: SamplingOptions }[] = [
  { label: '\u9ad8\u7cbe\u5ea6',   desc: '\u6bcf\u4e2a\u50cf\u7d20\u90fd\u91c7\u6837\uff0c\u9002\u5408\u5c0f\u56fe\u6216\u9ad8\u8d28\u91cf\u56fe\u7eb8', options: { mode: 'every',  blockSize: 1 } },
  { label: '\u6807\u51c6',     desc: '2\u00d72 \u8272\u5757\u4e2d\u5fc3\u53d6\u6837\uff0c\u5e73\u8861\u901f\u5ea6\u4e0e\u7cbe\u5ea6',     options: { mode: 'center', blockSize: 2 } },
  { label: '\u5feb\u901f',     desc: '4\u00d74 \u8272\u5757\u4e2d\u5fc3\u53d6\u6837\uff0c\u9002\u5408\u5927\u56fe',         options: { mode: 'center', blockSize: 4 } },
  { label: '\u6297\u566a\u70b9',   desc: '8\u00d78 \u8272\u5757\u4e2d\u5fc3\u53d6\u6837\uff0c\u4f4e\u8d28\u91cf\u56fe\u7eb8\u6700\u4f73',     options: { mode: 'center', blockSize: 8 } },
]

/**
 * Analyze all pixels on a canvas and produce a frequency table of matched bead colors.
 *
 * Uses a hex-keyed cache so identical source colors only run CIEDE2000 once.
 * Runs synchronously — for very large images, consider wrapping in a Web Worker.
 */
export function analyzeCanvas(
  ctx: CanvasRenderingContext2D,
  options: SamplingOptions = { mode: 'center', blockSize: 2 },
): AnalysisResult {
  const t0 = performance.now()
  const { width, height } = ctx.canvas
  const imageData = ctx.getImageData(0, 0, width, height)
  const data = imageData.data

  const cache = new Map<string, BeadColor>()
  const countMap = new Map<string, { bead: BeadColor; count: number; totalDeltaE: number }>()
  let totalSampled = 0

  const bs = options.blockSize
  const half = Math.floor(bs / 2)

  for (let by = 0; by < height; by += bs) {
    for (let bx = 0; bx < width; bx += bs) {
      let sx: number, sy: number
      if (options.mode === 'center') {
        sx = Math.min(bx + half, width - 1)
        sy = Math.min(by + half, height - 1)
      } else {
        sx = bx
        sy = by
      }

      if (options.mode === 'every') {
        const endY = Math.min(by + bs, height)
        const endX = Math.min(bx + bs, width)
        for (let py = by; py < endY; py++) {
          for (let px = bx; px < endX; px++) {
            const idx = (py * width + px) * 4
            const a = data[idx + 3]
            if (a < 128) continue

            const r = data[idx]
            const g = data[idx + 1]
            const b = data[idx + 2]
            const hex = rgbToHex(r, g, b)

            let bead: BeadColor
            let deltaE: number
            const cached = cache.get(hex)
            if (cached) {
              bead = cached
              deltaE = 0
            } else {
              const match = findClosestBead(r, g, b)
              bead = match.bead
              deltaE = match.deltaE
              cache.set(hex, bead)
            }

            const existing = countMap.get(bead.id)
            if (existing) {
              existing.count++
              existing.totalDeltaE += deltaE
            } else {
              countMap.set(bead.id, { bead, count: 1, totalDeltaE: deltaE })
            }
            totalSampled++
          }
        }
      } else {
        const idx = (sy * width + sx) * 4
        const a = data[idx + 3]
        if (a < 128) continue

        const r = data[idx]
        const g = data[idx + 1]
        const b = data[idx + 2]
        const hex = rgbToHex(r, g, b)

        let bead: BeadColor
        let deltaE: number
        const cached = cache.get(hex)
        if (cached) {
          bead = cached
          deltaE = 0
        } else {
          const match = findClosestBead(r, g, b)
          bead = match.bead
          deltaE = match.deltaE
          cache.set(hex, bead)
        }

        const existing = countMap.get(bead.id)
        if (existing) {
          existing.count++
          existing.totalDeltaE += deltaE
        } else {
          countMap.set(bead.id, { bead, count: 1, totalDeltaE: deltaE })
        }
        totalSampled++
      }
    }
  }

  const frequencies: ColorFrequency[] = Array.from(countMap.values())
    .map(({ bead, count, totalDeltaE }) => ({
      bead,
      count,
      percentage: totalSampled > 0 ? (count / totalSampled) * 100 : 0,
      avgDeltaE: count > 0 ? totalDeltaE / count : 0,
    }))
    .sort((a, b) => b.count - a.count)

  return {
    frequencies,
    totalPixels: totalSampled,
    uniqueColors: cache.size,
    elapsed: performance.now() - t0,
  }
}
