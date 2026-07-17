import {
  FrameBufferRenderable,
  RGBA,
  type OptimizedBuffer,
  type RenderContext,
  type RenderableOptions,
} from "@opentui/core"
import { extend } from "@opentui/solid"
import { tint, useTheme } from "../context/theme"
import {
  CURVES,
  computeParticles,
  getCurve,
  type CurveConfig,
  type CurveName,
} from "../util/curve-engine"

const SPACE = " ".codePointAt(0)!
const TOP_HALF = "▀".codePointAt(0)!
const BOTTOM_HALF = "▄".codePointAt(0)!
const FULL_BLOCK = "█".codePointAt(0)!

type Rgb = [number, number, number]

function clamp(n: number) {
  return n < 0 ? 0 : n > 1 ? 1 : n
}

function mixChannel(base: number, overlay: number, alpha: number) {
  return Math.round(base + (overlay - base) * clamp(alpha))
}

function writeRgb(buffer: Uint16Array, offset: number, r: number, g: number, b: number, a = 255) {
  buffer[offset] = r
  buffer[offset + 1] = g
  buffer[offset + 2] = b
  buffer[offset + 3] = a
}

/**
 * Paints curve particles onto a FrameBuffer using sub-cell anti-aliasing.
 * Each terminal cell is split into top/bottom halves (▀/▄/█) for 2x vertical resolution.
 */
export class CurveSpinnerPainter {
  private elapsed = 0
  private phaseOffset = Math.random()
  private curve: CurveConfig
  private primaryRgb: Rgb = [255, 255, 255]
  private bgRgb: Rgb = [0, 0, 0]
  private geometryWidth = 0
  private geometryHeight = 0
  private cacheDirty = true
  private frameCache: Array<{ fg: Uint16Array; bg: Uint16Array; char: Uint32Array }> = []
  private cacheBuildIndex = 0
  private cacheCount = 0

  constructor(curveName: CurveName) {
    this.curve = getCurve(curveName)
    // Pre-compute frame cache for one full loop cycle
    this.cacheCount = Math.round(this.curve.durationMs / (1000 / 30))
  }

  setCurve(name: CurveName) {
    const next = getCurve(name)
    if (this.curve === next) return false
    this.curve = next
    this.cacheCount = Math.round(this.curve.durationMs / (1000 / 30))
    this.invalidateCache()
    return true
  }

  setPrimary(rgb: Rgb) {
    if (this.primaryRgb[0] === rgb[0] && this.primaryRgb[1] === rgb[1] && this.primaryRgb[2] === rgb[2]) return false
    this.primaryRgb = rgb
    this.invalidateCache()
    return true
  }

  setBackground(rgb: Rgb) {
    if (this.bgRgb[0] === rgb[0] && this.bgRgb[1] === rgb[1] && this.bgRgb[2] === rgb[2]) return false
    this.bgRgb = rgb
    this.invalidateCache()
    return true
  }

  render(frameBuffer: OptimizedBuffer, deltaTime: number) {
    this.elapsed = (this.elapsed + deltaTime) % (this.curve.durationMs * 2)
    this.rebuildGeometry(frameBuffer)
    this.drawCached(frameBuffer)
  }

  private invalidateCache() {
    this.cacheDirty = true
    this.cacheBuildIndex = 0
    this.frameCache = []
  }

  private rebuildGeometry(frameBuffer: OptimizedBuffer) {
    const w = frameBuffer.width
    const h = frameBuffer.height
    if (w === this.geometryWidth && h === this.geometryHeight && !this.cacheDirty) return
    this.geometryWidth = w
    this.geometryHeight = h
    this.invalidateCache()
  }

  private drawCached(frameBuffer: OptimizedBuffer) {
    if (this.cacheDirty) {
      this.frameCache = []
      this.cacheBuildIndex = 0
      this.cacheDirty = false
    }

    // Build cache incrementally — 2 frames per render call to avoid stalls
    if (this.cacheBuildIndex < this.cacheCount) {
      const end = Math.min(this.cacheCount, this.cacheBuildIndex + 2)
      for (; this.cacheBuildIndex < end; this.cacheBuildIndex++) {
        const t = (this.cacheBuildIndex / this.cacheCount) * this.curve.durationMs
        this.drawFrame(frameBuffer, t)
        this.frameCache.push({
          fg: new Uint16Array(frameBuffer.buffers.fg),
          bg: new Uint16Array(frameBuffer.buffers.bg),
          char: new Uint32Array(frameBuffer.buffers.char),
        })
      }
      // Draw current frame directly during cache build
      this.drawFrame(frameBuffer, this.elapsed)
      return
    }

    // Cache ready — lookup
    const frame = this.frameCache[Math.floor((this.elapsed / this.curve.durationMs) * this.cacheCount) % this.cacheCount]
    if (frame) {
      frameBuffer.buffers.fg.set(frame.fg)
      frameBuffer.buffers.bg.set(frame.bg)
      frameBuffer.buffers.char.set(frame.char)
    }
  }

