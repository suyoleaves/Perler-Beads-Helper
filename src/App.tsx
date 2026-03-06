import { useCallback, useEffect, useRef, useState } from 'react'
import ImageUploader from './components/ImageUploader'
import GridCalibration, { type CalibrationResult } from './components/GridCalibration'
import CanvasViewer, { type CanvasViewerHandle } from './components/CanvasViewer'
import ColorSidebar from './components/ColorSidebar'
import GridControl, { type GridSettings } from './components/GridControl'
import BeadLegend from './components/BeadLegend'
import PerspectivePanel, { type PerspectiveCorners } from './components/PerspectivePanel'
import { analyzeCanvas, SAMPLING_PRESETS, type AnalysisResult } from './utils/colorAnalysis'
import { detectGrid, type GridDetection } from './utils/gridDetect'
import { type CellInfo } from './utils/enhancedRenderer'
import CvWorker from './workers/cvWorker?worker'
import type { WorkerInMsg, WorkerOutMsg, TransferableCellInfo } from './workers/cvWorker'
import { MARD_PALETTE } from './data/mardPalette'
import { extractPixelPattern } from './utils/extractPixelPattern'

// ─── Default state ────────────────────────────────────────────────────────────

const DEFAULT_GRID: GridSettings = {
  show: false,
  showLabels: false,
  cols: 29,
  rows: 29,
  offsetX: 0,
  offsetY: 0,
  offsetXFine: 0,
  offsetYFine: 0,
  color: 'rgba(0,0,0,',
  opacity: 0.35,
}

// ─── Worker cell → CellInfo ───────────────────────────────────────────────────

function workerCellToCellInfo(c: TransferableCellInfo): CellInfo {
  const bead = MARD_PALETTE.find(b => b.id === c.beadId) ?? {
    id: c.beadId, hex: c.beadHex, r: c.beadR, g: c.beadG, b: c.beadB,
    name: c.beadId, group: '',
  }
  return { col: c.col, row: c.row, beadId: c.beadId, bead }
}

