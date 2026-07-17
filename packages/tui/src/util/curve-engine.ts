/**
 * Math curve engine — pure TypeScript math, no DOM/SVG dependency.
 *
 * Each curve's `point(progress, detailScale)` returns `{x, y}` in 0..1 space.
 * The renderer scales these to terminal width/height.
 *
 * Curves extracted from https://github.com/Paidax01/math-curve-loaders
 * with config params hardcoded as defaults.
 */

export type CurvePoint = { x: number; y: number }

export type CurveConfig = {
  name: string
  /** particle count — controls trail density */
  particleCount: number
  /** what fraction of the loop the trail spans (0..1) */
  trailSpan: number
  /** loop duration in ms */
  durationMs: number
  /** pulse (breathing) duration in ms */
  pulseDurationMs: number
  /** rotation duration in ms; 0 = no rotation */
  rotationDurationMs: number
  /** whether the curve benefits from rotation */
  rotate: boolean
  /** main curve function — progress 0..1, detailScale 0..1 → {x,y} in 0..1 space */
  point: (progress: number, detailScale: number) => CurvePoint
}

// ─── helpers ──────────────────────────────────────────────

export function normalizeProgress(progress: number): number {
  return ((progress % 1) + 1) % 1
}

/**
 * Breathing detailScale: oscillates 0.52..1.0 with a sine pulse.
 * Phase offset randomizes start position per-instance.
 */
export function getDetailScale(time: number, pulseDurationMs: number, phaseOffset = 0): number {
  const pulseProgress = ((time + phaseOffset * pulseDurationMs) % pulseDurationMs) / pulseDurationMs
  const pulseAngle = pulseProgress * Math.PI * 2
  return 0.52 + ((Math.sin(pulseAngle + 0.55) + 1) / 2) * 0.48
}

/**
 * Rotation angle in degrees for a given time.
 * Returns 0 if rotation is disabled.
 */
export function getRotation(time: number, rotationDurationMs: number, phaseOffset = 0): number {
  if (rotationDurationMs <= 0) return 0
  return -(((time + phaseOffset * rotationDurationMs) % rotationDurationMs) / rotationDurationMs) * 360
}

// ─── curve definitions ───────────────────────────────────
// Each curve follows the original math from math-curve-loaders,
// with config params hardcoded. Output is normalized to 0..1
// by dividing the original SVG coordinates (centered at 50) by 100
// and adding 0.5.

// 1. Rose Curve (k=5): r = a * (breath) * cos(k*t)
const ROSE_A = 9.2
const ROSE_A_BOOST = 0.6
const ROSE_BREATH_BASE = 0.72
const ROSE_BREATH_BOOST = 0.28
const ROSE_K = 5
const ROSE_SCALE = 3.25

// 2. Lissajous Drift: x = sin(at+δ), y = sin(bt)
const LISSAJOUS_AMP = 24
const LISSAJOUS_AMP_BOOST = 6
const LISSAJOUS_A = 3
const LISSAJOUS_B = 4
const LISSAJOUS_PHASE = 1.57
const LISSAJOUS_Y_SCALE = 0.92

// 3. Lemniscate Bloom (Bernoulli): x = a·cos(t)/(1+sin²t), y = a·sin(t)cos(t)/(1+sin²t)
const LEMNISCATE_A = 20
const LEMNISCATE_BOOST = 7

// 4. Butterfly Phase
const BUTTERFLY_TURNS = 12
const BUTTERFLY_SCALE = 4.6
const BUTTERFLY_PULSE = 0.45
const BUTTERFLY_COS_WEIGHT = 2
const BUTTERFLY_POWER = 5

// 5. Cardioid Heart: r = a(1+cos t), rotated upright
const CARDIOID_A = 8.8
const CARDIOID_PULSE = 0.8
const CARDIOID_SCALE = 2.15

// 6. Archimedean Spiral (Spiral Search)
const SEARCH_TURNS = 4
const SEARCH_BASE_RADIUS = 8
const SEARCH_RADIUS_AMP = 8.5
const SEARCH_PULSE = 2.4
const SEARCH_SCALE = 1

// 7. Hypotrochoid Loop (spirograph)
const SPIRO_R = 8.2
const SPIRO_R_SMALL = 2.7
const SPIRO_R_BOOST = 0.45
const SPIRO_D = 4.8
const SPIRO_D_BOOST = 1.2
const SPIRO_SCALE = 3.05

