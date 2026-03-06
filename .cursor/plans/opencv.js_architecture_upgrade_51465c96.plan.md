---
name: OpenCV.js Architecture Upgrade
overview: Upgrade the app from a pure-JS canvas pipeline to an OpenCV.js + Web Worker architecture. Heavy computation (medianBlur, warpPerspective, cell-map building, color matching) moves off the main thread. A 4-layer canvas system replaces the current 2-layer approach. HiDPI rendering is added for iPad/Retina screens. Perspective transform is an optional "advanced mode" toggle.
todos:
  - id: t1
    content: Install @techstark/opencv-js and update tsconfig.json (esModuleInterop) + vite.config.ts (worker format)
    status: completed
  - id: t2
    content: Create src/utils/hiDpi.ts — HiDPI canvas setup helper with devicePixelRatio capping
    status: completed
  - id: t3
    content: Create src/workers/cvWorker.ts — Web Worker with OpenCV.js init, medianBlur, warpPerspective (optional), buildCellMap with CIEDE2000
    status: completed
  - id: t4
    content: Update src/utils/enhancedRenderer.ts — split into renderGridLayer, renderLabelLayer, renderHighlightLayer; remove buildCellMap
    status: completed
  - id: t5
    content: Create src/components/PerspectivePanel.tsx — optional 4-corner drag UI for perspective correction
    status: completed
  - id: t6
    content: Update src/components/GridControl.tsx — add 0.1px fine-offset (offsetXFine/offsetYFine), update GridSettings interface
    status: completed
  - id: t7
    content: Rewrite src/components/CanvasViewer.tsx — 4-layer canvas stack, HiDPI setup, remove heavy computation, pointer/pinch events
    status: completed
  - id: t8
    content: Update src/App.tsx — wire worker lifecycle, add perspective state, handle worker messages, update layout for PerspectivePanel
    status: completed
  - id: t9
    content: Update src/index.css — ensure pixel-canvas and canvas-container styles are correct for 4-layer stack
    status: completed
  - id: t10
    content: Remove SamplingControl component (sampling now always 3x3 center post-medianBlur in worker)
    status: completed
isProject: false
---

# OpenCV.js + Web Worker Architecture Upgrade

## Architecture Overview

```mermaid
flowchart TD
    Upload["ImageUploader"] -->|"HTMLImageElement"| App
    App -->|"ImageBitmap + config"| Worker["cvWorker.ts (Web Worker)"]
    Worker -->|"load once"| CV["@techstark/opencv-js"]
    Worker -->|"optional"| Warp["warpPerspective"]
    Worker -->|"always"| Blur["medianBlur (ksize=3)"]
    Worker -->|"always"| CellMap["buildCellMap (Lab matching)"]
    Worker -->|"postMessage"| App
    App --> Layers["4-Layer Canvas Stack"]
    Layers --> L1["Layer 1: source image"]
    Layers --> L2["Layer 2: grid lines"]
    Layers --> L3["Layer 3: labels"]
    Layers --> L4["Layer 4: highlight mask"]
    App --> Legend["BeadLegend"]
    App --> GridControl["GridControl (virtual grid)"]
    App --> PerspectiveUI["PerspectivePanel (optional)"]
```



## Layer System

Four absolutely-stacked canvases replace the current 2-layer approach. Each is sized at `naturalWidth * dpr` × `naturalHeight * dpr` with CSS size `naturalWidth × naturalHeight`:


| Layer        | Canvas ref | Redrawn when               | pointer-events |
| ------------ | ---------- | -------------------------- | -------------- |
| L1 source    | `srcRef`   | image changes              | none           |
| L2 grid      | `gridRef`  | grid settings change       | none           |
| L3 labels    | `labelRef` | cellMap or grid changes    | none           |
| L4 highlight | `hlRef`    | `highlightId` changes only | none           |


Highlight changes only touch L4 — no full re-render, enabling 60fps on mobile.

## File Changes

### New files

- `[src/workers/cvWorker.ts](src/workers/cvWorker.ts)` — Web Worker: loads OpenCV.js, handles `warpPerspective`, `medianBlur`, `buildCellMap`
- `[src/components/PerspectivePanel.tsx](src/components/PerspectivePanel.tsx)` — 4-corner picker UI (optional advanced mode)
- `[src/utils/hiDpi.ts](src/utils/hiDpi.ts)` — `setupHiDpiCanvas(canvas, w, h)` helper

### Modified files

