/**
 * cvWorker.ts — Web Worker for heavy image processing.
 *
 * Responsibilities:
 *  1. Load @techstark/opencv-js once and signal READY.
 *  2. On PROCESS:
 *     a. Accept ImageData (preferred) or ImageBitmap → ImageData
 *     b. Optional: warpPerspective (perspective correction)
 *     c. Always: medianBlur (ksize=3) to suppress grid-line noise
 *     d. Build cell map via 3×3 center sampling + CIEDE2000 matching
 *     e. Return TransferableCellInfo[] + processedImageData back to main thread
 */

// ─── Type declarations ────────────────────────────────────────────────────────

export interface TransferableCellInfo {
  col: number
  row: number
  beadId: string
  beadHex: string
  beadR: number
  beadG: number
  beadB: number
}

type ProcessBase = {
  type: 'PROCESS'
  cols: number
  rows: number
  offsetX: number
  offsetY: number
  offsetXFine: number
  offsetYFine: number
  corners?: [[number, number], [number, number], [number, number], [number, number]]
  /** Channel B: skip cells whose average pixel brightness exceeds this threshold (0–255). */
  skipWhiteBrightness?: number
  /** Channel B: fixed cell width in image px. When set, overrides cols-based derivation. */
  cellW?: number
  /** Channel B: fixed cell height in image px. When set, overrides rows-based derivation. */
  cellH?: number
}

export type WorkerInMsg =
  | { type: 'INIT' }
  | (ProcessBase & { imageData: ImageData })
  | (ProcessBase & { bitmap: ImageBitmap })

export type WorkerOutMsg =
  | { type: 'READY' }
  | { type: 'PROGRESS'; pct: number }
  | { type: 'CELL_MAP'; cells: TransferableCellInfo[]; processedImageData: ImageData }
  | { type: 'ERROR'; message: string }

// ─── Inlined MARD palette (221 colors) ───────────────────────────────────────
// Duplicated here because workers cannot reliably import from the main bundle.

interface BeadColor {
  id: string
  hex: string
  r: number
  g: number
  b: number
}

function hex2rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

function entry(id: string, hex: string): BeadColor {
  const [r, g, b] = hex2rgb(hex)
  return { id, hex, r, g, b }
}

