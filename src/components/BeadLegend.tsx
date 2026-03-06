import { useMemo } from 'react'
import { luminance } from '../utils/pixel'
import type { CellInfo } from '../utils/enhancedRenderer'
import type { BeadColor } from '../data/mardPalette'

interface LegendEntry {
  bead: BeadColor
  count: number
}

interface Props {
  cellMap: CellInfo[][]
  highlightId: string | null
  onHighlight: (id: string | null) => void
  /** When true shows progress bar and 已拼完 buttons. */
  trackMode?: boolean
  completedBeads?: ReadonlySet<string>
  onToggleComplete?: (id: string) => void
}

export default function BeadLegend({
  cellMap,
  highlightId,
  onHighlight,
  trackMode = false,
  completedBeads,
  onToggleComplete,
}: Props) {
  const entries = useMemo(() => {
    const countMap = new Map<string, LegendEntry>()
    for (const row of cellMap) {
      for (const cell of row) {
        if (!cell) continue
        const existing = countMap.get(cell.beadId)
        if (existing) {
          existing.count++
        } else {
          countMap.set(cell.beadId, { bead: cell.bead, count: 1 })
        }
      }
    }
    return Array.from(countMap.values()).sort((a, b) => {
      if (a.bead.id < b.bead.id) return -1
      if (a.bead.id > b.bead.id) return 1
      return 0
    })
  }, [cellMap])

  const totalCells = cellMap.reduce((s, r) => s + r.length, 0)

  const completedCount = useMemo(() => {
    if (!completedBeads || completedBeads.size === 0) return 0
    return entries.filter(e => completedBeads.has(e.bead.id)).length
  }, [entries, completedBeads])

  const completedCells = useMemo(() => {
    if (!completedBeads || completedBeads.size === 0) return 0
    return entries
      .filter(e => completedBeads.has(e.bead.id))
      .reduce((s, e) => s + e.count, 0)
  }, [entries, completedBeads])

  if (entries.length === 0) return null

  const progressPct = entries.length > 0
    ? Math.round((completedCount / entries.length) * 100)
    : 0

  // In track mode: show incomplete first, completed at bottom
  const sortedEntries = trackMode && completedBeads
    ? [
        ...entries.filter(e => !completedBeads.has(e.bead.id)),
        ...entries.filter(e => completedBeads.has(e.bead.id)),
      ]
    : entries

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-800">
          {trackMode ? '拼豆进度' : '色号图例'}
        </h3>
        <span className="text-[11px] text-gray-400">
          {entries.length} 色 · {totalCells} 格
        </span>
      </div>

      {/* Progress bar (track mode only) */}
      {trackMode && (
        <div className="border-b border-gray-100 px-4 py-2.5">
          <div className="mb-1.5 flex items-center justify-between text-[11px]">
            <span className="text-gray-500">
              已完成 <span className="font-semibold text-green-600">{completedCount}</span>/{entries.length} 色
            </span>
            <span className="text-gray-500">
              <span className="font-semibold text-green-600">{completedCells}</span>/{totalCells} 格
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-green-500 transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      <div className={`grid gap-px bg-gray-100 p-px ${trackMode ? 'grid-cols-1' : 'grid-cols-2'}`}>
        {sortedEntries.map((e) => {
          const isDark = luminance(e.bead.r, e.bead.g, e.bead.b) < 0.35
          const isActive = highlightId === e.bead.id
          const isDone = completedBeads?.has(e.bead.id) ?? false
          return (
            <div
              key={e.bead.id}
              className={`flex items-center gap-1.5 bg-white px-2 py-1.5 transition ${
                isDone ? 'opacity-40' : ''
              }`}
            >
              {/* Color swatch + highlight toggle */}
              <button
                onClick={() => onHighlight(isActive ? null : e.bead.id)}
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-[8px] font-bold ring-offset-white transition ${
                  isActive ? 'ring-2 ring-primary-400 ring-offset-1' : ''
                }`}
                style={{
                  backgroundColor: e.bead.hex,
                  color: isDark ? '#fff' : '#1a1a1a',
                }}
                title={`高亮 ${e.bead.id}`}
              >
                {isDone ? '✓' : e.bead.id}
              </button>

              <button
                onClick={() => onHighlight(isActive ? null : e.bead.id)}
                className={`min-w-0 truncate text-left font-mono text-[11px] transition ${
                  isDone ? 'text-gray-400 line-through' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {e.bead.id}
              </button>

              <span className="shrink-0 font-mono text-[10px] text-gray-400">
                {e.count}
              </span>

              {/* 已拼完 button (track mode only) */}
              {trackMode && onToggleComplete && (
                <button
                  onClick={() => onToggleComplete(e.bead.id)}
                  className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium transition ${
                    isDone
                      ? 'bg-green-100 text-green-700 hover:bg-red-100 hover:text-red-600'
                      : 'bg-gray-100 text-gray-500 hover:bg-green-100 hover:text-green-700'
                  }`}
                  title={isDone ? '取消' : '已拼完'}
                >
                  {isDone ? '撤销' : '完成'}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {highlightId && (
        <button
          onClick={() => onHighlight(null)}
          className="w-full border-t border-gray-100 py-2 text-center text-xs text-primary-600 transition hover:bg-primary-50"
        >
          取消高亮
        </button>
      )}
    </div>
  )
}
