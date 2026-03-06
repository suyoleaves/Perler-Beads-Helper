/**
 * GridCalibration — Interactive canvas-based grid alignment panel.
 *
 * User drags 4 orange reference lines (2 vertical + 2 horizontal) to span
 * exactly ONE bead cell, then clicks "确定网格". The component derives
 * cellW, cellH, offsetX, offsetY, cols, rows and passes them to onConfirm().
 *
 * Interaction modes on the canvas:
 *  - Pointer near a line (≤ HIT_PX): drag that line
 *  - Pointer elsewhere: pan the image
 */

import { useRef, useEffect, useCallback, useState, useMemo } from 'react'
import { getDevicePixelRatio } from '../utils/hiDpi'

// ── Constants ─────────────────────────────────────────────────────────────────

const CANVAS_W = 440
const CANVAS_H = 340
const LINE_COLOR = '#f97316'   // orange-500
const LINE_ACTIVE = '#ef4444'  // red-500
const HIT_PX = 14              // pointer hit tolerance (canvas px)

// ── Types ─────────────────────────────────────────────────────────────────────

type LineName = 'v1' | 'v2' | 'h1' | 'h2'

export interface CalibrationResult {
  cellW: number
  cellH: number
  offsetX: number
  offsetY: number
  cols: number
  rows: number
}

interface Props {
  imageSource: CanvasImageSource
  imageW: number
  imageH: number
  onConfirm: (r: CalibrationResult) => void
  onCancel?: () => void
}

// ── Canvas helper ─────────────────────────────────────────────────────────────

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

// ── Edge-snap helpers ─────────────────────────────────────────────────────────

/** Build a 1-D color-change profile along an axis for edge snapping. */
function buildEdgeProfile(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  axis: 'x' | 'y',
): Float64Array {
  const len = axis === 'x' ? width : height
  const perpLen = axis === 'x' ? height : width
  const profile = new Float64Array(len)
  const step = Math.max(1, Math.floor(perpLen / 150))
  const THR2 = 25 * 25

  for (let i = 1; i < len; i++) {
    let changes = 0
    for (let j = 0; j < perpLen; j += step) {
      const x1 = axis === 'x' ? i - 1 : j
      const y1 = axis === 'x' ? j : i - 1
      const x2 = axis === 'x' ? i : j
      const y2 = axis === 'x' ? j : i
      const idx1 = (y1 * width + x1) * 4
      const idx2 = (y2 * width + x2) * 4
      const dr = data[idx1] - data[idx2]
      const dg = data[idx1 + 1] - data[idx2 + 1]
      const db = data[idx1 + 2] - data[idx2 + 2]
      if (dr * dr + dg * dg + db * db > THR2) changes++
    }
    profile[i] = changes
  }
  return profile
}