const MARD_PALETTE: BeadColor[] = [
  entry('A1','#faf5cd'), entry('A2','#fcfed6'), entry('A3','#fcff92'),
  entry('A4','#f7ec5c'), entry('A5','#f0d83a'), entry('A6','#fda951'),
  entry('A7','#fa8c4f'), entry('A8','#fbda4d'), entry('A9','#f79d5f'),
  entry('A10','#f47e38'), entry('A11','#fedb99'), entry('A12','#fda276'),
  entry('A13','#fec667'), entry('A14','#f75842'), entry('A15','#fbf65e'),
  entry('A16','#feff97'), entry('A17','#fde173'), entry('A18','#fcbf80'),
  entry('A19','#fd7e77'), entry('A20','#f9d666'), entry('A21','#fae393'),
  entry('A22','#edf878'), entry('A23','#e4c8ba'), entry('A24','#f3f6a9'),
  entry('A25','#fdf785'), entry('A26','#ffc734'),
  entry('B1','#dff13b'), entry('B2','#64f343'), entry('B3','#a1f586'),
  entry('B4','#5fdf34'), entry('B5','#39e158'), entry('B6','#64e0a4'),
  entry('B7','#3eae7c'), entry('B8','#1d9b54'), entry('B9','#2a5037'),
  entry('B10','#9ad1ba'), entry('B11','#627032'), entry('B12','#1a6e3d'),
  entry('B13','#c8e87d'), entry('B14','#abe84f'), entry('B15','#305335'),
  entry('B16','#c0ed9c'), entry('B17','#9eb33e'), entry('B18','#e6ed4f'),
  entry('B19','#26b78e'), entry('B20','#cbeccf'), entry('B21','#18616a'),
  entry('B22','#0a4241'), entry('B23','#343b1a'), entry('B24','#e8faa6'),
  entry('B25','#4e846d'), entry('B26','#907c35'), entry('B27','#d0e0af'),
  entry('B28','#9ee5bb'), entry('B29','#c6df5f'), entry('B30','#e3fbb1'),
  entry('B31','#b4e691'), entry('B32','#92ad60'),
  entry('C1','#f0fee4'), entry('C2','#abf8fe'), entry('C3','#a2e0f7'),
  entry('C4','#44cdfb'), entry('C5','#06aadf'), entry('C6','#54a7e9'),
  entry('C7','#3977ca'), entry('C8','#0f52bd'), entry('C9','#3349c3'),
  entry('C10','#3cbce3'), entry('C11','#2aded3'), entry('C12','#1e334e'),
  entry('C13','#cde7fe'), entry('C14','#d5fcf7'), entry('C15','#21c5c4'),
  entry('C16','#1858a2'), entry('C17','#02d1f3'), entry('C18','#213244'),
  entry('C19','#18869d'), entry('C20','#1a70a9'), entry('C21','#bcddfc'),
  entry('C22','#6bb1bb'), entry('C23','#c8e2fd'), entry('C24','#7ec5f9'),
  entry('C25','#a9e8e0'), entry('C26','#42adcf'), entry('C27','#d0def9'),
  entry('C28','#bdcee8'), entry('C29','#364a89'),
  entry('D1','#acb7ef'), entry('D2','#868dd3'), entry('D3','#3554af'),
  entry('D4','#162d7b'), entry('D5','#b34ec6'), entry('D6','#b37bdc'),
  entry('D7','#8758a9'), entry('D8','#e3d2fe'), entry('D9','#d5b9f4'),
  entry('D10','#301a49'), entry('D11','#beb9e2'), entry('D12','#dc99ce'),
  entry('D13','#b5038d'), entry('D14','#862993'), entry('D15','#2f1f8c'),
  entry('D16','#e2e4f0'), entry('D17','#c7d3f9'), entry('D18','#9a64b8'),
  entry('D19','#d8c2d9'), entry('D20','#9a35ad'), entry('D21','#940595'),
  entry('D22','#38389a'), entry('D23','#eadbf8'), entry('D24','#768ae1'),
  entry('D25','#4950c2'), entry('D26','#d6c6eb'),
  entry('E1','#f6d4cb'), entry('E2','#fcc1dd'), entry('E3','#f6bde8'),
  entry('E4','#e8649e'), entry('E5','#f0569f'), entry('E6','#eb4172'),
  entry('E7','#c53674'), entry('E8','#fddbe9'), entry('E9','#e376c7'),
  entry('E10','#d13b95'), entry('E11','#f7dad4'), entry('E12','#f693bf'),
  entry('E13','#b5026a'), entry('E14','#fad4bf'), entry('E15','#f5c9ca'),
  entry('E16','#fbf4ec'), entry('E17','#f7e3ec'), entry('E18','#f9c8db'),
  entry('E19','#f6bbd1'), entry('E20','#d7c6ce'), entry('E21','#c09da4'),
  entry('E22','#b38c9f'), entry('E23','#937d8a'), entry('E24','#debee5'),
  entry('F1','#fe9381'), entry('F2','#f63d4b'), entry('F3','#ee4e3e'),
  entry('F4','#fb2a40'), entry('F5','#e10328'), entry('F6','#913635'),
  entry('F7','#911932'), entry('F8','#bb0126'), entry('F9','#e0677a'),
  entry('F10','#874628'), entry('F11','#592323'), entry('F12','#f3536b'),
  entry('F13','#f45c45'), entry('F14','#fcadb2'), entry('F15','#d50527'),
  entry('F16','#f8c0a9'), entry('F17','#e89b7d'), entry('F18','#d07f4a'),
  entry('F19','#be454a'), entry('F20','#c69495'), entry('F21','#f2b8c6'),
  entry('F22','#f7c3d0'), entry('F23','#ed806c'), entry('F24','#e09daf'),
  entry('F25','#e84854'),
  entry('G1','#ffe4d3'), entry('G2','#fcc6ac'), entry('G3','#f1c4a5'),
  entry('G4','#dcb387'), entry('G5','#e7b34e'), entry('G6','#e3a014'),
  entry('G7','#985c3a'), entry('G8','#713d2f'), entry('G9','#e4b685'),
  entry('G10','#da8c42'), entry('G11','#dac898'), entry('G12','#fec993'),
  entry('G13','#b2714b'), entry('G14','#8b684c'), entry('G15','#f6f8e3'),
  entry('G16','#f2d8c1'), entry('G17','#77544e'), entry('G18','#ffe3d5'),
  entry('G19','#dd7d41'), entry('G20','#a5452f'), entry('G21','#b38561'),
  entry('H1','#ffffff'), entry('H2','#fbfbfb'), entry('H3','#b4b4b4'),
  entry('H4','#878787'), entry('H5','#464648'), entry('H6','#2c2c2c'),
  entry('H7','#010101'), entry('H8','#e7d6dc'), entry('H9','#efedee'),
  entry('H10','#ebebeb'), entry('H11','#cdcdcd'), entry('H12','#fdf6ee'),
  entry('H13','#f4edf1'), entry('H14','#ced7d4'), entry('H15','#9aa6a6'),
  entry('H16','#1b1213'), entry('H17','#f0eeef'), entry('H18','#fcfff6'),
  entry('H19','#f2eee5'), entry('H20','#96a09f'), entry('H21','#f8fbe6'),
  entry('H22','#cacad2'), entry('H23','#9b9c94'),
  entry('M1','#bbc6b6'), entry('M2','#909994'), entry('M3','#697e81'),
  entry('M4','#e0d4bc'), entry('M5','#d1ccaf'), entry('M6','#b0aa86'),
  entry('M7','#b0a796'), entry('M8','#ae8082'), entry('M9','#a68862'),
  entry('M10','#c4b3bb'), entry('M11','#9d7693'), entry('M12','#644b51'),
  entry('M13','#c79266'), entry('M14','#c27563'), entry('M15','#747d7a'),
]

