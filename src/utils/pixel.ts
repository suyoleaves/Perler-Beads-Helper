export interface PixelColor {
  r: number
  g: number
  b: number
  a: number
  hex: string
}

function toHex(n: number): string {
  return n.toString(16).padStart(2, '0')
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

/**
 * Reads the RGBA pixel value at (x, y) from a canvas context.
 * Returns null if the coordinates are out of bounds.
 */
export function getPixelColor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
): PixelColor | null {
  const { width, height } = ctx.canvas
  if (x < 0 || y < 0 || x >= width || y >= height) return null

  const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data
  return { r, g, b, a, hex: rgbToHex(r, g, b) }
}

/**
 * Computes the relative luminance of a color (0–1).
 * Useful for deciding whether to overlay light or dark text.
 */
export function luminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs
}