  private drawFrame(frameBuffer: OptimizedBuffer, time: number) {
    const buffers = frameBuffer.buffers
    const char = buffers.char
    const fg = buffers.fg
    const bg = buffers.bg
    const w = this.geometryWidth
    const h = this.geometryHeight
    const cellCount = w * h

    // Clear: fill with spaces and background color
    char.fill(SPACE)
    for (let i = 0; i < cellCount; i++) {
      const off = i * 4
      writeRgb(bg, off, this.bgRgb[0], this.bgRgb[1], this.bgRgb[2])
      writeRgb(fg, off, this.bgRgb[0], this.bgRgb[1], this.bgRgb[2])
    }

    // Compute particle positions
    const particles = computeParticles(this.curve, time, this.phaseOffset, w, h * 2)

    // Each particle maps to a sub-cell: top half or bottom half of a cell
    // Particle y in 0..1 → screen y in 0..(h*2-1)
    for (const p of particles) {
      const sx = p.x * w
      const sy = p.y * (h * 2)
      const cellX = Math.floor(sx)
      const cellY = Math.floor(sy / 2)
      if (cellX < 0 || cellX >= w || cellY < 0 || cellY >= h) continue

      const isTopHalf = (sy % 2) < 1
      const index = cellY * w + cellX
      const offset = index * 4
      const alpha = p.opacity

      // Mix particle color with whatever is already there
      const existingFgR = fg[offset]!
      const existingFgG = fg[offset + 1]!
      const existingFgB = fg[offset + 2]!
      const existingBgR = bg[offset]!
      const existingBgG = bg[offset + 1]!
      const existingBgB = bg[offset + 2]!

      const pr = mixChannel(this.bgRgb[0]!, this.primaryRgb[0]!, alpha)
      const pg = mixChannel(this.bgRgb[1]!, this.primaryRgb[1]!, alpha)
      const pb = mixChannel(this.bgRgb[2]!, this.primaryRgb[2]!, alpha)

      const existingChar = char[index]!

      if (existingChar === SPACE) {
        // Empty cell — set half-block
        char[index] = isTopHalf ? TOP_HALF : BOTTOM_HALF
        if (isTopHalf) {
          // Top half = foreground
          writeRgb(fg, offset, pr, pg, pb)
        } else {
          // Bottom half = background (in terminal, ▄ shows bg as top)
          writeRgb(bg, offset, pr, pg, pb)
        }
      } else if (existingChar === TOP_HALF) {
        if (!isTopHalf) {
          // We have top half, now add bottom half → full block
          char[index] = FULL_BLOCK
          writeRgb(bg, offset, mixChannel(existingBgR, pr, 0.5), mixChannel(existingBgG, pg, 0.5), mixChannel(existingBgB, pb, 0.5))
        } else {
          // Strengthen top
          writeRgb(fg, offset, mixChannel(existingFgR, pr, 0.5), mixChannel(existingFgG, pg, 0.5), mixChannel(existingFgB, pb, 0.5))
        }
      } else if (existingChar === BOTTOM_HALF) {
        if (isTopHalf) {
          char[index] = FULL_BLOCK
          writeRgb(fg, offset, mixChannel(existingFgR, pr, 0.5), mixChannel(existingFgG, pg, 0.5), mixChannel(existingFgB, pb, 0.5))
        } else {
          writeRgb(bg, offset, mixChannel(existingBgR, pr, 0.5), mixChannel(existingBgG, pg, 0.5), mixChannel(existingBgB, pb, 0.5))
        }
      } else if (existingChar === FULL_BLOCK) {
        // Already full — mix both
        writeRgb(fg, offset, mixChannel(existingFgR, pr, 0.5), mixChannel(existingFgG, pg, 0.5), mixChannel(existingFgB, pb, 0.5))
        writeRgb(bg, offset, mixChannel(existingBgR, pr, 0.5), mixChannel(existingBgG, pg, 0.5), mixChannel(existingBgB, pb, 0.5))
      }
    }
  }
}

// ─── Renderable ──────────────────────────────────────────

type CurveSpinnerOptions = RenderableOptions<FrameBufferRenderable> & {
  curve?: CurveName
  primary?: RGBA
  background?: RGBA
}

class CurveSpinnerRenderable extends FrameBufferRenderable {
  private painter: CurveSpinnerPainter

  constructor(ctx: RenderContext, options: CurveSpinnerOptions = {}) {
    const width = typeof options.width === "number" ? options.width : 1
    const height = typeof options.height === "number" ? options.height : 1
    super(ctx, {
      ...options,
      width,
      height,
      live: options.live ?? true,
      respectAlpha: false,
    })

    this.painter = new CurveSpinnerPainter(options.curve ?? "rose")
    if (options.primary) this.painter.setPrimary(toRgb(options.primary))
    if (options.background) this.painter.setBackground(toRgb(options.background))
  }

  set curve(value: CurveName) {
    if (this.painter.setCurve(value)) this.requestRender()
  }

  set primary(value: RGBA) {
    if (this.painter.setPrimary(toRgb(value))) this.requestRender()
  }

  set background(value: RGBA) {
    if (this.painter.setBackground(toRgb(value))) this.requestRender()
  }

  protected override renderSelf(buffer: OptimizedBuffer, deltaTime = 0): void {
    if (!this.visible || this.isDestroyed) return
    this.painter.render(this.frameBuffer, deltaTime)
    super.renderSelf(buffer)
  }
}

function toRgb(color: RGBA): Rgb {
  const ints = color.toInts()
  return [ints[0]!, ints[1]!, ints[2]!]
}

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    curve_spinner: typeof CurveSpinnerRenderable
  }
}

extend({ curve_spinner: CurveSpinnerRenderable })

// ─── Solid component ─────────────────────────────────────

export function CurveSpinner(props: {
  curve?: CurveName
  color?: RGBA
  width?: number
  height?: number
}) {
  const { theme } = useTheme()

  return (
    <curve_spinner
      width={props.width ?? 3}
      height={props.height ?? 1}
      curve={props.curve ?? "rose"}
      primary={props.color ?? theme.primary}
      background={tint(theme.background, theme.text, 0)}
      live
    />
  )
}