/** Convert flat TransferableCellInfo[] → 2D CellInfo[][row][col] */
function flatToGrid(cells: TransferableCellInfo[], cols: number, rows: number): CellInfo[][] {
  const grid: CellInfo[][] = Array.from({ length: rows }, () => new Array(cols))
  for (const c of cells) {
    if (c.row < rows && c.col < cols) grid[c.row][c.col] = workerCellToCellInfo(c)
  }
  return grid
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  // Image state
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  // Processed (medianBlur + perspective) image stored as a canvas so it can be drawn directly.
  const [processedImage, setProcessedImage] = useState<{
    source: CanvasImageSource
    width: number
    height: number
  } | null>(null)

  // Analysis (sidebar color list)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null)
  const [analyzing, setAnalyzing] = useState(false)

  // Grid
  const [grid, setGrid] = useState<GridSettings>(DEFAULT_GRID)
  const [gridDetection, setGridDetection] = useState<GridDetection | null>(null)
  const [detecting, setDetecting] = useState(false)

  // Cell map
  const [cellMap, setCellMap] = useState<CellInfo[][]>([])
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [detectionStatus, setDetectionStatus] = useState<{
    hasGrid: boolean; hasLabels: boolean
  } | null>(null)

  // Track mode (跟做模式)
  const [trackMode, setTrackMode] = useState(false)
  const [completedBeads, setCompletedBeads] = useState<Set<string>>(new Set())

  const toggleCompletedBead = useCallback((id: string) => {
    setCompletedBeads(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Worker
  const workerRef = useRef<Worker | null>(null)
  const workerReady = useRef(false)
  const [processing, setProcessing] = useState(false)
  const [processProgress, setProcessProgress] = useState(0)

  // Perspective
  const [showPerspective, setShowPerspective] = useState(false)
  const [perspectiveCorners, setPerspectiveCorners] = useState<PerspectiveCorners | null>(null)
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 })

  // Canvas viewer ref
  const viewerRef = useRef<CanvasViewerHandle>(null)

  // ── Dual-channel mode ────────────────────────────────────────────────────
  // 'A' = pixel art → colour matching, 'B' = annotated pattern scanner
  const [channel, setChannel] = useState<'A' | 'B' | null>(null)
  // Channel B: show calibration panel after upload, before worker runs
  const [showCalibration, setShowCalibration] = useState(false)

  // ── Worker lifecycle ────────────────────────────────────────────────────

  useEffect(() => {
    const w = new CvWorker()
    workerRef.current = w

    w.onmessage = (e: MessageEvent<WorkerOutMsg>) => {
      const msg = e.data
      if (msg.type === 'READY') {
        workerReady.current = true
      } else if (msg.type === 'PROGRESS') {
        setProcessProgress(msg.pct)
      } else if (msg.type === 'CELL_MAP') {
        const map = flatToGrid(msg.cells, grid.cols, grid.rows)
        setCellMap(map)
        // Build a canvas from processedImageData for rendering.
        const { processedImageData } = msg
        const canvas = document.createElement('canvas')
        canvas.width = processedImageData.width
        canvas.height = processedImageData.height
        const ctx = canvas.getContext('2d')!
        ctx.putImageData(processedImageData, 0, 0)
        setProcessedImage({
          source: canvas,
          width: canvas.width,
          height: canvas.height,
        })
        setProcessing(false)
        setProcessProgress(0)
      } else if (msg.type === 'ERROR') {
        console.error('[Worker]', msg.message)
        setProcessing(false)
      }
    }

    w.postMessage({ type: 'INIT' } satisfies WorkerInMsg)
    return () => w.terminate()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Send PROCESS to worker ───────────────────────────────────────────────

  const runWorker = useCallback((
    g: GridSettings,
    corners?: PerspectiveCorners,
    skipWhiteBrightness = 0,
  ) => {
    const w = workerRef.current
    if (!w || !image) return
    setProcessing(true)
    setProcessProgress(0)

    // Draw current image into an offscreen canvas and send ImageData to worker.
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(image, 0, 0)
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)

    const msg: WorkerInMsg = {
      type: 'PROCESS',
      imageData,
      cols: g.cols,
      rows: g.rows,
      offsetX: g.offsetX,
      offsetY: g.offsetY,
      offsetXFine: g.offsetXFine,
      offsetYFine: g.offsetYFine,
      cellW: g.cellW,
      cellH: g.cellH,
      corners: corners
        ? [corners.tl, corners.tr, corners.br, corners.bl]
        : undefined,
      skipWhiteBrightness,
    }
    // Transfer underlying buffer for performance if available.
    w.postMessage(msg, [imageData.data.buffer])
  }, [image])

  // ── Image upload ─────────────────────────────────────────────────────────

  const handleImageLoad = useCallback((img: HTMLImageElement) => {
    setImage(img)
    setProcessedImage(null)
    setPerspectiveCorners(null)
    // Both channels: show calibration panel for grid alignment
    setShowCalibration(true)
  }, [])

  // ── Color analysis (sidebar) — runs on hidden canvas ────────────────────

  const runAnalysis = useCallback(() => {
    if (!image) return
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(image, 0, 0)
    canvasRef.current = canvas
    setAnalyzing(true)
    setAnalysisResult(null)
    requestAnimationFrame(() => {
      setTimeout(() => {
        const result = analyzeCanvas(ctx, SAMPLING_PRESETS[1].options)
        setAnalysisResult(result)
        setAnalyzing(false)
      }, 50)
    })
  }, [image])

  // ── Grid detection ───────────────────────────────────────────────────────

  const runGridDetect = useCallback(() => {
    if (!image) return
    setDetecting(true)
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(image, 0, 0)
    requestAnimationFrame(() => {
      setTimeout(() => {
        const result = detectGrid(ctx)
        setGridDetection(result)
        if (result && result.confidence > 0.15) {
          setDetectionStatus({ hasGrid: result.hasGridLines, hasLabels: false })
          setGrid(prev => ({
            ...prev,
            cols: result.cols,
            rows: result.rows,
            offsetX: result.offsetX,
            offsetY: result.offsetY,
            show: true,
            showLabels: true,
          }))
        }
        setDetecting(false)
      }, 50)
    })
  }, [image])

  // ── Trigger worker when image or grid changes ────────────────────────────

  useEffect(() => {
    // Don't run worker while calibration panel is showing or for Channel A (uses direct extraction)
    if (!image || showCalibration || channel === 'A') return
    const timer = setTimeout(() => {
      // Channel B uses smart background masking (skip cells brighter than 230/255).
      runWorker(grid, perspectiveCorners ?? undefined, 230)
    }, 300)
    return () => clearTimeout(timer)
  // Stable key: default undefined→0 so deps array always has 9 elements (avoids HMR size-change warning)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, grid.cols, grid.rows, grid.offsetX, grid.offsetY, grid.offsetXFine, grid.offsetYFine, grid.cellW ?? 0, grid.cellH ?? 0])

  // ── Run analysis + detection on new image ───────────────────────────────

  useEffect(() => {
    if (!image) {
      setAnalysisResult(null)
      setGridDetection(null)
      setGrid(DEFAULT_GRID)
      setCellMap([])
      setHighlightId(null)
      setDetectionStatus(null)
      setProcessedImage(null)
      setCompletedBeads(new Set())
      setShowCalibration(false)
      return
    }
    const timer = setTimeout(() => {
      runAnalysis()
      // Both channels now use manual calibration; auto-detection only as sidebar info
    }, 200)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, runAnalysis, runGridDetect])

  // ── Perspective apply ────────────────────────────────────────────────────

  const handlePerspectiveApply = useCallback((corners: PerspectiveCorners) => {
    setPerspectiveCorners(corners)
    setShowPerspective(false)
    runWorker(grid, corners)
  }, [grid, runWorker])

  // ── Calibration confirm ────────────────────────────────────────────────

  /** Channel A: extract center-pixel colours directly (no worker / OCR). */
  const handleCalibrationConfirmA = useCallback((result: CalibrationResult) => {
    if (!image) return
    setShowCalibration(false)
    setGrid(prev => ({
      ...prev,
      cols: result.cols,
      rows: result.rows,
      offsetX: result.offsetX,
      offsetY: result.offsetY,
      offsetXFine: 0,
      offsetYFine: 0,
      cellW: result.cellW,
      cellH: result.cellH,
      show: true,
      showLabels: true,
    }))
    setProcessing(true)
    requestAnimationFrame(() => {
      setTimeout(() => {
        const pattern = extractPixelPattern(
          image,
          image.naturalWidth,
          image.naturalHeight,
          result.offsetX,
          result.offsetY,
          result.cellW,
          result.cellH,
          result.cols,
          result.rows,
        )
        setCellMap(pattern)
        setProcessing(false)
      }, 50)
    })
  }, [image])

  /** Channel B: set grid and let the worker handle OCR / colour matching. */
  const handleCalibrationConfirmB = useCallback((result: CalibrationResult) => {
    setShowCalibration(false)
    setGrid(prev => ({
      ...prev,
      cols: result.cols,
      rows: result.rows,
      offsetX: result.offsetX,
      offsetY: result.offsetY,
      offsetXFine: 0,
      offsetYFine: 0,
      cellW: result.cellW,
      cellH: result.cellH,
      show: true,
      showLabels: true,
    }))
    // Worker fires automatically when grid state changes (see useEffect above).
  }, [])

  // ── Reset ────────────────────────────────────────────────────────────────

  const handleReset = () => {
    setImage(null)
    setChannel(null)
    setShowCalibration(false)
  }

  // ── Active image source: prefer processed image, fall back to original ----

  const activeSource: CanvasImageSource | null =
    processedImage?.source ?? image ?? null
  const activeW = processedImage?.width ?? image?.naturalWidth ?? 0
  const activeH = processedImage?.height ?? image?.naturalHeight ?? 0

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-gray-50 via-white to-primary-50/30">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-gray-200/80 bg-white/70 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2 sm:px-6 sm:py-3">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 shadow-md shadow-primary-300/30 sm:h-9 sm:w-9">
              <svg className="h-4 w-4 text-white sm:h-5 sm:w-5" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="6" cy="6" r="2.5" /><circle cx="12" cy="6" r="2.5" /><circle cx="18" cy="6" r="2.5" />
                <circle cx="6" cy="12" r="2.5" /><circle cx="12" cy="12" r="2.5" /><circle cx="18" cy="12" r="2.5" />
                <circle cx="6" cy="18" r="2.5" /><circle cx="12" cy="18" r="2.5" /><circle cx="18" cy="18" r="2.5" />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight text-gray-900 sm:text-lg">
                {'\u62fc\u8c46\u52a9\u624b'}
              </h1>
              <p className="hidden text-xs text-gray-400 sm:block">Perler Bead Assistant</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {channel && (
              <span className={`hidden rounded-full border px-2.5 py-0.5 text-[11px] font-semibold sm:inline-flex ${
                channel === 'A'
                  ? 'border-primary-200 bg-primary-50 text-primary-700'
                  : 'border-amber-200 bg-amber-50 text-amber-700'
              }`}>
                {channel === 'A' ? '通道 A · 像素图' : '通道 B · 图纸识别'}
              </span>
            )}
            {image && (
              <>
                {cellMap.length > 0 && (
                  <button
                    onClick={() => setTrackMode(v => !v)}
                    className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs shadow-sm transition sm:px-3.5 sm:py-2 sm:text-sm ${
                      trackMode
                        ? 'border-green-300 bg-green-50 text-green-700'
                        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {'跟做模式'}
                  </button>
                )}
                <button
                  onClick={() => setShowPerspective(v => !v)}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs shadow-sm transition sm:px-3.5 sm:py-2 sm:text-sm ${showPerspective ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
                  </svg>
                  {'透视校正'}
                </button>
                <button
                  onClick={handleReset}
                  className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 shadow-sm transition hover:bg-gray-50 sm:px-3.5 sm:py-2 sm:text-sm"
                >
                  <svg className="h-3.5 w-3.5 sm:h-4 sm:w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                  </svg>
                  {'重新上传'}
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-4 sm:px-6 sm:py-6">
        {!image ? (
          !channel ? (
            /* ── Channel picker ───────────────────────────────────────────── */
            <div className="flex flex-col items-center gap-6 pt-8 sm:gap-8 sm:pt-12">
              <div className="text-center">
                <h2 className="text-xl font-semibold text-gray-800 sm:text-2xl">选择工作模式</h2>
                <p className="mt-2 text-sm text-gray-500 sm:text-base">
                  根据图片类型选择合适的处理通道
                </p>
              </div>
              <div className="grid w-full max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Channel A card */}
                <button
                  onClick={() => setChannel('A')}
                  className="group flex flex-col gap-4 rounded-2xl border-2 border-dashed border-gray-200 bg-white p-6 text-left shadow-sm transition hover:border-primary-300 hover:bg-primary-50/40 hover:shadow-md"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-100 text-primary-600 transition group-hover:bg-primary-200">
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                    </svg>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-primary-100 px-2 py-0.5 text-[11px] font-bold text-primary-700">通道 A</span>
                      <h3 className="text-sm font-semibold text-gray-900">像素图转换</h3>
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-gray-500">
                      输入普通图片或像素艺术，自动色彩聚类并匹配 MARD 221 色拼豆色号
                    </p>
                  </div>
                  <span className="mt-auto inline-flex items-center gap-1 text-xs font-medium text-primary-600">选择此通道 →</span>
                </button>

                {/* Channel B card */}
                <button
                  onClick={() => setChannel('B')}
                  className="group flex flex-col gap-4 rounded-2xl border-2 border-dashed border-gray-200 bg-white p-6 text-left shadow-sm transition hover:border-amber-300 hover:bg-amber-50/40 hover:shadow-md"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-600 transition group-hover:bg-amber-200">
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
                    </svg>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">通道 B</span>
                      <h3 className="text-sm font-semibold text-gray-900">图纸识别</h3>
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-gray-500">
                      输入带网格与色号标注的成品图纸，坐标校准后精准提取每格色号，自动过滤空白格
                    </p>
                  </div>
                  <span className="mt-auto inline-flex items-center gap-1 text-xs font-medium text-amber-600">选择此通道 →</span>
                </button>
              </div>
            </div>
          ) : (
            /* ── Channel upload screen ────────────────────────────────────── */
            <div className="flex flex-col items-center gap-6 pt-8 sm:gap-8 sm:pt-12">
              <div className="flex w-full max-w-lg flex-col gap-2">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setChannel(null)}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 shadow-sm transition hover:bg-gray-50"
                  >
                    ← 返回
                  </button>
                  <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                    channel === 'A'
                      ? 'border-primary-200 bg-primary-50 text-primary-700'
                      : 'border-amber-200 bg-amber-50 text-amber-700'
                  }`}>
                    {channel === 'A' ? '通道 A · 像素图转换' : '通道 B · 图纸识别'}
                  </span>
                </div>
                <h2 className="text-xl font-semibold text-gray-800 sm:text-2xl">
                  {channel === 'A' ? '上传像素图或普通图片' : '上传带色号标注的图纸'}
                </h2>
                <p className="text-sm text-gray-500">
                  {channel === 'A'
                    ? '支持低像素艺术图、普通图片，自动色彩聚类并匹配 MARD 色号'
                    : '上传已标注色号的成品图纸，上传后进入坐标校准步骤'}
                </p>
              </div>
              <div className="w-full max-w-lg">
                <ImageUploader onImageLoad={handleImageLoad} />
              </div>
              {channel === 'A' && (
                <div className="w-full max-w-lg rounded-xl border border-primary-100 bg-primary-50/60 px-4 py-3 text-xs text-primary-700">
                  <p className="font-semibold">🎨 通道 A 像素提取流程</p>
                  <ol className="mt-1.5 list-inside list-decimal space-y-1 leading-relaxed">
                    <li>上传图片后进入<strong>坐标校准</strong>步骤，拖动橙色参考线定义一个像素格的尺寸</li>
                    <li>确认网格后自动提取每格中心像素颜色并匹配最近 MARD 色号</li>
                    <li>生成完整拼豆图纸数据，可进入跟做模式</li>
                  </ol>
                </div>
              )}
              {channel === 'B' && (
                <div className="w-full max-w-lg rounded-xl border border-amber-100 bg-amber-50/60 px-4 py-3 text-xs text-amber-700">
                  <p className="font-semibold">📐 通道 B 识别流程</p>
                  <ol className="mt-1.5 list-inside list-decimal space-y-1 leading-relaxed">
                    <li>上传图纸后进入<strong>坐标校准</strong>步骤，拖动橙色参考线定义一个豆子格的尺寸</li>
                    <li>确认网格后程序自动推算全图网格并匹配色号</li>
                    <li>纯白/背景格子自动跳过，不计入豆子清单</li>
                  </ol>
                </div>
              )}
            </div>
          )
        ) : showCalibration ? (
          /* ── Grid calibration panel (shared by both channels) ─────────── */
          <div className="mx-auto flex max-w-xl flex-col gap-4 pt-4 sm:pt-6">
            <div className="flex items-center gap-3">
              <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${
                channel === 'A'
                  ? 'border-primary-200 bg-primary-50 text-primary-700'
                  : 'border-amber-200 bg-amber-50 text-amber-700'
              }`}>
                {channel === 'A' ? '通道 A · 像素图' : '通道 B · 图纸识别'}
              </span>
              <h2 className="text-base font-semibold text-gray-800">② 定义网格大小并对齐</h2>
            </div>
            <GridCalibration
              imageSource={image}
              imageW={image.naturalWidth}
              imageH={image.naturalHeight}
              onConfirm={channel === 'A' ? handleCalibrationConfirmA : handleCalibrationConfirmB}
              onCancel={() => setShowCalibration(false)}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-4 sm:gap-6">
            {/* Detection banner */}
            {detectionStatus && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary-200 bg-primary-50/60 px-3 py-2 text-xs sm:gap-3 sm:px-4 sm:py-2.5">
                <span className="font-medium text-primary-800">{'\u667a\u80fd\u68c0\u6d4b\u7ed3\u679c\uff1a'}</span>
                <span className={`rounded-full px-2 py-0.5 font-medium ${detectionStatus.hasGrid ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                  {detectionStatus.hasGrid ? '\u5df2\u6709\u7f51\u683c\u7ebf' : '\u65e0\u7f51\u683c\u7ebf \u2192 \u5df2\u81ea\u52a8\u6dfb\u52a0'}
                </span>
                <span className={`rounded-full px-2 py-0.5 font-medium ${detectionStatus.hasLabels ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                  {detectionStatus.hasLabels ? '\u5df2\u6709\u8272\u53f7\u6807\u6ce8' : '\u65e0\u8272\u53f7\u6807\u6ce8 \u2192 \u5df2\u81ea\u52a8\u751f\u6210'}
                </span>
              </div>
            )}

            {/* Processing progress */}
            {processing && (
              <div className="flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50/60 px-4 py-2.5 text-xs text-blue-700">
                <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-blue-300 border-t-blue-600" />
                {'\u5904\u7406\u4e2d\u2026'} {processProgress > 0 && `${processProgress}%`}
                {perspectiveCorners && ' \uff08\u900f\u89c6\u6821\u6b63\u5df2\u5e94\u7528\uff09'}
              </div>
            )}

            {/* Cell info bar */}
            {grid.show && activeW > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs shadow-sm sm:gap-3 sm:px-4">
                <span className="font-medium text-gray-700">
                  {"当前单元格大小: "}
                  <strong className="text-gray-900">
                    {grid.cellW != null
                      ? `${grid.cellW.toFixed(1)}×${(grid.cellH ?? 0).toFixed(1)}`
                      : `${(activeW / grid.cols).toFixed(1)}×${(activeH / grid.rows).toFixed(1)}`
                    } px
                  </strong>
                </span>
                <span className="text-gray-300">|</span>
                <span className="font-medium text-gray-700">
                  {"预测总阵列: "}
                  <strong className="text-gray-900">{grid.cols}×{grid.rows}</strong>
                </span>
                {grid.cellW != null && (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-600 ring-1 ring-amber-200">
                    固定单元格
                  </span>
                )}
              </div>
            )}

            {/* Desktop: side-by-side / Mobile: stacked */}
            <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
              {/* Canvas area */}
              <div
                className="min-w-0 flex-1 relative"
                style={{ height: 'clamp(280px, 55vw, 640px)' }}
                ref={el => {
                  // 仅在第一次挂载时记录容器尺寸，避免在 ref 回调里反复 setState 造成无限更新。
                  if (el && (displaySize.w === 0 || displaySize.h === 0)) {
                    const { width, height } = el.getBoundingClientRect()
                    setDisplaySize({ w: Math.round(width), h: Math.round(height) })
                  }
                }}
              >
                <CanvasViewer
                  ref={viewerRef}
                  imageSource={activeSource}
                  imageW={activeW}
                  imageH={activeH}
                  cellMap={cellMap}
                  grid={grid}
                  highlightId={highlightId}
                  completedBeads={trackMode ? completedBeads : undefined}
                  onCellClick={(_, __, beadId) => setHighlightId(prev => prev === beadId ? null : beadId)}
                  showPerspective={showPerspective}
                  perspectiveOverlay={
                    showPerspective && activeW > 0 && activeH > 0 ? (
                      <PerspectivePanel
                        displayW={displaySize.w}
                        displayH={displaySize.h}
                        imageW={activeW}
                        imageH={activeH}
                        onApply={handlePerspectiveApply}
                        onCancel={() => setShowPerspective(false)}
                      />
                    ) : undefined
                  }
                />
              </div>

              {/* Sidebar */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:w-72 lg:shrink-0 lg:grid-cols-1">
                <GridControl
                  settings={grid}
                  onChange={setGrid}
                  detection={gridDetection}
                  detecting={detecting}
                  onDetect={runGridDetect}
                  imageWidth={activeW || image.naturalWidth}
                  imageHeight={activeH || image.naturalHeight}
                />
                <div className="sm:col-span-2 lg:col-span-1">
                  <ColorSidebar result={analysisResult} analyzing={analyzing} />
                </div>
              </div>
            </div>

            {cellMap.length > 0 && (
              <BeadLegend
                cellMap={cellMap}
                highlightId={highlightId}
                onHighlight={id => setHighlightId(prev => prev === id ? null : id)}
                trackMode={trackMode}
                completedBeads={trackMode ? completedBeads : undefined}
                onToggleComplete={trackMode ? toggleCompletedBead : undefined}
              />
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-4 text-center text-[11px] text-gray-400 sm:py-5 sm:text-xs">
        {'\u62fc\u8c46\u52a9\u624b'} &copy; {new Date().getFullYear()} &mdash; {'\u7eaf\u524d\u7aef\u5de5\u5177\uff0c\u56fe\u7247\u4e0d\u4f1a\u4e0a\u4f20\u81f3\u4efb\u4f55\u670d\u52a1\u5668'}
        &nbsp;|&nbsp; {'\u8272\u5361\u6570\u636e\u6765\u6e90\uff1a'}
        <a href="https://www.doudougongfang.com/kb/beads/mard-palette" target="_blank" rel="noopener noreferrer" className="text-primary-500 hover:underline">
          {'\u8c46\u8c46\u5de5\u574a MARD \u8272\u5361'}
        </a>
      </footer>
    </div>
  )
}