// ─── CIEDE2000 color science (inlined) ───────────────────────────────────────

interface Lab { L: number; a: number; b: number }

function srgbToLinear(c: number): number {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function xyzToLabF(t: number): number {
  const delta = 6 / 29
  return t > delta ** 3 ? t ** (1 / 3) : t / (3 * delta * delta) + 4 / 29
}

function rgbToLab(r: number, g: number, b: number): Lab {
  const rl = srgbToLinear(r), gl = srgbToLinear(g), bl = srgbToLinear(b)
  const x = (0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl) / 0.95047
  const y = (0.2126729 * rl + 0.7151522 * gl + 0.0721750 * bl) / 1.0
  const z = (0.0193339 * rl + 0.0119195 * gl + 0.9503041 * bl) / 1.08883
  const fx = xyzToLabF(x), fy = xyzToLabF(y), fz = xyzToLabF(z)
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) }
}

function mod360(x: number): number { return ((x % 360) + 360) % 360 }

function deltaE00(lab1: Lab, lab2: Lab): number {
  const RAD = Math.PI / 180, DEG = 180 / Math.PI
  const { L: L1, a: a1, b: b1 } = lab1
  const { L: L2, a: a2, b: b2 } = lab2
  const C1 = Math.sqrt(a1*a1+b1*b1), C2 = Math.sqrt(a2*a2+b2*b2)
  const Cab = (C1+C2)/2, Cab7 = Cab**7
  const G = 0.5*(1-Math.sqrt(Cab7/(Cab7+25**7)))
  const a1p = a1*(1+G), a2p = a2*(1+G)
  const C1p = Math.sqrt(a1p*a1p+b1*b1), C2p = Math.sqrt(a2p*a2p+b2*b2)
  const h1p = mod360(Math.atan2(b1,a1p)*DEG), h2p = mod360(Math.atan2(b2,a2p)*DEG)
  const dLp = L2-L1, dCp = C2p-C1p
  let dhp: number
  if (C1p*C2p===0) dhp=0
  else if (Math.abs(h2p-h1p)<=180) dhp=h2p-h1p
  else if (h2p-h1p>180) dhp=h2p-h1p-360
  else dhp=h2p-h1p+360
  const dHp = 2*Math.sqrt(C1p*C2p)*Math.sin((dhp/2)*RAD)
  const Lp=(L1+L2)/2, Cp=(C1p+C2p)/2
  let Hp: number
  if (C1p*C2p===0) Hp=h1p+h2p
  else if (Math.abs(h1p-h2p)<=180) Hp=(h1p+h2p)/2
  else if (h1p+h2p<360) Hp=(h1p+h2p+360)/2
  else Hp=(h1p+h2p-360)/2
  const T=1-0.17*Math.cos((Hp-30)*RAD)+0.24*Math.cos(2*Hp*RAD)+0.32*Math.cos((3*Hp+6)*RAD)-0.20*Math.cos((4*Hp-63)*RAD)
  const Lp50sq=(Lp-50)**2
  const SL=1+0.015*Lp50sq/Math.sqrt(20+Lp50sq)
  const SC=1+0.045*Cp, SH=1+0.015*Cp*T
  const Cp7=Cp**7, RC=2*Math.sqrt(Cp7/(Cp7+25**7))
  const dTheta=30*Math.exp(-(((Hp-275)/25)**2))
  const RT=-Math.sin(2*dTheta*RAD)*RC
  return Math.sqrt((dLp/SL)**2+(dCp/SC)**2+(dHp/SH)**2+RT*(dCp/SC)*(dHp/SH))
}