// 8. Fourier Flow
const FOURIER_X1 = 17
const FOURIER_X3 = 7.5
const FOURIER_X5 = 3.2
const FOURIER_Y1 = 15
const FOURIER_Y2 = 8.2
const FOURIER_Y4 = 4.2
const FOURIER_MIX_BASE = 1
const FOURIER_MIX_PULSE = 0.16

// ─── CURVES ──────────────────────────────────────────────

export const CURVES: Record<string, CurveConfig> = {
  rose: {
    name: "Rose Curve",
    particleCount: 78,
    trailSpan: 0.32,
    durationMs: 5400,
    pulseDurationMs: 4600,
    rotationDurationMs: 28000,
    rotate: true,
    point(progress, detailScale) {
      const t = progress * Math.PI * 2
      const a = ROSE_A + detailScale * ROSE_A_BOOST
      const r = a * (ROSE_BREATH_BASE + detailScale * ROSE_BREATH_BOOST) * Math.cos(ROSE_K * t)
      return {
        x: 0.5 + (Math.cos(t) * r * ROSE_SCALE) / 100,
        y: 0.5 + (Math.sin(t) * r * ROSE_SCALE) / 100,
      }
    },
  },

  lissajous: {
    name: "Lissajous Drift",
    particleCount: 68,
    trailSpan: 0.34,
    durationMs: 6000,
    pulseDurationMs: 5400,
    rotationDurationMs: 0,
    rotate: false,
    point(progress, detailScale) {
      const t = progress * Math.PI * 2
      const amp = LISSAJOUS_AMP + detailScale * LISSAJOUS_AMP_BOOST
      return {
        x: 0.5 + Math.sin(LISSAJOUS_A * t + LISSAJOUS_PHASE) * amp / 100,
        y: 0.5 + Math.sin(LISSAJOUS_B * t) * (amp * LISSAJOUS_Y_SCALE) / 100,
      }
    },
  },

  lemniscate: {
    name: "Lemniscate Bloom",
    particleCount: 70,
    trailSpan: 0.4,
    durationMs: 5600,
    pulseDurationMs: 5000,
    rotationDurationMs: 0,
    rotate: false,
    point(progress, detailScale) {
      const t = progress * Math.PI * 2
      const scale = LEMNISCATE_A + detailScale * LEMNISCATE_BOOST
      const denom = 1 + Math.sin(t) ** 2
      return {
        x: 0.5 + (scale * Math.cos(t)) / denom / 100,
        y: 0.5 + (scale * Math.sin(t) * Math.cos(t)) / denom / 100,
      }
    },
  },

  butterfly: {
    name: "Butterfly Phase",
    particleCount: 88,
    trailSpan: 0.32,
    durationMs: 9000,
    pulseDurationMs: 7000,
    rotationDurationMs: 0,
    rotate: false,
    point(progress, detailScale) {
      const t = progress * Math.PI * BUTTERFLY_TURNS
      const s =
        Math.exp(Math.cos(t)) -
        BUTTERFLY_COS_WEIGHT * Math.cos(4 * t) -
        Math.sin(t / 12) ** BUTTERFLY_POWER
      const scale = BUTTERFLY_SCALE + detailScale * BUTTERFLY_PULSE
      return {
        x: 0.5 + (Math.sin(t) * s * scale) / 100,
        y: 0.5 + (Math.cos(t) * s * scale) / 100,
      }
    },
  },

  cardioid: {
    name: "Cardioid Heart",
    particleCount: 74,
    trailSpan: 0.36,
    durationMs: 6200,
    pulseDurationMs: 5200,
    rotationDurationMs: 0,
    rotate: false,
    point(progress, detailScale) {
      const t = progress * Math.PI * 2
      const a = CARDIOID_A + detailScale * CARDIOID_PULSE
      const r = a * (1 + Math.cos(t))
      const baseX = Math.cos(t) * r
      const baseY = Math.sin(t) * r
      // rotated upright
      return {
        x: 0.5 - (baseY * CARDIOID_SCALE) / 100,
        y: 0.5 - (baseX * CARDIOID_SCALE) / 100,
      }
    },
  },

  spiral: {
    name: "Archimedean Spiral",
    particleCount: 86,
    trailSpan: 0.28,
    durationMs: 7800,
    pulseDurationMs: 6800,
    rotationDurationMs: 0,
    rotate: false,
    point(progress, detailScale) {
      const t = progress * Math.PI * 2
      const angle = t * SEARCH_TURNS
      const radius =
        SEARCH_BASE_RADIUS +
        (1 - Math.cos(t)) * (SEARCH_RADIUS_AMP + detailScale * SEARCH_PULSE)
      return {
        x: 0.5 + (Math.cos(angle) * radius * SEARCH_SCALE) / 100,
        y: 0.5 + (Math.sin(angle) * radius * SEARCH_SCALE) / 100,
      }
    },
  },

  hypotrochoid: {
    name: "Hypotrochoid Loop",
    particleCount: 82,
    trailSpan: 0.46,
    durationMs: 7600,
    pulseDurationMs: 6200,
    rotationDurationMs: 0,
    rotate: false,
    point(progress, detailScale) {
      const t = progress * Math.PI * 2
      const r = SPIRO_R_SMALL + detailScale * SPIRO_R_BOOST
      const d = SPIRO_D + detailScale * SPIRO_D_BOOST
      const x = (SPIRO_R - r) * Math.cos(t) + d * Math.cos(((SPIRO_R - r) / r) * t)
      const y = (SPIRO_R - r) * Math.sin(t) - d * Math.sin(((SPIRO_R - r) / r) * t)
      return {
        x: 0.5 + (x * SPIRO_SCALE) / 100,
        y: 0.5 + (y * SPIRO_SCALE) / 100,
      }
    },
  },

  fourier: {
    name: "Fourier Flow",
    particleCount: 92,
    trailSpan: 0.31,
    durationMs: 8400,
    pulseDurationMs: 6800,
    rotationDurationMs: 0,
    rotate: false,
    point(progress, detailScale) {
      const t = progress * Math.PI * 2
      const mix = FOURIER_MIX_BASE + detailScale * FOURIER_MIX_PULSE
      const x =
        FOURIER_X1 * Math.cos(t) +
        FOURIER_X3 * Math.cos(3 * t + 0.6 * mix) +
        FOURIER_X5 * Math.sin(5 * t - 0.4)
      const y =
        FOURIER_Y1 * Math.sin(t) +
        FOURIER_Y2 * Math.sin(2 * t + 0.25) -
        FOURIER_Y4 * Math.cos(4 * t - 0.5 * mix)
      return {
        x: 0.5 + x / 100,
        y: 0.5 + y / 100,
      }
    },
  },
}