- `[src/components/CanvasViewer.tsx](src/components/CanvasViewer.tsx)` — 4-layer stack, HiDPI setup, remove all heavy computation
- `[src/components/GridControl.tsx](src/components/GridControl.tsx)` — add 0.1px fine-offset inputs, remove auto-detect (moved to worker)
- `[src/App.tsx](src/App.tsx)` — wire worker, add perspective state, add `dpr` state
- `[src/utils/enhancedRenderer.ts](src/utils/enhancedRenderer.ts)` — split into 3 pure render functions (grid, labels, highlight), remove `buildCellMap` (now in worker)
- `[src/utils/gridDetect.ts](src/utils/gridDetect.ts)` — keep as fallback, but primary path is virtual grid from user input
- `[vite.config.ts](vite.config.ts)` — add `worker: { format: 'es' }` for Vite worker bundling
- `[package.json](package.json)` — add `@techstark/opencv-js`
- `[tsconfig.json](tsconfig.json)` — add `"esModuleInterop": true`
- `[index.html](index.html)` — no changes needed (worker loaded via `?worker` import)

## Implementation Details

### 1. Worker protocol (`src/workers/cvWorker.ts`)

```typescript
// Worker receives one of these message types:
type WorkerMsg =
  | { type: 'INIT' }
  | { type: 'PROCESS'; bitmap: ImageBitmap; cols: number; rows: number;
      offsetX: number; offsetY: number; corners?: [x:number,y:number][] }

// Worker sends back:
type WorkerResult =
  | { type: 'READY' }
  | { type: 'CELL_MAP'; cells: TransferableCellInfo[]; processedBitmap: ImageBitmap }
  | { type: 'ERROR'; message: string }
```

Worker lifecycle:

1. On `INIT`: `import cvReadyPromise from '@techstark/opencv-js'; cv = await cvReadyPromise; postMessage({type:'READY'})`
2. On `PROCESS`:
  - `cv.matFromImageData(...)` from the bitmap
  - If `corners` provided: `cv.warpPerspective(src, dst, M, dsize)`
  - Always: `cv.medianBlur(mat, blurred, 3)`
  - Sample each cell center (3×3 average), run CIEDE2000 match
  - `postMessage({type:'CELL_MAP', cells, processedBitmap}, [processedBitmap])`
  - `mat.delete(); blurred.delete()` — always clean up Mats

### 2. HiDPI canvas setup (`src/utils/hiDpi.ts`)

```typescript
export function setupHiDpiCanvas(
  canvas: HTMLCanvasElement,
  cssW: number,
  cssH: number,
): CanvasRenderingContext2D {
  const dpr = Math.min(window.devicePixelRatio ?? 1, 3) // cap at 3x
  canvas.width = Math.round(cssW * dpr)
  canvas.height = Math.round(cssH * dpr)
  canvas.style.width = cssW + 'px'
  canvas.style.height = cssH + 'px'
  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)
  ctx.imageSmoothingEnabled = false
  return ctx
}
```

All 4 layers use this. Labels drawn at `dpr`-scaled coordinates are crisp at 2x/3x.

### 3. Virtual grid (no auto-detection dependency)

`GridSettings` gains `offsetXFine: number` (0.1px steps, range ±cellW). The virtual grid formula:

```
cellW = imageWidth / cols
cellH = imageHeight / rows
gridStartX = offsetX + offsetXFine
gridStartY = offsetY + offsetYFine
cell(c, r).centerX = gridStartX + c * cellW + cellW/2
cell(c, r).centerY = gridStartY + r * cellH + cellH/2
```

Auto-detect still runs as a convenience to pre-fill `cols`/`rows`/`offsetX`/`offsetY`, but the user can override freely.

### 4. Perspective Panel (`src/components/PerspectivePanel.tsx`)

- Hidden by default; shown via "透视校正" toggle in the header
- Renders 4 draggable corner markers over the source canvas
- Corner state: `corners: [TL, TR, BR, BL]` as `[x,y]` pairs in image coordinates
- "应用变换" button sends corners to worker → worker runs `warpPerspective` → returns new `processedBitmap` → replaces source layer
- "重置" button clears corners and reverts to original image

### 5. Highlight layer (L4) — 60fps path

```typescript
// Only redraws L4 when highlightId changes
useEffect(() => {
  const ctx = setupHiDpiCanvas(hlRef.current!, cssW, cssH)
  renderHighlightLayer(ctx, cellMap, highlightId, grid)
}, [highlightId]) // NOT in cellMap dependency
```

`renderHighlightLayer` only draws a white mask + clear-holes. L1/L2/L3 are untouched.

### 6. Vite worker config

```typescript
// vite.config.ts
export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
})
```

Worker import in App.tsx:

```typescript
import CvWorker from './workers/cvWorker?worker'
const worker = useMemo(() => new CvWorker(), [])
```

## Migration Notes

- `buildCellMap` and `detectExistingLabels` move entirely into the worker — remove from `enhancedRenderer.ts`
- `enhancedRenderer.ts` becomes 3 pure functions: `renderGridLayer`, `renderLabelLayer`, `renderHighlightLayer`
- `colorAnalysis.ts` (CIEDE2000 matching) is duplicated into the worker file since workers can't import from the main bundle directly in all Vite configs — or use `?worker&url` with shared modules
- The `SamplingControl` component is removed (sampling is now always 3×3 center after medianBlur)
- `gridDetect.ts` is kept but demoted to "optional hint" — the primary UX is user-specified cols/rows