// Pre-compute Lab for all palette colors
const PALETTE_LAB = MARD_PALETTE.map(b => ({ bead: b, lab: rgbToLab(b.r, b.g, b.b) }))

function findClosestBead(r: number, g: number, b: number): BeadColor {
  const lab = rgbToLab(r, g, b)
  let bestDist = Infinity, bestIdx = 0
  for (let i = 0; i < PALETTE_LAB.length; i++) {
    const d = deltaE00(lab, PALETTE_LAB[i].lab)
    if (d < bestDist) { bestDist = d; bestIdx = i }
  }
  return PALETTE_LAB[bestIdx].bead
}

// ─── 3×3 center sampling ──────────────────────────────────────────────────────

function sample3x3(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
): [number, number, number] {
  let rSum = 0, gSum = 0, bSum = 0, n = 0
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const px = cx + dx, py = cy + dy
      if (px < 0 || py < 0 || px >= width || py >= height) continue
      const i = (py * width + px) * 4
      rSum += data[i]; gSum += data[i+1]; bSum += data[i+2]; n++
    }
  }
  if (n === 0) {
    const i = (cy * width + cx) * 4
    return [data[i], data[i+1], data[i+2]]
  }
  return [Math.round(rSum/n), Math.round(gSum/n), Math.round(bSum/n)]
}

// ─── OpenCV.js handle ─────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cv: any = null

async function initOpenCV(): Promise<void> {
  try {
    // opencv.js (Emscripten IIFE) assigns to `this.cv` / `window.cv`.
    // In a Web Worker `window` is undefined; alias `self` so the assignment lands.
    if (typeof (self as unknown as Record<string, unknown>).window === 'undefined') {
      (self as unknown as Record<string, unknown>).window = self
    }
    // @techstark/opencv-js exports a promise that resolves to the cv object
    const mod = await import('@techstark/opencv-js')
    const cvPromise = mod.default
    cv = cvPromise instanceof Promise ? await cvPromise : cvPromise
  } catch (e) {
    // OpenCV failed to load — we can still do color matching without it
    console.warn('[cvWorker] OpenCV.js failed to load, running without it:', e)
    cv = null
  }
}

// ─── Image processing helpers ─────────────────────────────────────────────────

/** Draw an ImageBitmap into an OffscreenCanvas and return its ImageData. */
function bitmapToImageData(bitmap: ImageBitmap): ImageData {
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('OffscreenCanvas is not available in this browser/worker. Send ImageData instead of ImageBitmap.')
  }
  const oc = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = oc.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0)
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height)
}

/** Apply medianBlur via OpenCV. Returns new ImageData. Falls back to identity if cv unavailable. */
function applyMedianBlur(imageData: ImageData, ksize = 3): ImageData {
  if (!cv) return imageData
  try {
    const mat = cv.matFromImageData(imageData)
    const blurred = new cv.Mat()
    cv.medianBlur(mat, blurred, ksize % 2 === 0 ? ksize + 1 : ksize)
    const result = new ImageData(
      new Uint8ClampedArray(blurred.data),
      blurred.cols,
      blurred.rows,
    )
    mat.delete()
    blurred.delete()
    return result
  } catch (e) {
    console.warn('[cvWorker] medianBlur failed:', e)
    return imageData
  }
}

/** Apply perspective warp. corners = [TL, TR, BR, BL] in image pixels. */
function applyWarpPerspective(
  imageData: ImageData,
  corners: [[number,number],[number,number],[number,number],[number,number]],
): ImageData {
  if (!cv) return imageData
  try {
    const [tl, tr, br, bl] = corners
    // Compute output dimensions from the corner distances
    const wTop = Math.hypot(tr[0]-tl[0], tr[1]-tl[1])
    const wBot = Math.hypot(br[0]-bl[0], br[1]-bl[1])
    const hLeft = Math.hypot(bl[0]-tl[0], bl[1]-tl[1])
    const hRight = Math.hypot(br[0]-tr[0], br[1]-tr[1])
    const outW = Math.round(Math.max(wTop, wBot))
    const outH = Math.round(Math.max(hLeft, hRight))

    const srcPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
      tl[0], tl[1], tr[0], tr[1], br[0], br[1], bl[0], bl[1],
    ])
    const dstPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0, outW, 0, outW, outH, 0, outH,
    ])
    const M = cv.getPerspectiveTransform(srcPoints, dstPoints)
    const src = cv.matFromImageData(imageData)
    const dst = new cv.Mat()
    const dsize = new cv.Size(outW, outH)
    cv.warpPerspective(src, dst, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT)

    const result = new ImageData(
      new Uint8ClampedArray(dst.data),
      dst.cols,
      dst.rows,
    )
    srcPoints.delete(); dstPoints.delete(); M.delete()
    src.delete(); dst.delete()
    return result
  } catch (e) {
    console.warn('[cvWorker] warpPerspective failed:', e)
    return imageData
  }
}

