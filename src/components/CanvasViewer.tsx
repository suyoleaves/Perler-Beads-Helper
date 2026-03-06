/**
 * CanvasViewer — 4-layer canvas stack with HiDPI support.
 *
 * Layer order (bottom → top):
 *   L1 source   — original / processed image
 *   L2 grid     — virtual grid lines
 *   L3 labels   — bead ID annotations
 *   L4 highlight — focus-mode mask
 *
 * All heavy computation (color matching, cell map) lives in cvWorker.ts.
 * This component only handles rendering and pointer/pinch interactions.
 */

import {
  useRef, useEffect, useCallback, useState, useImperativeHandle, forwardRef,
} from 'react'
import { setupHiDpiCanvas, clearHiDpiCanvas } from '../utils/hiDpi'
import {
  renderGridLayer, renderLabelLayer, renderHighlightLayer,
  type CellInfo,
} from '../utils/enhancedRenderer'
import type { GridSettings } from './GridControl'

// ─── Public API ───────────────────────────────────────────────────────────────

export interface CanvasViewerHandle {
  /** Re-render all layers (call after cellMap or grid settings change). */
  redrawAll: () => void
  /** Re-render only the highlight layer (60fps-safe). */
  redrawHighlight: () => void
}

interface Props {
  /** Processed image (canvas/image) or raw uploaded image element. */
  imageSource: CanvasImageSource | null
  /** Image pixel width in source space. */
  imageW: number
  /** Image pixel height in source space. */
  imageH: number
  /** 2D array [row][col] of matched cells. */
  cellMap: CellInfo[][]
  grid: GridSettings
  highlightId: string | null
  /** IDs of colors marked as completed (green overlay). */
  completedBeads?: ReadonlySet<string>
  /** Called when user taps/clicks a cell. */
  onCellClick?: (col: number, row: number, beadId: string) => void
  /** Show perspective-correction overlay. */
  showPerspective?: boolean
  perspectiveOverlay?: React.ReactNode
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MIN_ZOOM = 0.25
const MAX_ZOOM = 10
const ZOOM_STEP = 0.25

// ─── Component ────────────────────────────────────────────────────────────────

const CanvasViewer = forwardRef<CanvasViewerHandle, Props>(function CanvasViewer(
  { imageSource, imageW, imageH, cellMap, grid, highlightId, completedBeads, onCellClick, showPerspective, perspectiveOverlay },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const l1Ref = useRef<HTMLCanvasElement>(null) // source image
  const l2Ref = useRef<HTMLCanvasElement>(null) // grid
  const l3Ref = useRef<HTMLCanvasElement>(null) // labels
  const l4Ref = useRef<HTMLCanvasElement>(null) // highlight

  // CSS dimensions of the canvas area
  const [cssSize, setCssSize] = useState({ w: 0, h: 0 })

  // Pan / zoom state
  const zoom = useRef(1)
  const pan = useRef({ x: 0, y: 0 })
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map())
  const lastPinchDist = useRef<number | null>(null)

  // ── Measure container ────────────────────────────────────────────────────

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      setCssSize({ w: Math.round(width), h: Math.round(height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ── Fit image to container when bitmap or size changes ───────────────────

  useEffect(() => {
    if (!imageSource || cssSize.w === 0 || imageW <= 0 || imageH <= 0) return
    const scale = Math.min(cssSize.w / imageW, cssSize.h / imageH, 1)
    zoom.current = scale
    pan.current = {
      x: (cssSize.w - imageW * scale) / 2,
      y: (cssSize.h - imageH * scale) / 2,
    }
  }, [imageSource, imageW, imageH, cssSize])

  // ── Layer render helpers ─────────────────────────────────────────────────

  const drawL1 = useCallback(() => {
    const canvas = l1Ref.current
    if (!canvas || cssSize.w === 0) return
    const ctx = setupHiDpiCanvas(canvas, cssSize.w, cssSize.h)
    clearHiDpiCanvas(ctx, cssSize.w, cssSize.h)
    if (!imageSource) return

    ctx.save()
    ctx.translate(pan.current.x, pan.current.y)
    ctx.scale(zoom.current, zoom.current)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(imageSource, 0, 0, imageW, imageH)
    ctx.restore()
  }, [imageSource, imageW, imageH, cssSize])

  /** Map CSS canvas coordinates to image-space coordinates. */
  const cssToImage = useCallback((cx: number, cy: number): [number, number] => {
    if (!imageSource) return [0, 0]
    return [
      (cx - pan.current.x) / zoom.current,
      (cy - pan.current.y) / zoom.current,
    ]
  }, [imageSource])

  /** Build a scaled GridSettings for the current zoom/pan. */
  const scaledGrid = useCallback((): GridSettings => {
    return {
      ...grid,
      cols: grid.cols,
      rows: grid.rows,
      offsetX: grid.offsetX * zoom.current + pan.current.x,
      offsetY: grid.offsetY * zoom.current + pan.current.y,
      offsetXFine: grid.offsetXFine * zoom.current,
      offsetYFine: grid.offsetYFine * zoom.current,
      cellW: grid.cellW != null ? grid.cellW * zoom.current : undefined,
      cellH: grid.cellH != null ? grid.cellH * zoom.current : undefined,
    }
  }, [grid])

  const drawL2 = useCallback(() => {
    const canvas = l2Ref.current
    if (!canvas || cssSize.w === 0) return
    const ctx = setupHiDpiCanvas(canvas, cssSize.w, cssSize.h)
    const imgEndX = pan.current.x + imageW * zoom.current
    const imgEndY = pan.current.y + imageH * zoom.current
    renderGridLayer(ctx, scaledGrid(), cssSize.w, cssSize.h, imgEndX, imgEndY)
  }, [cssSize, scaledGrid, imageW, imageH])

  const drawL3 = useCallback(() => {
    const canvas = l3Ref.current
    if (!canvas || cssSize.w === 0) return
    const ctx = setupHiDpiCanvas(canvas, cssSize.w, cssSize.h)
    const imgEndX = pan.current.x + imageW * zoom.current
    const imgEndY = pan.current.y + imageH * zoom.current
    renderLabelLayer(ctx, cellMap, scaledGrid(), cssSize.w, cssSize.h, highlightId, imgEndX, imgEndY, completedBeads)
  }, [cssSize, cellMap, scaledGrid, highlightId, imageW, imageH, completedBeads])

  const drawL4 = useCallback(() => {
    const canvas = l4Ref.current
    if (!canvas || cssSize.w === 0) return
    const ctx = setupHiDpiCanvas(canvas, cssSize.w, cssSize.h)
    const imgEndX = pan.current.x + imageW * zoom.current
    const imgEndY = pan.current.y + imageH * zoom.current
    renderHighlightLayer(ctx, cellMap, scaledGrid(), cssSize.w, cssSize.h, highlightId, imgEndX, imgEndY)
  }, [cssSize, cellMap, scaledGrid, highlightId, imageW, imageH])

  const redrawAll = useCallback(() => {
    drawL1(); drawL2(); drawL3(); drawL4()
  }, [drawL1, drawL2, drawL3, drawL4])

  const redrawHighlight = useCallback(() => {
    drawL4()
  }, [drawL4])

  // Expose handles to parent
  useImperativeHandle(ref, () => ({ redrawAll, redrawHighlight }), [redrawAll, redrawHighlight])

  // Redraw all when relevant props change
  useEffect(() => { redrawAll() }, [redrawAll])

  // Only redraw highlight when highlightId changes (skip full redraw)
  const prevHighlight = useRef<string | null>(null)
  useEffect(() => {
    if (prevHighlight.current !== highlightId) {
      prevHighlight.current = highlightId
      drawL3()
      drawL4()
    }
  }, [highlightId, drawL3, drawL4])

  // ── Pointer / pinch events ───────────────────────────────────────────────

  const applyTransform = useCallback(() => {
    drawL1(); drawL2(); drawL3(); drawL4()
  }, [drawL1, drawL2, drawL3, drawL4])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (showPerspective) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
  }, [showPerspective])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (showPerspective || !pointers.current.has(e.pointerId)) return

    const prev = pointers.current.get(e.pointerId)!
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointers.current.size === 1) {
      // Pan
      pan.current = {
        x: pan.current.x + (e.clientX - prev.x),
        y: pan.current.y + (e.clientY - prev.y),
      }
      applyTransform()
    } else if (pointers.current.size === 2) {
      // Pinch-to-zoom
      const pts = [...pointers.current.values()]
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
      if (lastPinchDist.current !== null) {
        const ratio = dist / lastPinchDist.current
        const midX = (pts[0].x + pts[1].x) / 2
        const midY = (pts[0].y + pts[1].y) / 2
        const rect = containerRef.current!.getBoundingClientRect()
        const cx = midX - rect.left, cy = midY - rect.top
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom.current * ratio))
        pan.current = {
          x: cx - (cx - pan.current.x) * (newZoom / zoom.current),
          y: cy - (cy - pan.current.y) * (newZoom / zoom.current),
        }
        zoom.current = newZoom
        applyTransform()
      }
      lastPinchDist.current = dist
    }
  }, [showPerspective, applyTransform])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) lastPinchDist.current = null
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const handleWheel = (e: WheelEvent) => {
      if (showPerspective) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const cx = e.clientX - rect.left, cy = e.clientY - rect.top
      const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom.current + delta))
      pan.current = {
        x: cx - (cx - pan.current.x) * (newZoom / zoom.current),
        y: cy - (cy - pan.current.y) * (newZoom / zoom.current),
      }
      zoom.current = newZoom
      applyTransform()
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [showPerspective, applyTransform])

  const onTap = useCallback((e: React.PointerEvent) => {
    if (showPerspective || !onCellClick || !imageSource) return
    if (pointers.current.size > 0) return // still dragging

    const rect = containerRef.current!.getBoundingClientRect()
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top
    const [ix, iy] = cssToImage(cx, cy)

    const sg = scaledGrid()
    // Convert back to image-space grid
    const startX = grid.offsetX + grid.offsetXFine
    const startY = grid.offsetY + grid.offsetYFine
    const cellW = (imageW - startX) / grid.cols
    const cellH = (imageH - startY) / grid.rows
    const col = Math.floor((ix - startX) / cellW)
    const row = Math.floor((iy - startY) / cellH)
    if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return
    const cell = cellMap[row]?.[col]
    if (cell) onCellClick(col, row, cell.beadId)
    // Suppress unused warning
    void sg
  }, [showPerspective, onCellClick, imageSource, imageW, imageH, cssToImage, scaledGrid, grid, cellMap])

  // ── Render ───────────────────────────────────────────────────────────────

  const canvasStyle: React.CSSProperties = {
    position: 'absolute', inset: 0,
    width: '100%', height: '100%',
    imageRendering: 'pixelated',
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-gray-100 canvas-container"
      style={{ touchAction: 'none', userSelect: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => { onTap(e); onPointerUp(e) }}
      onPointerCancel={onPointerUp}
    >
      {!imageSource && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm select-none">
          {'\u8bf7\u4e0a\u4f20\u56fe\u7247'}
        </div>
      )}

      {/* L1 — source image */}
      <canvas ref={l1Ref} style={canvasStyle} />
      {/* L2 — grid */}
      <canvas ref={l2Ref} style={{ ...canvasStyle, pointerEvents: 'none' }} />
      {/* L3 — labels */}
      <canvas ref={l3Ref} style={{ ...canvasStyle, pointerEvents: 'none' }} />
      {/* L4 — highlight mask */}
      <canvas ref={l4Ref} style={{ ...canvasStyle, pointerEvents: 'none' }} />

      {/* Perspective overlay (optional) */}
      {showPerspective && perspectiveOverlay}
    </div>
  )
})

export default CanvasViewer
