import {
  FrameBufferRenderable,
  RGBA,
  type OptimizedBuffer,
  type RenderContext,
  type RenderableOptions,
} from "@opentui/core"
import { extend, useRenderer } from "@opentui/solid"
import { createEffect, createMemo, onCleanup, onMount, Show } from "solid-js"
import { tint, useTheme } from "../context/theme"
import { useKV } from "../context/kv"
import { GoUpsellArtPainter } from "./bg-pulse-render"

type GoUpsellArtOptions = RenderableOptions<FrameBufferRenderable> & {
  backgroundPanel?: RGBA
  primary?: RGBA
  logoBase?: RGBA
}

class GoUpsellArtRenderable extends FrameBufferRenderable {
  private painter = new GoUpsellArtPainter()

  constructor(ctx: RenderContext, options: GoUpsellArtOptions = {}) {
    const width = typeof options.width === "number" ? options.width : 1
    const height = typeof options.height === "number" ? options.height : 1
    super(ctx, {
      ...options,
      width,
      height,
      live: options.live ?? true,
      respectAlpha: false,
    })

    if (options.width !== undefined && typeof options.width !== "number") this.width = options.width
    if (options.height !== undefined && typeof options.height !== "number") this.height = options.height
    this.painter.setBackgroundPanel(options.backgroundPanel)
    this.painter.setPrimary(options.primary)
    this.painter.setLogoBase(options.logoBase)
  }

  set backgroundPanel(value: RGBA | undefined) {
    if (this.painter.setBackgroundPanel(value)) this.requestRender()
  }

  set logoBase(value: RGBA | undefined) {
    if (this.painter.setLogoBase(value)) this.requestRender()
  }

  set primary(value: RGBA | undefined) {
    if (this.painter.setPrimary(value)) this.requestRender()
  }

  protected override renderSelf(buffer: OptimizedBuffer, deltaTime = 0): void {
    if (!this.visible || this.isDestroyed) return

    this.painter.render(this.frameBuffer, {
      deltaTime,
      rgb: this._ctx.capabilities?.rgb === true,
    })
    super.renderSelf(buffer)
  }
}

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    go_upsell_art: typeof GoUpsellArtRenderable
  }
}

extend({ go_upsell_art: GoUpsellArtRenderable })

export function BgPulse() {
  const { theme } = useTheme()
  const renderer = useRenderer()
  const kv = useKV()
  // Honor the global animations_enabled toggle so users who disable
  // animations don't pay the FPS lock or per-frame paint cost.
  const animationsEnabled = createMemo(() => kv.get("animations_enabled", true))
  let targetFps = renderer.targetFps
  let maxFps = renderer.maxFps
  let locked = false

  const lockFps = () => {
    if (locked) return
    targetFps = renderer.targetFps
    maxFps = renderer.maxFps
    // Cap at 15fps instead of 30: the pulse is a slow ambient gradient, so
    // the extra frames are imperceptible while the per-frame full-screen
    // paint cost is halved.
    renderer.targetFps = 15
    renderer.maxFps = 15
    locked = true
  }

  const restoreFps = () => {
    if (!locked) return
    renderer.targetFps = targetFps
    renderer.maxFps = maxFps
    locked = false
  }

  onMount(() => {
    if (animationsEnabled()) lockFps()
  })

  // React to toggle changes while mounted.
  createEffect(() => {
    if (animationsEnabled()) {
      lockFps()
    } else {
      restoreFps()
    }
  })

  onCleanup(restoreFps)

  return (
    <Show when={animationsEnabled()}>
      <go_upsell_art
        width="100%"
        height="100%"
        backgroundPanel={theme.backgroundPanel}
        primary={theme.primary}
        logoBase={tint(theme.background, theme.text, 0.62)}
        live
      />
    </Show>
  )
}
