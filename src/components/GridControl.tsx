import { useState } from 'react'
import type { GridDetection } from '../utils/gridDetect'

export interface GridSettings {
  show: boolean
  showLabels: boolean
  cols: number
  rows: number
  offsetX: number
  offsetY: number
  /** Sub-pixel fine offset in X, range [-cellW/2, cellW/2], step 0.1 */
  offsetXFine: number
  /** Sub-pixel fine offset in Y, range [-cellH/2, cellH/2], step 0.1 */
  offsetYFine: number
  /** Channel B: fixed cell width in image px. When set, cell size is fixed rather than derived from cols. */
  cellW?: number
  /** Channel B: fixed cell height in image px. When set, cell size is fixed rather than derived from rows. */
  cellH?: number
  color: string
  opacity: number
}

interface Props {
  settings: GridSettings
  onChange: (s: GridSettings) => void
  detection: GridDetection | null
  detecting: boolean
  onDetect: () => void
  imageWidth: number
  imageHeight: number
}

const PRESETS = [
  { label: '29\xd729', cols: 29, rows: 29 },
  { label: '50\xd750', cols: 50, rows: 50 },
  { label: '58\xd758', cols: 58, rows: 58 },
]

const COLORS = [
  { value: 'rgba(0,0,0,', label: '\u9ed1\u8272' },
  { value: 'rgba(255,255,255,', label: '\u767d\u8272' },
  { value: 'rgba(239,68,68,', label: '\u7ea2\u8272' },
  { value: 'rgba(59,130,246,', label: '\u84dd\u8272' },
]

export default function GridControl({
  settings,
  onChange,
  detection,
  detecting,
  onDetect,
  imageWidth,
  imageHeight,
}: Props) {
  const [fineMode, setFineMode] = useState(false)

  const set = (patch: Partial<GridSettings>) =>
    onChange({ ...settings, ...patch })

  const applyDetection = () => {
    if (!detection) return
    set({
      cols: detection.cols,
      rows: detection.rows,
      offsetX: detection.offsetX,
      offsetY: detection.offsetY,
      show: true,
    })
  }

  const cellW = settings.cols > 0 ? imageWidth / settings.cols : 0
  const cellH = settings.rows > 0 ? imageHeight / settings.rows : 0
  const maxOffX = Math.floor(cellW)
  const maxOffY = Math.floor(cellH)

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-800">
          {'\u7f51\u683c\u7cfb\u7edf'}
        </h3>
        <button
          onClick={() => set({ show: !settings.show })}
          className={`relative h-5 w-9 rounded-full transition-colors ${settings.show ? 'bg-primary-500' : 'bg-gray-300'}`}
        >
          <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${settings.show ? 'translate-x-4' : ''}`} />
        </button>
      </div>

      <div className="space-y-3 px-4 py-3">
        {/* Auto-detect */}
        <div>
          <div className="flex items-center gap-2">
            <button
              onClick={onDetect}
              disabled={detecting}
              className="flex items-center gap-1.5 rounded-md bg-gray-800 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-gray-700 disabled:opacity-50"
            >
              {detecting ? (
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              ) : (
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
              )}
              {'\u667a\u80fd\u68c0\u6d4b'}
            </button>
            {detection && (
              <button
                onClick={applyDetection}
                className="rounded-md border border-primary-200 bg-primary-50 px-2.5 py-1.5 text-xs font-medium text-primary-700 transition hover:bg-primary-100"
              >
                {'\u5e94\u7528'} {detection.cols}{'\u00d7'}{detection.rows}
              </button>
            )}
          </div>
          {detection && (
            <p className="mt-1.5 text-[11px] text-gray-400">
              {'\u68c0\u6d4b\u5230'} {detection.cols}{'\u00d7'}{detection.rows} {'\u7f51\u683c'}
              ({'\u5355\u5143\u683c'} {detection.cellW.toFixed(1)}{'\u00d7'}{detection.cellH.toFixed(1)} px
              , {'\u504f\u79fb'} {detection.offsetX},{detection.offsetY})
              {detection.hasGridLines && ' \u00b7 \u56fe\u7247\u81ea\u5e26\u7f51\u683c\u7ebf'}
              {' \u00b7 '}{'\u7f6e\u4fe1\u5ea6'} {(detection.confidence * 100).toFixed(0)}%
            </p>
          )}
        </div>

        {/* Presets */}
        <div>
          <label className="mb-1 block text-[11px] font-medium text-gray-500">
            {'\u5e38\u7528\u6a21\u677f'}
          </label>
          <div className="flex gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => set({ cols: p.cols, rows: p.rows, show: true })}
                className={`flex-1 rounded-md px-2 py-1 text-xs font-medium transition ${
                  settings.cols === p.cols && settings.rows === p.rows
                    ? 'bg-gray-800 text-white'
                    : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Cols */}
        <SliderRow
          label={'\u5217\u6570'}
          value={settings.cols}
          min={2}
          max={Math.min(500, imageWidth)}
          onChange={(v) => set({ cols: v })}
        />

        {/* Rows */}
        <SliderRow
          label={'\u884c\u6570'}
          value={settings.rows}
          min={2}
          max={Math.min(500, imageHeight)}
          onChange={(v) => set({ rows: v })}
        />

        {/* Fine-tune mode */}
        <div>
          <button
            onClick={() => setFineMode(!fineMode)}
            className={`w-full rounded-md px-3 py-1.5 text-xs font-medium transition ${fineMode ? 'bg-primary-50 text-primary-700 ring-1 ring-primary-200' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}
          >
            {fineMode ? '\u2713 \u5fae\u8c03\u6a21\u5f0f\u5df2\u5f00\u542f' : '\u5fae\u8c03\u6a21\u5f0f\uff08\u504f\u79fb + \u7cbe\u8c03\uff09'}
          </button>
        </div>

        {fineMode && (
          <>
            {/* Coarse offset X */}
            <SliderRow
              label={'X \u504f\u79fb'}
              value={settings.offsetX}
              min={0}
              max={Math.max(0, maxOffX)}
              onChange={(v) => set({ offsetX: v })}
            />
            {/* Coarse offset Y */}
            <SliderRow
              label={'Y \u504f\u79fb'}
              value={settings.offsetY}
              min={0}
              max={Math.max(0, maxOffY)}
              onChange={(v) => set({ offsetY: v })}
            />
            {/* Fine offset X — 0.1px steps */}
            <FineSliderRow
              label={'X \u7cbe\u8c03 (0.1px)'}
              value={settings.offsetXFine}
              halfRange={Math.max(0.5, cellW / 2)}
              onChange={(v) => set({ offsetXFine: v })}
            />
            {/* Fine offset Y — 0.1px steps */}
            <FineSliderRow
              label={'Y \u7cbe\u8c03 (0.1px)'}
              value={settings.offsetYFine}
              halfRange={Math.max(0.5, cellH / 2)}
              onChange={(v) => set({ offsetYFine: v })}
            />
          </>
        )}

        {/* Grid color */}
        <div>
          <label className="mb-1 block text-[11px] font-medium text-gray-500">
            {'\u7f51\u683c\u989c\u8272'}
          </label>
          <div className="flex gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c.value}
                onClick={() => set({ color: c.value })}
                className={`flex-1 rounded-md px-2 py-1 text-xs transition ${
                  settings.color === c.value ? 'ring-2 ring-primary-400 ring-offset-1' : ''
                }`}
                style={{
                  backgroundColor: c.value + '0.3)',
                  color: c.value.includes('255,255,255') ? '#666' : undefined,
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Opacity */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-[11px] font-medium text-gray-500">
              {'\u7f51\u683c\u900f\u660e\u5ea6'}
            </label>
            <span className="font-mono text-[11px] text-gray-400">
              {Math.round(settings.opacity * 100)}%
            </span>
          </div>
          <input
            type="range" min={5} max={100}
            value={Math.round(settings.opacity * 100)}
            onChange={(e) => set({ opacity: +e.target.value / 100 })}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-gray-200 accent-primary-500"
          />
        </div>

        {/* Labels toggle */}
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-medium text-gray-500">
            {'\u663e\u793a\u8272\u53f7\u6807\u6ce8'}
          </label>
          <button
            onClick={() => set({ showLabels: !settings.showLabels })}
            className={`relative h-5 w-9 rounded-full transition-colors ${settings.showLabels ? 'bg-primary-500' : 'bg-gray-300'}`}
          >
            <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${settings.showLabels ? 'translate-x-4' : ''}`} />
          </button>
        </div>

        {/* Info */}
        {settings.show && (
          <p className="text-[11px] text-gray-400">
            {'\u5355\u5143\u683c'}: {cellW.toFixed(1)} {'\u00d7'} {cellH.toFixed(1)} px
            {(settings.offsetX > 0 || settings.offsetY > 0 || settings.offsetXFine !== 0 || settings.offsetYFine !== 0) &&
              ` \u00b7 \u504f\u79fb(${(settings.offsetX + settings.offsetXFine).toFixed(1)}, ${(settings.offsetY + settings.offsetYFine).toFixed(1)})`}
          </p>
        )}
      </div>
    </div>
  )
}

