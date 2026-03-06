/**
 * Channel A: Extract pixel-level pattern data from an image using a calibrated grid.
 *
 * For each grid cell, samples the center pixel's RGB and matches it to the
 * nearest MARD bead color via CIEDE2000.  No OCR, no worker, no preprocessing
 * — just direct pixel color extraction for clean pixel-art or simple images.
 */

import { MARD_PALETTE, type BeadColor } from '../data/mardPalette'
import { rgbToLab, deltaE00, type Lab } from './colorScience'
import type { CellInfo } from './enhancedRenderer'

// ── Pre-computed Lab values for the MARD palette ────────────────────────────

interface PaletteEntry { bead: BeadColor; lab: Lab }

const PALETTE_LAB: PaletteEntry[] = MARD_PALETTE.map(b => ({
  bead: b,
  lab: rgbToLab(b.r, b.g, b.b),
}))

/** Find the MARD bead whose colour is perceptually closest to the given RGB. */
function findNearestBead(r: number, g: number, b: number): BeadColor {
  const lab = rgbToLab(r, g, b)
  let best = PALETTE_LAB[0]
  let bestDist = Infinity
  for (const entry of PALETTE_LAB) {
    const d = deltaE00(lab, entry.lab)
    if (d < bestDist) {
      bestDist = d
      best = entry
    }
  }
  return best.bead
}

// ── Main extraction ─────────────────────────────────────────────────────────

/**
 * Extract a full bead-pattern grid from an image by sampling each cell's
 * center pixel and matching to the MARD palette.
 *
 * @returns A 2-D array `[row][col]` of CellInfo, ready for the renderer.
 */
export function extractPixelPattern(
  imageSource: CanvasImageSource,
  imageW: number,
  imageH: number,
  offsetX: number,
  offsetY: number,
  cellW: number,
  cellH: number,
  cols: number,
  rows: number,
): CellInfo[][] {
  // Render image into an offscreen canvas to access pixel data
  const canvas = document.createElement('canvas')
  canvas.width = imageW
  canvas.height = imageH
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(imageSource, 0, 0, imageW, imageH)
  const { data } = ctx.getImageData(0, 0, imageW, imageH)

  const grid: CellInfo[][] = Array.from({ length: rows }, () => new Array(cols))

  const t0 = performance.now()

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Center of this cell in image-pixel coordinates
      const cx = Math.min(Math.round(offsetX + c * cellW + cellW / 2), imageW - 1)
      const cy = Math.min(Math.round(offsetY + r * cellH + cellH / 2), imageH - 1)
      const idx = (cy * imageW + cx) * 4

      const pr = data[idx]
      const pg = data[idx + 1]
      const pb = data[idx + 2]

      const bead = findNearestBead(pr, pg, pb)
      grid[r][c] = { col: c, row: r, beadId: bead.id, bead }
    }
  }

  const elapsed = performance.now() - t0
  console.log(
    `[extractPixelPattern] ${cols}×${rows} = ${cols * rows} cells, ` +
    `matched in ${elapsed.toFixed(0)}ms`,
  )

  return grid
}
