import {
  FrameBufferRenderable,
  RGBA,
  type OptimizedBuffer,
  type RenderContext,
  type RenderableOptions,
} from "@opentui/core"
import { extend } from "@opentui/solid"
import { tint, useTheme } from "../context/theme"
import { getIconPixelData, type IconName } from "../util/icon-pixel-data"

const SPACE = " ".codePointAt(0)!

type Rgb = [number, number, number]

function toRgb(color: RGBA): Rgb {
  const ints = color.toInts()
  return [ints[0]!, ints[1]!, ints[2]!]
}

function sameRgb(a: Rgb, b: Rgb) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
}

/**
 * Renders a pixel icon onto a FrameBuffer using drawGrayscaleBufferSupersampled.
 * Each icon is 2×1 cell (2 wide, 1 tall). The pixel data is 12×24 (6x horizontal,
 * 12x vertical supersample) producing smooth anti-aliased lines.
 */
class PixelIconPainter {
  private icon: IconName
  private fgRgb: Rgb = [255, 255, 255]
  private bgRgb: Rgb = [0, 0, 0]
  private fgRgba: RGBA | null = null
  private bgRgba: RGBA | null = null
  private data: ReturnType<typeof getIconPixelData>
  private dirty = true

  constructor(icon: IconName) {
    this.icon = icon
    this.data = getIconPixelData(icon)
  }

  setIcon(name: IconName) {
    if (this.icon === name) return false
    this.icon = name
    this.data = getIconPixelData(name)
    this.dirty = true
    return true
  }

  setFg(rgb: Rgb) {
    if (sameRgb(this.fgRgb, rgb)) return false
    this.fgRgb = rgb
    this.fgRgba = RGBA.fromValues(rgb[0], rgb[1], rgb[2], 255)
    this.dirty = true
    return true
  }

  setBg(rgb: Rgb) {
    if (sameRgb(this.bgRgb, rgb)) return false
    this.bgRgb = rgb
    this.bgRgba = RGBA.fromValues(rgb[0], rgb[1], rgb[2], 255)
    this.dirty = true
    return true
  }

  render(frameBuffer: OptimizedBuffer) {
    if (this.dirty || !this.fgRgba) {
      this.fgRgba = RGBA.fromValues(this.fgRgb[0], this.fgRgb[1], this.fgRgb[2], 255)
      this.bgRgba = RGBA.fromValues(this.bgRgb[0], this.bgRgb[1], this.bgRgb[2], 255)
      this.dirty = false
    }

    // Clear the buffer to background
    frameBuffer.buffers.char.fill(SPACE)
    const bg = frameBuffer.buffers.bg
    const fg = frameBuffer.buffers.fg
    const w = frameBuffer.width
    const h = frameBuffer.height
    for (let i = 0; i < w * h; i++) {
      const off = i * 4
      bg[off] = this.bgRgb[0]!
      bg[off + 1] = this.bgRgb[1]!
      bg[off + 2] = this.bgRgb[2]!
      bg[off + 3] = 255
      fg[off] = this.bgRgb[0]!
      fg[off + 1] = this.bgRgb[1]!
      fg[off + 2] = this.bgRgb[2]!
      fg[off + 3] = 255
    }

    // Draw icon using supersampled grayscale buffer
    frameBuffer.drawGrayscaleBufferSupersampled(
      0, 0,
      this.data.intensities,
      this.data.width,
      this.data.height,
      this.fgRgba,
      null, // transparent background — let the terminal bg show through
    )
  }
}

// ─── Renderable ──────────────────────────────────────────

type PixelIconOptions = RenderableOptions<FrameBufferRenderable> & {
  icon?: IconName
  fg?: RGBA
  bg?: RGBA
}

class PixelIconRenderable extends FrameBufferRenderable {
  private painter: PixelIconPainter

  constructor(ctx: RenderContext, options: PixelIconOptions = {}) {
    const width = typeof options.width === "number" ? options.width : 2
    const height = typeof options.height === "number" ? options.height : 1
    super(ctx, {
      ...options,
      width,
      height,
      live: false,
      respectAlpha: true,
    })

    this.painter = new PixelIconPainter(options.icon ?? "generic")
    if (options.fg) this.painter.setFg(toRgb(options.fg))
    if (options.bg) this.painter.setBg(toRgb(options.bg))
  }

  set icon(value: IconName) {
    if (this.painter.setIcon(value)) this.requestRender()
  }

  set fg(value: RGBA) {
    if (this.painter.setFg(toRgb(value))) this.requestRender()
  }

  set bg(value: RGBA) {
    if (this.painter.setBg(toRgb(value))) this.requestRender()
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    if (!this.visible || this.isDestroyed) return
    this.painter.render(this.frameBuffer)
    super.renderSelf(buffer)
  }
}

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    pixel_icon: typeof PixelIconRenderable
  }
}

extend({ pixel_icon: PixelIconRenderable })

// ─── Solid component ─────────────────────────────────────

export function PixelIcon(props: {
  icon: IconName
  fg?: RGBA
  size?: "sm" | "md"
}) {
  const { theme } = useTheme()

  return (
    <pixel_icon
      width={2}
      height={1}
      icon={props.icon}
      fg={props.fg ?? theme.textMuted}
      bg={tint(theme.background, theme.text, 0)}
    />
  )
}