/** Slider for sub-pixel fine offsets (step=0.1, range ±halfRange). */
function FineSliderRow({
  label, value, halfRange, onChange,
}: {
  label: string; value: number; halfRange: number
  onChange: (v: number) => void
}) {
  const min = -halfRange, max = halfRange
  const steps = Math.round(halfRange * 20) // 0.1px steps
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="text-[11px] font-medium text-gray-500">{label}</label>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onChange(Math.max(min, Math.round((value - 0.1) * 10) / 10))}
            className="rounded border border-gray-200 px-1.5 py-0 text-xs text-gray-500 hover:bg-gray-50"
          >
            {'\u2212'}
          </button>
          <span className="w-12 text-center font-mono text-xs font-semibold text-gray-700">
            {value >= 0 ? '+' : ''}{value.toFixed(1)}
          </span>
          <button
            onClick={() => onChange(Math.min(max, Math.round((value + 0.1) * 10) / 10))}
            className="rounded border border-gray-200 px-1.5 py-0 text-xs text-gray-500 hover:bg-gray-50"
          >
            +
          </button>
        </div>
      </div>
      <input
        type="range"
        min={-steps} max={steps} step={1}
        value={Math.round(value * 10)}
        onChange={(e) => onChange(Math.round(+e.target.value) / 10)}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-gray-200 accent-primary-500"
      />
    </div>
  )
}

function SliderRow({
  label, value, min, max, onChange,
}: {
  label: string; value: number; min: number; max: number
  onChange: (v: number) => void
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="text-[11px] font-medium text-gray-500">{label}</label>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onChange(Math.max(min, value - 1))}
            className="rounded border border-gray-200 px-1.5 py-0 text-xs text-gray-500 hover:bg-gray-50"
          >
            {'\u2212'}
          </button>
          <span className="w-8 text-center font-mono text-xs font-semibold text-gray-700">
            {value}
          </span>
          <button
            onClick={() => onChange(Math.min(max, value + 1))}
            className="rounded border border-gray-200 px-1.5 py-0 text-xs text-gray-500 hover:bg-gray-50"
          >
            +
          </button>
        </div>
      </div>
      <input
        type="range" min={min} max={max} value={value}
        onChange={(e) => onChange(+e.target.value)}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-gray-200 accent-primary-500"
      />
    </div>
  )
}
