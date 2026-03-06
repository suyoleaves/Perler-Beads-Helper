/**
 * Enhanced canvas renderer — 3 independent pure render functions.
 *
 * Each function draws onto a dedicated canvas layer (L2 grid, L3 labels,
 * L4 highlight). They are called independently so only the changed layer
 * is redrawn, enabling 60fps highlight toggling on mobile.
 *
 * buildCellMap has moved to src/workers/cvWorker.ts.
 */

import { luminance } from './pixel'
import type { GridSettings } from '../components/GridControl'
import type { BeadColor } from '../data/mardPalette'

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface CellInfo {
  col: number
  row: number
  beadId: string
  bead: BeadColor
}

// ─── Grid geometry helper ─────────────────────────────────────────────────────

function cellGeometry(grid: GridSettings, endX: number, endY: number) {
  const startX = grid.offsetX + grid.offsetXFine
  const startY = grid.offsetY + grid.offsetYFine
  const cellW = grid.cellW != null ? grid.cellW : (endX - startX) / grid.cols
  const cellH = grid.cellH != null ? grid.cellH : (endY - startY) / grid.rows
  return { startX, startY, cellW, cellH }
}

// ─── L2: Grid layer ───────────────────────────────────────────────────────────

/**
 * Draw the virtual grid lines onto a dedicated canvas.
 * The canvas should already be sized to the image's CSS dimensions (HiDPI
 * scaling is handled by the caller via setupHiDpiCanvas).
 */
export function renderGridLayer(
  ctx: CanvasRenderingContext2D,
  grid: GridSettings,
  cssW: number,
  cssH: number,
  imgEndX: number,
  imgEndY: number,
): void {
  ctx.clearRect(0, 0, cssW, cssH)
  if (!grid.show) return

  const { startX, startY, cellW, cellH } = cellGeometry(grid, imgEndX, imgEndY)
  const { cols, rows, color, opacity } = grid

  ctx.strokeStyle = color + opacity + ')'
  ctx.lineWidth = Math.max(0.5, Math.min(1.5, cellW * 0.04))

  ctx.beginPath()
  for (let c = 0; c <= cols; c++) {
    const x = Math.round(startX + c * cellW) + 0.5
    ctx.moveTo(x, startY)
    ctx.lineTo(x, cssH)
  }
  for (let r = 0; r <= rows; r++) {
    const y = Math.round(startY + r * cellH) + 0.5
    ctx.moveTo(startX, y)
    ctx.lineTo(cssW, y)
  }
  ctx.stroke()
}

// ─── L3: Labels layer ─────────────────────────────────────────────────────────

/**
 * Draw bead ID labels at the center of each cell.
 * Highlighted cells get bold + larger text; dimmed cells get 30% opacity.
 */
export function renderLabelLayer(
  ctx: CanvasRenderingContext2D,
  cellMap: CellInfo[][],
  grid: GridSettings,
  cssW: number,
  cssH: number,
  highlightId: string | null,
  imgEndX: number,
  imgEndY: number,
  completedBeads?: ReadonlySet<string>,
): void {
  ctx.clearRect(0, 0, cssW, cssH)
  if (cellMap.length === 0) return

  const { startX, startY, cellW, cellH } = cellGeometry(grid, imgEndX, imgEndY)

  // ── Pass 1: green overlay for completed cells (shown even without labels) ──
  if (completedBeads && completedBeads.size > 0) {
    for (let r = 0; r < cellMap.length; r++) {
      for (let c = 0; c < cellMap[r].length; c++) {
        const cell = cellMap[r][c]
        if (!cell || !completedBeads.has(cell.beadId)) continue
        const x = startX + c * cellW
        const y = startY + r * cellH
        ctx.fillStyle = 'rgba(34,197,94,0.55)'
        ctx.fillRect(x, y, cellW, cellH)
      }
    }
    // Draw checkmark symbols centered in each completed cell
    const ckSize = Math.max(6, Math.min(cellW * 0.55, cellH * 0.55, 16))
    ctx.font = `bold ${ckSize}px system-ui,sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#fff'
    for (let r = 0; r < cellMap.length; r++) {
      for (let c = 0; c < cellMap[r].length; c++) {
        const cell = cellMap[r][c]
        if (!cell || !completedBeads.has(cell.beadId)) continue
        const cx = startX + c * cellW + cellW / 2
        const cy = startY + r * cellH + cellH / 2
        ctx.fillText('✓', cx, cy)
      }
    }
  }

  if (!grid.showLabels) return

  // ── Pass 2: color-code labels for non-completed cells ─────────────────────
  const fontSize = Math.max(5, Math.min(cellW * 0.42, cellH * 0.42, 14))
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  for (let r = 0; r < cellMap.length; r++) {
    for (let c = 0; c < cellMap[r].length; c++) {
      const cell = cellMap[r][c]
      if (!cell) continue
      if (completedBeads?.has(cell.beadId)) continue // already drawn as ✓

      const cx = startX + c * cellW + cellW / 2
      const cy = startY + r * cellH + cellH / 2
      const isHighlighted = highlightId === cell.beadId
      const isDimmed = highlightId !== null && !isHighlighted

      const lum = luminance(cell.bead.r, cell.bead.g, cell.bead.b)
      const textColor = lum < 0.35 ? '#fff' : '#1a1a1a'

      ctx.globalAlpha = isDimmed ? 0.25 : 1
      const weight = isHighlighted ? 'bold' : 'normal'
      const size = isHighlighted ? fontSize * 1.25 : fontSize
      ctx.font = `${weight} ${size}px "Inter","Noto Sans SC",system-ui,sans-serif`
      ctx.fillStyle = textColor
      ctx.fillText(cell.beadId, cx, cy)
    }
  }
  ctx.globalAlpha = 1
}

// ─── L4: Highlight layer ──────────────────────────────────────────────────────

/**
 * Draw the highlight mask: white overlay with transparent holes for the
 * selected bead ID. Only this layer is redrawn when highlightId changes,
 * keeping L1/L2/L3 untouched for 60fps performance.
 */
export function renderHighlightLayer(
  ctx: CanvasRenderingContext2D,
  cellMap: CellInfo[][],
  grid: GridSettings,
  cssW: number,
  cssH: number,
  highlightId: string | null,
  imgEndX: number,
  imgEndY: number,
): void {
  ctx.clearRect(0, 0, cssW, cssH)
  if (!highlightId) return

  const { startX, startY, cellW, cellH } = cellGeometry(grid, imgEndX, imgEndY)

  // White semi-transparent mask over everything
  ctx.fillStyle = 'rgba(255,255,255,0.78)'
  ctx.fillRect(0, 0, cssW, cssH)

  // Punch transparent holes for highlighted cells
  ctx.globalCompositeOperation = 'destination-out'
  for (let r = 0; r < cellMap.length; r++) {
    for (let c = 0; c < cellMap[r].length; c++) {
      if (cellMap[r][c]?.beadId === highlightId) {
        const x = startX + c * cellW
        const y = startY + r * cellH
        ctx.fillStyle = 'rgba(0,0,0,1)'
        ctx.fillRect(x, y, cellW, cellH)
      }
    }
  }
  ctx.globalCompositeOperation = 'source-over'
}
