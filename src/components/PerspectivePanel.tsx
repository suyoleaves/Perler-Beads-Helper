/**
 * PerspectivePanel — optional 4-corner drag UI for perspective correction.
 *
 * Shows a semi-transparent overlay on top of the image canvas.
 * Users drag the four corner handles to define the region of interest.
 * When "Apply" is clicked the corners are sent to the parent via onApply.
 */

import { useRef, useState, useCallback, useEffect } from 'react'

export type Corner = [number, number] // [x, y] in image-space pixels

export interface PerspectiveCorners {
  tl: Corner
  tr: Corner
  br: Corner
  bl: Corner
}

interface Props {
  /** CSS width of the canvas container (for coordinate mapping) */
  displayW: number
  /** CSS height of the canvas container */
  displayH: number
  /** Actual image pixel width (for scaling coordinates) */
  imageW: number
  /** Actual image pixel height */
  imageH: number
  onApply: (corners: PerspectiveCorners) => void
  onCancel: () => void
}

type CornerKey = keyof PerspectiveCorners

const CORNER_LABELS: Record<CornerKey, string> = {
  tl: 'TL', tr: 'TR', br: 'BR', bl: 'BL',
}

const CORNER_COLORS: Record<CornerKey, string> = {
  tl: '#f59e0b', tr: '#10b981', br: '#3b82f6', bl: '#ef4444',
}

/** Default corners: full image rectangle in display space */
function defaultCorners(w: number, h: number): PerspectiveCorners {
  const pad = 0.05
  return {
    tl: [w * pad,     h * pad],
    tr: [w * (1-pad), h * pad],
    br: [w * (1-pad), h * (1-pad)],
    bl: [w * pad,     h * (1-pad)],
  }
}

export default function PerspectivePanel({
  displayW, displayH, imageW, imageH, onApply, onCancel,
}: Props) {
  const [corners, setCorners] = useState<PerspectiveCorners>(() =>
    defaultCorners(displayW, displayH),
  )
  const dragging = useRef<CornerKey | null>(null)
  const overlayRef = useRef<SVGSVGElement>(null)

  // Reset corners when display size changes
  useEffect(() => {
    setCorners(defaultCorners(displayW, displayH))
  }, [displayW, displayH])

  const getPointerPos = useCallback((e: React.PointerEvent): [number, number] => {
    const rect = overlayRef.current!.getBoundingClientRect()
    return [
      Math.max(0, Math.min(displayW, e.clientX - rect.left)),
      Math.max(0, Math.min(displayH, e.clientY - rect.top)),
    ]
  }, [displayW, displayH])

  const onPointerDown = useCallback((key: CornerKey, e: React.PointerEvent) => {
    e.preventDefault()
    dragging.current = key
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return
    const pos = getPointerPos(e)
    setCorners(prev => ({ ...prev, [dragging.current!]: pos }))
  }, [getPointerPos])

  const onPointerUp = useCallback(() => {
    dragging.current = null
  }, [])

  const handleApply = () => {
    const scaleX = imageW / displayW
    const scaleY = imageH / displayH
    const scaled: PerspectiveCorners = {
      tl: [corners.tl[0] * scaleX, corners.tl[1] * scaleY],
      tr: [corners.tr[0] * scaleX, corners.tr[1] * scaleY],
      br: [corners.br[0] * scaleX, corners.br[1] * scaleY],
      bl: [corners.bl[0] * scaleX, corners.bl[1] * scaleY],
    }
    onApply(scaled)
  }

  const keys: CornerKey[] = ['tl', 'tr', 'br', 'bl']
  const polyPoints = keys.map(k => corners[k].join(',')).join(' ')

  return (
    <div className="absolute inset-0 z-50 flex flex-col">
      {/* SVG overlay */}
      <svg
        ref={overlayRef}
        className="absolute inset-0 w-full h-full"
        style={{ cursor: 'crosshair', touchAction: 'none' }}
        width={displayW}
        height={displayH}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        {/* Dim outside the quad */}
        <defs>
          <mask id="quad-mask">
            <rect width={displayW} height={displayH} fill="white" />
            <polygon points={polyPoints} fill="black" />
          </mask>
        </defs>
        <rect
          width={displayW} height={displayH}
          fill="rgba(0,0,0,0.45)"
          mask="url(#quad-mask)"
        />
        {/* Quad outline */}
        <polygon
          points={polyPoints}
          fill="none"
          stroke="rgba(255,255,255,0.8)"
          strokeWidth={1.5}
          strokeDasharray="6 3"
        />
        {/* Corner handles */}
        {keys.map(key => (
          <g key={key}>
            <circle
              cx={corners[key][0]}
              cy={corners[key][1]}
              r={18}
              fill="transparent"
              style={{ cursor: 'grab', touchAction: 'none' }}
              onPointerDown={e => onPointerDown(key, e)}
            />
            <circle
              cx={corners[key][0]}
              cy={corners[key][1]}
              r={8}
              fill={CORNER_COLORS[key]}
              stroke="white"
              strokeWidth={2}
              style={{ pointerEvents: 'none' }}
            />
            <text
              x={corners[key][0]}
              y={corners[key][1] - 14}
              textAnchor="middle"
              fontSize={10}
              fill="white"
              fontWeight="bold"
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              {CORNER_LABELS[key]}
            </text>
          </g>
        ))}
      </svg>

      {/* Action buttons — bottom bar */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-3 z-10">
        <button
          onClick={onCancel}
          className="px-4 py-1.5 rounded-lg text-sm font-medium bg-white/20 text-white backdrop-blur border border-white/30 hover:bg-white/30 active:scale-95 transition"
        >
          取消
        </button>
        <button
          onClick={handleApply}
          className="px-4 py-1.5 rounded-lg text-sm font-medium bg-amber-500 text-white hover:bg-amber-400 active:scale-95 transition shadow-lg"
        >
          应用透视校正
        </button>
      </div>
    </div>
  )
}
