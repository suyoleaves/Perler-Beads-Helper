import { useState } from 'react'
import { luminance } from '../utils/pixel'
import type { AnalysisResult, ColorFrequency } from '../utils/colorAnalysis'

interface Props {
  result: AnalysisResult | null
  analyzing: boolean
}

export default function ColorSidebar({ result, analyzing }: Props) {
  const [expanded, setExpanded] = useState(true)
  const [showAll, setShowAll] = useState(false)

  if (analyzing) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-gray-200 border-t-primary-500" />
        <p className="text-sm text-gray-500">正在分析图片颜色...</p>
      </div>
    )
  }

  if (!result) return null

  const { frequencies, totalPixels, uniqueColors, elapsed } = result
  const displayList = showAll ? frequencies : frequencies.slice(0, 30)
  const maxCount = frequencies[0]?.count ?? 1

  return (
    <div className="flex flex-col gap-4">
      {/* Stats header */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center justify-between"
        >
          <h3 className="text-sm font-semibold text-gray-800">
            色号识别结果
          </h3>
          <svg
            className={`h-4 w-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {expanded && (
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <StatCard label="色号数" value={String(frequencies.length)} />
            <StatCard label="采样像素" value={formatNumber(totalPixels)} />
            <StatCard label="耗时" value={`${elapsed.toFixed(0)}ms`} />
          </div>
        )}
      </div>

      {/* Color list */}
      {expanded && (
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-4 py-2.5">
            <p className="text-xs text-gray-400">
              共识别 {frequencies.length} 种色号，源图含 {uniqueColors} 种不同颜色
            </p>
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {displayList.map((item) => (
              <ColorRow key={item.bead.id} item={item} maxCount={maxCount} />
            ))}
          </div>

          {frequencies.length > 30 && (
            <button
              onClick={() => setShowAll(!showAll)}
              className="w-full border-t border-gray-100 py-2.5 text-center text-xs text-primary-600 transition hover:bg-primary-50"
            >
              {showAll
                ? '收起'
                : `展开全部 ${frequencies.length} 种色号`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-2 py-2">
      <p className="text-base font-semibold text-gray-800">{value}</p>
      <p className="text-[11px] text-gray-400">{label}</p>
    </div>
  )
}

function ColorRow({ item, maxCount }: { item: ColorFrequency; maxCount: number }) {
  const { bead, count, percentage, avgDeltaE } = item
  const barWidth = (count / maxCount) * 100
  const isDark = luminance(bead.r, bead.g, bead.b) < 0.35
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(`${bead.id} ${bead.hex}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <button
      onClick={handleCopy}
      className="group flex w-full items-center gap-3 border-b border-gray-50 px-4 py-2 text-left transition last:border-0 hover:bg-gray-50"
    >
      {/* Color swatch */}
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-[10px] font-bold shadow-inner"
        style={{
          backgroundColor: bead.hex,
          color: isDark ? '#fff' : '#1f2937',
        }}
      >
        {bead.id}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs font-medium text-gray-700">
            {bead.id}
          </span>
          <span className="font-mono text-[11px] text-gray-400">
            {bead.hex.toUpperCase()}
          </span>
        </div>

        {/* Bar */}
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${barWidth}%`,
              backgroundColor: bead.hex,
            }}
          />
        </div>

        <div className="mt-0.5 flex items-center justify-between text-[10px] text-gray-400">
          <span>{count} px ({percentage.toFixed(1)}%)</span>
          {avgDeltaE > 0 && (
            <span className={avgDeltaE > 10 ? 'text-amber-500' : ''}>
              {'\u0394'}E {avgDeltaE.toFixed(1)}
            </span>
          )}
        </div>
      </div>

      {/* Copy indicator */}
      <span className={`shrink-0 text-[10px] transition ${copied ? 'text-green-500' : 'text-gray-300 opacity-0 group-hover:opacity-100'}`}>
        {copied ? '\u2713' : '\u590d\u5236'}
      </span>
    </button>
  )
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}