/** Find the strongest edge within ±snapRadius of pos. Returns snapped pos or original. */
function snapToEdge(
  profile: Float64Array,
  pos: number,
  snapRadius: number,
): number {
  let total = 0
  for (let i = 1; i < profile.length; i++) total += profile[i]
  const mean = total / (profile.length - 1)
  const threshold = mean * 1.5

  let bestPos = pos
  let bestStrength = 0
  const from = Math.max(1, Math.round(pos) - snapRadius)
  const to = Math.min(profile.length - 1, Math.round(pos) + snapRadius)
  for (let i = from; i <= to; i++) {
    if (profile[i] > threshold && profile[i] > bestStrength) {
      bestStrength = profile[i]
      bestPos = i
    }
  }
  return bestPos
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function GridCalibration({
  imageSource,
  imageW,
  imageH,
  onConfirm,
  onCancel,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // User zoom multiplier on top of fit-zoom
  // Auto-zoom so initial cell (~1.5% of image) is visible at ~50 canvas px
  const [userZoom, setUserZoom] = useState(() => {
    const fit = Math.min(CANVAS_W / imageW, CANVAS_H / imageH, 1)
    const initCell = Math.max(8, Math.round(Math.min(imageW, imageH) * 0.015))
    return Math.min(15, Math.max(1, 50 / (initCell * fit)))
  })

  // Pan offset in canvas pixels (image top-left position)
  const panRef = useRef({ x: 0, y: 0 })

  // Line positions in IMAGE pixel coordinates
  // Initial lines define ONE cell (~1.5% of min dimension) centered in image
  const [lines, setLines] = useState(() => {
    const initCell = Math.max(8, Math.round(Math.min(imageW, imageH) * 0.015))
    const cx = Math.round(imageW / 2)
    const cy = Math.round(imageH / 2)
    return {
      v1: cx - Math.round(initCell / 2),
      v2: cx + Math.round(initCell / 2),
      h1: cy - Math.round(initCell / 2),
      h2: cy + Math.round(initCell / 2),
    }
  })

  // Which line is being dragged
  const [activeLine, setActiveLine] = useState<LineName | null>(null)
  const dragRef = useRef<{ line: LineName; axis: 'x' | 'y' } | null>(null)

  // Edge-snap toggle
  const [snapEnabled, setSnapEnabled] = useState(true)

  // Pan drag state
  const isPanningRef = useRef(false)
  const panStartRef = useRef({ cx: 0, cy: 0, px: 0, py: 0 })

  // Refs for imperatively read values inside draw()
  const linesRef = useRef(lines)
  const activeLineRef = useRef(activeLine)
  linesRef.current = lines
  activeLineRef.current = activeLine

  // Edge profiles for snap-to-edge (computed once from image data)
  const edgeProfilesRef = useRef<{ x: Float64Array; y: Float64Array } | null>(null)

  useEffect(() => {
    const offscreen = document.createElement('canvas')
    offscreen.width = imageW
    offscreen.height = imageH
    const ctx = offscreen.getContext('2d')!
    ctx.drawImage(imageSource as CanvasImageSource, 0, 0, imageW, imageH)
    const imgData = ctx.getImageData(0, 0, imageW, imageH)
    edgeProfilesRef.current = {
      x: buildEdgeProfile(imgData.data, imageW, imageH, 'x'),
      y: buildEdgeProfile(imgData.data, imageW, imageH, 'y'),
    }
  }, [imageSource, imageW, imageH])

  // ── Zoom / coordinate helpers ────────────────────────────────────────────

  const fitZoom = useMemo(
    () => Math.min(CANVAS_W / imageW, CANVAS_H / imageH, 1),
    [imageW, imageH],
  )
  const viewZoom = fitZoom * userZoom

  // Re-centre whenever effective zoom changes
  useEffect(() => {
    panRef.current = {
      x: (CANVAS_W - imageW * viewZoom) / 2,
      y: (CANVAS_H - imageH * viewZoom) / 2,
    }
  }, [viewZoom, imageW, imageH])

  // CSS-to-canvas scaling (the canvas may be rendered smaller by CSS)
  const getScale = useCallback(() => {
    const el = canvasRef.current
    if (!el) return { sx: 1, sy: 1 }
    const rect = el.getBoundingClientRect()
    return { sx: CANVAS_W / rect.width, sy: CANVAS_H / rect.height }
  }, [])

  const imgToCanvas = useCallback(
    (ix: number, iy: number): [number, number] => [
      ix * viewZoom + panRef.current.x,
      iy * viewZoom + panRef.current.y,
    ],
    [viewZoom],
  )

  const canvasToImg = useCallback(
    (cx: number, cy: number): [number, number] => [
      (cx - panRef.current.x) / viewZoom,
      (cy - panRef.current.y) / viewZoom,
    ],
    [viewZoom],
  )

  // ── Draw ─────────────────────────────────────────────────────────────────

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = getDevicePixelRatio()
    const L = linesRef.current
    const AL = activeLineRef.current

    // HiDPI: set backing store to logical size × DPR
    canvas.width = Math.round(CANVAS_W * dpr)
    canvas.height = Math.round(CANVAS_H * dpr)
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.imageSmoothingEnabled = false

    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)

    // Checkerboard background
    ctx.fillStyle = '#d1d5db'
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)
    ctx.fillStyle = '#e5e7eb'
    const sq = 12
    for (let gy = 0; gy < CANVAS_H; gy += sq) {
      for (let gx = (gy / sq) % 2 === 0 ? sq : 0; gx < CANVAS_W; gx += sq * 2) {
        ctx.fillRect(gx, gy, sq, sq)
      }
    }

    // Image
    ctx.save()
    ctx.translate(panRef.current.x, panRef.current.y)
    ctx.scale(viewZoom, viewZoom)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(imageSource, 0, 0, imageW, imageH)
    ctx.restore()

    // Compute canvas positions for all four lines
    const [v1x] = imgToCanvas(L.v1, 0)
    const [v2x] = imgToCanvas(L.v2, 0)
    const [, h1y] = imgToCanvas(0, L.h1)
    const [, h2y] = imgToCanvas(0, L.h2)

    // ── Tiled grid preview ──────────────────────────────────────────────
    const cellWpx = Math.abs(L.v2 - L.v1)
    const cellHpx = Math.abs(L.h2 - L.h1)
    const originX = Math.min(L.v1, L.v2)
    const originY = Math.min(L.h1, L.h2)

    if (cellWpx >= 2 && cellHpx >= 2) {
      // Modular offset: grid phase within one cell period
      const modOffX = originX % cellWpx
      const modOffY = originY % cellHpx

      ctx.save()
      ctx.strokeStyle = 'rgba(249,115,22,0.22)'
      ctx.lineWidth = 0.5
      ctx.setLineDash([3, 3])

      // Vertical tiled lines across full image
      for (let ix = modOffX; ix <= imageW; ix += cellWpx) {
        const [cx] = imgToCanvas(ix, 0)
        if (cx >= -1 && cx <= CANVAS_W + 1) {
          ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, CANVAS_H); ctx.stroke()
        }
      }
      // Horizontal tiled lines across full image
      for (let iy = modOffY; iy <= imageH; iy += cellHpx) {
        const [, cy] = imgToCanvas(0, iy)
        if (cy >= -1 && cy <= CANVAS_H + 1) {
          ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(CANVAS_W, cy); ctx.stroke()
        }
      }
      ctx.restore()
    }

    // ── Shaded cell area ────────────────────────────────────────────────
    const cl = Math.min(v1x, v2x)
    const cr = Math.max(v1x, v2x)
    const ct = Math.min(h1y, h2y)
    const cb = Math.max(h1y, h2y)
    ctx.fillStyle = 'rgba(249,115,22,0.13)'
    ctx.fillRect(cl, ct, cr - cl, cb - ct)
    ctx.strokeStyle = 'rgba(249,115,22,0.5)'
    ctx.lineWidth = 1
    ctx.setLineDash([5, 4])
    ctx.strokeRect(cl, ct, cr - cl, cb - ct)
    ctx.setLineDash([])

    // Four reference lines
    const drawLine = (name: LineName) => {
      const isA = AL === name
      ctx.strokeStyle = isA ? LINE_ACTIVE : LINE_COLOR
      ctx.lineWidth = isA ? 2.5 : 1.5
      ctx.beginPath()
      if (name === 'v1' || name === 'v2') {
        const [cx] = imgToCanvas(L[name], 0)
        ctx.moveTo(cx, 0)
        ctx.lineTo(cx, CANVAS_H)
      } else {
        const [, cy] = imgToCanvas(0, L[name])
        ctx.moveTo(0, cy)
        ctx.lineTo(CANVAS_W, cy)
      }
      ctx.stroke()
    }
    ;(['v1', 'v2', 'h1', 'h2'] as LineName[]).forEach(drawLine)

    // Drag handles (circles)
    const handles: Array<[number, number, LineName]> = [
      [v1x, CANVAS_H / 2, 'v1'],
      [v2x, CANVAS_H / 2, 'v2'],
      [CANVAS_W / 2, h1y, 'h1'],
      [CANVAS_W / 2, h2y, 'h2'],
    ]
    for (const [hx, hy, name] of handles) {
      const isA = AL === name
      ctx.fillStyle = isA ? LINE_ACTIVE : LINE_COLOR
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.arc(hx, hy, 9, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      // Arrow hint
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 1.5
      if (name === 'v1' || name === 'v2') {
        ctx.beginPath(); ctx.moveTo(hx - 4, hy - 3); ctx.lineTo(hx - 7, hy); ctx.lineTo(hx - 4, hy + 3); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(hx + 4, hy - 3); ctx.lineTo(hx + 7, hy); ctx.lineTo(hx + 4, hy + 3); ctx.stroke()
      } else {
        ctx.beginPath(); ctx.moveTo(hx - 3, hy - 4); ctx.lineTo(hx, hy - 7); ctx.lineTo(hx + 3, hy - 4); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(hx - 3, hy + 4); ctx.lineTo(hx, hy + 7); ctx.lineTo(hx + 3, hy + 4); ctx.stroke()
      }
    }

    // Corner intersection dots
    for (const cx of [v1x, v2x]) {
      for (const cy of [h1y, h2y]) {
        ctx.fillStyle = LINE_COLOR
        ctx.strokeStyle = '#fff'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(cx, cy, 5, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      }
    }

    // Info badge (top-left) — use modular offset for correct total
    const modBadgeX = cellWpx > 0 ? originX % cellWpx : 0
    const modBadgeY = cellHpx > 0 ? originY % cellHpx : 0
    const estCols = cellWpx > 0 ? Math.floor((imageW - modBadgeX) / cellWpx) : 0
    const estRows = cellHpx > 0 ? Math.floor((imageH - modBadgeY) / cellHpx) : 0

    ctx.fillStyle = 'rgba(0,0,0,0.62)'
    roundRect(ctx, 6, 6, 210, 48, 7)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 12px "Inter",system-ui,sans-serif'
    ctx.fillText(`单元格: ${cellWpx} × ${cellHpx} px`, 14, 25)
    ctx.font = '11px "Inter",system-ui,sans-serif'
    ctx.fillStyle = estCols < 5 || estRows < 5 ? '#f87171' : '#ccc'
    ctx.fillText(`预测总阵列: ${estCols} 列 × ${estRows} 行`, 14, 43)
  }, [viewZoom, imageSource, imageW, imageH, imgToCanvas])

  // Redraw whenever lines or active state change
  useEffect(() => { draw() }, [draw, lines, activeLine])

  // ── Pointer event helpers ─────────────────────────────────────────────────

  const getCanvasXY = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { sx, sy } = getScale()
    const r = canvasRef.current!.getBoundingClientRect()
    return {
      cx: (e.clientX - r.left) * sx,
      cy: (e.clientY - r.top) * sy,
    }
  }

  const findNearLine = useCallback(
    (cx: number, cy: number): { line: LineName; axis: 'x' | 'y' } | null => {
      const L = linesRef.current
      const [v1x] = imgToCanvas(L.v1, 0)
      const [v2x] = imgToCanvas(L.v2, 0)
      const [, h1y] = imgToCanvas(0, L.h1)
      const [, h2y] = imgToCanvas(0, L.h2)
      const cands: Array<{ line: LineName; axis: 'x' | 'y'; dist: number }> = [
        { line: 'v1', axis: 'x', dist: Math.abs(cx - v1x) },
        { line: 'v2', axis: 'x', dist: Math.abs(cx - v2x) },
        { line: 'h1', axis: 'y', dist: Math.abs(cy - h1y) },
        { line: 'h2', axis: 'y', dist: Math.abs(cy - h2y) },
      ]
      const best = cands.reduce((a, b) => (a.dist < b.dist ? a : b))
      return best.dist <= HIT_PX ? best : null
    },
    [imgToCanvas],
  )

  const onPtrDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const { cx, cy } = getCanvasXY(e)
      const hit = findNearLine(cx, cy)
      if (hit) {
        e.currentTarget.setPointerCapture(e.pointerId)
        dragRef.current = hit
        setActiveLine(hit.line)
      } else {
        isPanningRef.current = true
        panStartRef.current = { cx, cy, px: panRef.current.x, py: panRef.current.y }
        e.currentTarget.setPointerCapture(e.pointerId)
      }
    },
    [findNearLine],
  )

  const onPtrMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const { cx, cy } = getCanvasXY(e)
      if (dragRef.current) {
        const { line, axis } = dragRef.current
        const [ix, iy] = canvasToImg(cx, cy)
        let val =
          axis === 'x'
            ? Math.max(0, Math.min(imageW, Math.round(ix)))
            : Math.max(0, Math.min(imageH, Math.round(iy)))
        // Edge snap: find nearest color edge within snap radius
        if (snapEnabled && edgeProfilesRef.current) {
          const profile = axis === 'x' ? edgeProfilesRef.current.x : edgeProfilesRef.current.y
          const snapRadius = Math.max(3, Math.round(8 / viewZoom))
          val = snapToEdge(profile, val, snapRadius)
        }
        setLines(prev => ({ ...prev, [line]: val }))
      } else if (isPanningRef.current) {
        const { cx: sx, cy: sy, px, py } = panStartRef.current
        panRef.current = { x: px + (cx - sx), y: py + (cy - sy) }
        draw()
      }
    },
    [canvasToImg, imageW, imageH, draw, snapEnabled, viewZoom],
  )

  const onPtrUp = useCallback(() => {
    dragRef.current = null
    isPanningRef.current = false
    setActiveLine(null)
  }, [])

  // ── Confirm / reset ───────────────────────────────────────────────────────

  const handleConfirm = useCallback(() => {
    const cw = Math.max(1, Math.abs(lines.v2 - lines.v1))
    const ch = Math.max(1, Math.abs(lines.h2 - lines.h1))
    const rawOriginX = Math.min(lines.v1, lines.v2)
    const rawOriginY = Math.min(lines.h1, lines.h2)
    // Modular offset: grid phase within one cell period
    const offsetX = rawOriginX % cw
    const offsetY = rawOriginY % ch
    // Total cells covering full image
    const cols = Math.max(1, Math.floor((imageW - offsetX) / cw))
    const rows = Math.max(1, Math.floor((imageH - offsetY) / ch))

    if (cols < 5 || rows < 5) {
      console.warn(`[GridCalibration] Suspiciously low grid: ${cols}×${rows}. Cell: ${cw}×${ch}px. Verify reference lines span exactly ONE bead.`)
    }
    console.log(`[GridCalibration] Grid: ${cols}×${rows} | Cell: ${cw}×${ch}px | Offset: (${offsetX.toFixed(1)}, ${offsetY.toFixed(1)})`)

    onConfirm({ cellW: cw, cellH: ch, offsetX, offsetY, cols, rows })
  }, [lines, imageW, imageH, onConfirm])

  const handleReset = useCallback(() => {
    const initCell = Math.max(8, Math.round(Math.min(imageW, imageH) * 0.015))
    const cx = Math.round(imageW / 2)
    const cy = Math.round(imageH / 2)
    const fit = Math.min(CANVAS_W / imageW, CANVAS_H / imageH, 1)
    setUserZoom(Math.min(15, Math.max(1, 50 / (initCell * fit))))
    setLines({
      v1: cx - Math.round(initCell / 2),
      v2: cx + Math.round(initCell / 2),
      h1: cy - Math.round(initCell / 2),
      h2: cy + Math.round(initCell / 2),
    })
  }, [imageW, imageH])

  const cellW = Math.abs(lines.v2 - lines.v1)
  const cellH = Math.abs(lines.h2 - lines.h1)
  const canConfirm = cellW >= 2 && cellH >= 2

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-3">
      {/* Instruction */}
      <p className="text-xs leading-relaxed text-gray-500">
        拖动<span className="font-semibold text-orange-500">橙色线条</span>（或调节滑块），将两条竖线对准
        <strong>同一豆子格的左右边缘</strong>，两条横线对准<strong>同一豆子格的上下边缘</strong>。
        可拖拽画布平移图像。
      </p>

      {/* Canvas */}
      {/* Real-time info bar */}
      <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs">
        <span className="font-medium text-amber-800">
          当前单元格大小: <strong>{cellW}×{cellH}</strong> px
        </span>
        <span className="text-amber-500">|</span>
        <span className="font-medium text-amber-800">
          预测总阵列: <strong>
            {cellW >= 2 ? Math.floor((imageW - (Math.min(lines.v1, lines.v2) % cellW)) / cellW) : '?'}
            ×
            {cellH >= 2 ? Math.floor((imageH - (Math.min(lines.h1, lines.h2) % cellH)) / cellH) : '?'}
          </strong>
        </span>
        <button
          onClick={() => setSnapEnabled(v => !v)}
          className={`ml-2 rounded px-2 py-0.5 text-[10px] font-semibold transition ${
            snapEnabled
              ? 'bg-green-100 text-green-700 ring-1 ring-green-300'
              : 'bg-gray-100 text-gray-500'
          }`}
        >
          {snapEnabled ? '⚡ 吸附 ON' : '吸附 OFF'}
        </button>
      </div>

      <div
        className="relative overflow-hidden rounded-xl border border-gray-200 bg-gray-200 shadow-sm"
        style={{ aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
      >
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          className="block h-full w-full"
          style={{
            touchAction: 'none',
            imageRendering: 'pixelated',
            cursor: activeLine ? 'crosshair' : 'grab',
          }}
          onPointerDown={onPtrDown}
          onPointerMove={onPtrMove}
          onPointerUp={onPtrUp}
          onPointerCancel={onPtrUp}
        />
      </div>

      {/* Sliders panel */}
      <div className="rounded-xl border border-orange-100 bg-orange-50/70 p-3">
        <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-orange-700">
          调整参考线位置（定义一个豆子格）
        </p>
        <div className="grid grid-cols-2 gap-x-5 gap-y-3">
          {(
            [
              { key: 'v1' as LineName, label: '左竖线', max: imageW },
              { key: 'v2' as LineName, label: '右竖线', max: imageW },
              { key: 'h1' as LineName, label: '上横线', max: imageH },
              { key: 'h2' as LineName, label: '下横线', max: imageH },
            ] as const
          ).map(({ key, label, max }) => (
            <div key={key}>
              <div className="mb-1 flex justify-between text-[11px] font-medium text-orange-600">
                <span>{label}</span>
                <span className="tabular-nums">{lines[key]}px</span>
              </div>
              <input
                type="range"
                min={0}
                max={max}
                value={lines[key]}
                onChange={e => setLines(p => ({ ...p, [key]: +e.target.value }))}
                className="w-full accent-orange-500"
              />
            </div>
          ))}
        </div>
        <p className="mt-2 text-center text-[10px] text-orange-400">
          💡 拖动滑块或直接在画布上拖动橙色线条
        </p>
      </div>

      {/* Zoom / reset row */}
      <div className="flex gap-2">
        <button
          onClick={() => setUserZoom(z => Math.min(z * 1.5, 10))}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-500 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-600 active:scale-95"
        >
          🔍 放大图片
        </button>
        <button
          onClick={() => setUserZoom(z => Math.max(z / 1.5, 0.1))}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-500 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-600 active:scale-95"
        >
          🔍 缩小图片
        </button>
        <button
          onClick={handleReset}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-300 active:scale-95"
        >
          ↺ 重置
        </button>
      </div>

      {/* Confirm */}
      <button
        onClick={handleConfirm}
        disabled={!canConfirm}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-green-500 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-green-600 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
      >
        ✓ 确定网格
        {canConfirm && (
          <span className="text-xs font-normal text-green-100">
            ({cellW}×{cellH}px/格)
          </span>
        )}
      </button>

      {onCancel && (
        <button
          onClick={onCancel}
          className="text-center text-xs text-gray-400 transition hover:text-gray-600"
        >
          取消，返回自动检测
        </button>
      )}
    </div>
  )
}