export type CurveName = keyof typeof CURVES

export const DEFAULT_CURVE: CurveName = "rose"

export function getCurve(name: CurveName): CurveConfig {
  return CURVES[name]!
}

/**
 * Compute particle positions for a curve at a given time.
 * Returns an array of {x, y, opacity} in 0..1 space.
 */
export function computeParticles(
  curve: CurveConfig,
  time: number,
  phaseOffset = 0,
  width: number,
  height: number,
): Array<{ x: number; y: number; opacity: number }> {
  const detailScale = getDetailScale(time, curve.pulseDurationMs, phaseOffset)
  const progress = (time % curve.durationMs) / curve.durationMs
  const rotation = getRotation(time, curve.rotationDurationMs, phaseOffset)
  const cosR = Math.cos((rotation * Math.PI) / 180)
  const sinR = Math.sin((rotation * Math.PI) / 180)
  const cx = 0.5
  const cy = 0.5
  const aspectScale = width / height

  const particles: Array<{ x: number; y: number; opacity: number }> = []
  for (let i = 0; i < curve.particleCount; i++) {
    const tailOffset = i / (curve.particleCount - 1)
    const p = curve.point(normalizeProgress(progress - tailOffset * curve.trailSpan), detailScale)
    // rotate around center
    const dx = p.x - cx
    const dy = (p.y - cy) * aspectScale
    const rx = cx + (dx * cosR - dy * sinR)
    const ry = cy + (dx * sinR + dy * cosR) / aspectScale
    const fade = Math.pow(1 - tailOffset, 0.56)
    particles.push({
      x: rx,
      y: ry,
      opacity: 0.04 + fade * 0.96,
    })
  }
  return particles
}
