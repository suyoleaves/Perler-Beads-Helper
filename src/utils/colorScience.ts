/**
 * Color science utilities: sRGB -> Lab conversion and CIEDE2000 Delta E.
 *
 * CIEDE2000 is the gold-standard perceptual color difference metric.
 * It accounts for lightness, chroma, and hue weighting plus rotation
 * term for the problematic blue region — far superior to Euclidean
 * distance in RGB for bead color matching.
 */

export interface Lab {
  L: number
  a: number
  b: number
}

// ── sRGB -> XYZ -> CIELAB ──

function srgbToLinear(c: number): number {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function xyzToLabF(t: number): number {
  const delta = 6 / 29
  return t > delta ** 3 ? t ** (1 / 3) : t / (3 * delta * delta) + 4 / 29
}

const D65_X = 0.95047
const D65_Y = 1.0
const D65_Z = 1.08883

export function rgbToLab(r: number, g: number, b: number): Lab {
  const rl = srgbToLinear(r)
  const gl = srgbToLinear(g)
  const bl = srgbToLinear(b)

  const x = (0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl) / D65_X
  const y = (0.2126729 * rl + 0.7151522 * gl + 0.0721750 * bl) / D65_Y
  const z = (0.0193339 * rl + 0.0119195 * gl + 0.9503041 * bl) / D65_Z

  const fx = xyzToLabF(x)
  const fy = xyzToLabF(y)
  const fz = xyzToLabF(z)

  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  }
}

// ── CIEDE2000 ──

const RAD = Math.PI / 180
const DEG = 180 / Math.PI

function mod360(x: number): number {
  return ((x % 360) + 360) % 360
}

/**
 * CIEDE2000 color difference.
 * Returns a perceptual distance where ~1 is a just-noticeable difference.
 */
export function deltaE00(lab1: Lab, lab2: Lab): number {
  const { L: L1, a: a1, b: b1 } = lab1
  const { L: L2, a: a2, b: b2 } = lab2

  const C1 = Math.sqrt(a1 * a1 + b1 * b1)
  const C2 = Math.sqrt(a2 * a2 + b2 * b2)
  const Cab = (C1 + C2) / 2

  const Cab7 = Cab ** 7
  const G = 0.5 * (1 - Math.sqrt(Cab7 / (Cab7 + 25 ** 7)))

  const a1p = a1 * (1 + G)
  const a2p = a2 * (1 + G)

  const C1p = Math.sqrt(a1p * a1p + b1 * b1)
  const C2p = Math.sqrt(a2p * a2p + b2 * b2)

  const h1p = mod360(Math.atan2(b1, a1p) * DEG)
  const h2p = mod360(Math.atan2(b2, a2p) * DEG)

  const dLp = L2 - L1
  const dCp = C2p - C1p

  let dhp: number
  if (C1p * C2p === 0) {
    dhp = 0
  } else if (Math.abs(h2p - h1p) <= 180) {
    dhp = h2p - h1p
  } else if (h2p - h1p > 180) {
    dhp = h2p - h1p - 360
  } else {
    dhp = h2p - h1p + 360
  }

  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * RAD)

  const Lp = (L1 + L2) / 2
  const Cp = (C1p + C2p) / 2

  let Hp: number
  if (C1p * C2p === 0) {
    Hp = h1p + h2p
  } else if (Math.abs(h1p - h2p) <= 180) {
    Hp = (h1p + h2p) / 2
  } else if (h1p + h2p < 360) {
    Hp = (h1p + h2p + 360) / 2
  } else {
    Hp = (h1p + h2p - 360) / 2
  }

  const T =
    1 -
    0.17 * Math.cos((Hp - 30) * RAD) +
    0.24 * Math.cos(2 * Hp * RAD) +
    0.32 * Math.cos((3 * Hp + 6) * RAD) -
    0.20 * Math.cos((4 * Hp - 63) * RAD)

  const Lp50sq = (Lp - 50) ** 2
  const SL = 1 + 0.015 * Lp50sq / Math.sqrt(20 + Lp50sq)
  const SC = 1 + 0.045 * Cp
  const SH = 1 + 0.015 * Cp * T

  const Cp7 = Cp ** 7
  const RC = 2 * Math.sqrt(Cp7 / (Cp7 + 25 ** 7))
  const dTheta = 30 * Math.exp(-(((Hp - 275) / 25) ** 2))
  const RT = -Math.sin(2 * dTheta * RAD) * RC

  return Math.sqrt(
    (dLp / SL) ** 2 +
      (dCp / SC) ** 2 +
      (dHp / SH) ** 2 +
      RT * (dCp / SC) * (dHp / SH),
  )
}