// ─── Cell map builder ─────────────────────────────────────────────────────────

/**
 * Sample a 5×5 region centred at (cx, cy) and return the average [R, G, B].
 * Used for background detection (larger area than the 3×3 colour sample).
 */
function sample5x5avg(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
): number {
  let sum = 0, n = 0
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const px = cx + dx, py = cy + dy
      if (px < 0 || py < 0 || px >= width || py >= height) continue
      const i = (py * width + px) * 4
      sum += (data[i] + data[i + 1] + data[i + 2]) / 3
      n++
    }
  }
  return n > 0 ? sum / n : 255
}

function buildCellMap(
  imageData: ImageData,
  cols: number,
  rows: number,
  offsetX: number,
  offsetY: number,
  offsetXFine: number,
  offsetYFine: number,
  skipWhiteBrightness = 0,   // 0 = disabled; >0 = brightness threshold to skip
  fixedCellW?: number,
  fixedCellH?: number,
): TransferableCellInfo[] {
  const { width, height, data } = imageData
  const startX = offsetX + offsetXFine
  const startY = offsetY + offsetYFine
  const usableW = width - startX
  const usableH = height - startY
  const cellW = fixedCellW ?? usableW / cols
  const cellH = fixedCellH ?? usableH / rows

  const cells: TransferableCellInfo[] = []
  const total = cols * rows

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = Math.min(Math.round(startX + c * cellW + cellW / 2), width - 1)
      const cy = Math.min(Math.round(startY + r * cellH + cellH / 2), height - 1)

      // Smart masking: skip background (near-white) cells for Channel B
      if (skipWhiteBrightness > 0) {
        const avg = sample5x5avg(data, width, height, cx, cy)
        if (avg >= skipWhiteBrightness) {
          const done = r * cols + c + 1
          if (done % Math.max(1, Math.floor(total / 20)) === 0) {
            self.postMessage({ type: 'PROGRESS', pct: Math.round((done / total) * 100) } satisfies WorkerOutMsg)
          }
          continue
        }
      }

      const [pr, pg, pb] = sample3x3(data, width, height, cx, cy)
      const bead = findClosestBead(pr, pg, pb)
      cells.push({
        col: c, row: r,
        beadId: bead.id, beadHex: bead.hex,
        beadR: bead.r, beadG: bead.g, beadB: bead.b,
      })

      // Report progress every 5%
      const done = r * cols + c + 1
      if (done % Math.max(1, Math.floor(total / 20)) === 0) {
        self.postMessage({ type: 'PROGRESS', pct: Math.round((done / total) * 100) } satisfies WorkerOutMsg)
      }
    }
  }
  return cells
}

// ─── Message handler ──────────────────────────────────────────────────────────

self.onmessage = async (e: MessageEvent<WorkerInMsg>) => {
  const msg = e.data

  if (msg.type === 'INIT') {
    await initOpenCV()
    self.postMessage({ type: 'READY' } satisfies WorkerOutMsg)
    return
  }

  if (msg.type === 'PROCESS') {
    try {
      const { cols, rows, offsetX, offsetY, offsetXFine, offsetYFine, corners } = msg

      // Step 1: input → ImageData
      let imageData: ImageData
      if ('imageData' in msg) {
        imageData = msg.imageData
      } else {
        imageData = bitmapToImageData(msg.bitmap)
        msg.bitmap.close()
      }

      // Step 2 (optional): perspective warp
      if (corners && corners.length === 4) {
        imageData = applyWarpPerspective(imageData, corners)
      }

      // Step 3: median blur to suppress grid-line noise
      imageData = applyMedianBlur(imageData, 3)

      // Step 4: build cell map
      const cells = buildCellMap(
        imageData, cols, rows, offsetX, offsetY, offsetXFine, offsetYFine,
        msg.skipWhiteBrightness ?? 0,
        msg.cellW,
        msg.cellH,
      )

      self.postMessage(
        { type: 'CELL_MAP', cells, processedImageData: imageData } satisfies WorkerOutMsg,
      )
    } catch (err) {
      self.postMessage({
        type: 'ERROR',
        message: err instanceof Error ? err.message : String(err),
      } satisfies WorkerOutMsg)
    }
  }
}
