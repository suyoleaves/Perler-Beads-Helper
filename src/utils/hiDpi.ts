/**
 * HiDPI canvas setup.
 *
 * Scales the canvas backing store by devicePixelRatio (capped at 3) so that
 * text labels and grid lines are crisp on Retina / iPad Pro displays.
 * The CSS size stays at the logical pixel dimensions you pass in.
 */

export function getDevicePixelRatio(): number {
  return Math.min(typeof window !== 'undefined' ? (window.devicePixelRatio ?? 1) : 1, 3)
}

/**
 * Configure a canvas element for HiDPI rendering.
 * Returns a 2D context already scaled by dpr — draw in logical pixels.
 */
export function setupHiDpiCanvas(
  canvas: HTMLCanvasElement,
  cssW: number,
  cssH: number,
  dpr?: number,
): CanvasRenderingContext2D {
  const ratio = dpr ?? getDevicePixelRatio()
  canvas.width = Math.round(cssW * ratio)
  canvas.height = Math.round(cssH * ratio)
  canvas.style.width = cssW + 'px'
  canvas.style.height = cssH + 'px'
  const ctx = canvas.getContext('2d')!
  ctx.scale(ratio, ratio)
  ctx.imageSmoothingEnabled = false
  return ctx
}

/**
 * Clear a HiDPI canvas without resetting the transform.
 * Use this instead of ctx.clearRect(0,0,canvas.width,canvas.height)
 * because the context is already scaled.
 */
export function clearHiDpiCanvas(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
): void {
  ctx.clearRect(0, 0, cssW, cssH)
}
