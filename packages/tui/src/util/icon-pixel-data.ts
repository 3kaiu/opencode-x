/**
 * Icon pixel data generator — distance-field based anti-aliased line icons.
 *
 * Each icon is rendered as a Float32Array of intensities (0.0–1.0) on a
 * high-resolution sampling grid. The intensity at each sample point is
 * computed from the distance to the nearest stroke, producing smooth
 * anti-aliased curves when downsampled by drawGrayscaleBufferSupersampled.
 *
 * Style: Lucide / Phosphor inspired — thin strokes (1.5px), rounded caps,
 * 24×24 viewBox feel, scaled to fit our sampling grid.
 *
 * Sampling grid: ICON_W × ICON_H (e.g. 12×24 for 2×1 cell at 4×/8× supersample)
 */

export type IconPixelData = {
  width: number
  height: number
  intensities: Float32Array
}

// ─── distance field helpers ──────────────────────────────

/**
 * Distance from point (px,py) to line segment (x1,y1)-(x2,y2).
 */
function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const lenSq = dx * dx + dy * dy
  if (lenSq < 0.0001) return Math.hypot(px - x1, py - y1)
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

/**
 * Distance from point to a circular arc.
 * Arc center (cx,cy), radius r, from angle a0 to a1 (radians, clockwise).
 */
function distToArc(px: number, py: number, cx: number, cy: number, r: number, a0: number, a1: number): number {
  const dx = px - cx
  const dy = py - cy
  const dist = Math.hypot(dx, dy)
  let angle = Math.atan2(dy, dx)
  // normalize angle to be within [a0, a1] range
  while (angle < a0) angle += Math.PI * 2
  while (angle > a1 + Math.PI * 2) angle -= Math.PI * 2
  if (angle >= a0 && angle <= a1) {
    return Math.abs(dist - r)
  }
  // outside arc range — distance to nearest endpoint
  const ex0 = cx + Math.cos(a0) * r
  const ey0 = cy + Math.sin(a0) * r
  const ex1 = cx + Math.cos(a1) * r
  const ey1 = cy + Math.sin(a1) * r
  return Math.min(Math.hypot(px - ex0, py - ey0), Math.hypot(px - ex1, py - ey1))
}

/**
 * Distance from point to a circle outline.
 */
function distToCircle(px: number, py: number, cx: number, cy: number, r: number): number {
  return Math.abs(Math.hypot(px - cx, py - cy) - r)
}

/**
 * Distance from point to a filled circle (0 inside, distance outside).
 */
function distToFilledCircle(px: number, py: number, cx: number, cy: number, r: number): number {
  return Math.max(0, Math.hypot(px - cx, py - cy) - r)
}

// ─── stroke → intensity ──────────────────────────────────

const STROKE_WIDTH = 1.4
const AA_RANGE = 1.1

/**
 * Convert distance to stroke into intensity (0..1).
 * 0 = on the stroke center, intensity = 1.0
 * Beyond stroke_width/2 + AA_RANGE, intensity = 0
 */
function strokeIntensity(dist: number, halfWidth: number = STROKE_WIDTH / 2): number {
  const edge = halfWidth + AA_RANGE
  if (dist <= halfWidth - AA_RANGE) return 1
  if (dist >= edge) return 0
  // smoothstep anti-aliasing
  const t = (edge - dist) / (AA_RANGE * 2)
  return t * t * (3 - 2 * t)
}

/**
 * Combine two intensity values (max blend).
 */
function blendMax(a: number, b: number): number {
  return a > b ? a : b
}

// ─── sampling grid ───────────────────────────────────────
// We use a 12×24 grid (maps to 2×1 terminal cells at 6× horizontal, 12× vertical supersample)
// But for better quality we go higher: 16×24 for 2×1, 8×24 for 1×1

export const ICON_GRID_W = 12
export const ICON_GRID_H = 24

type Point = { x: number; y: number }

type DrawFn = (px: number, py: number) => number

function renderGrid(drawFn: DrawFn, w: number = ICON_GRID_W, h: number = ICON_GRID_H): IconPixelData {
  const intensities = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      intensities[y * w + x] = drawFn(x, y)
    }
  }
  return { width: w, height: h, intensities }
}

// ─── icon drawing functions ──────────────────────────────
// All coordinates are in the ICON_GRID_W × ICON_GRID_H space (12×24 by default).
// The icons are designed to look good in a 2×1 cell (2 wide, 1 tall).
// For 1×1 cell icons, we use ICON_GRID_W=6.

/** Lucide-style check: short downstroke + long upstroke, rounded caps */
function drawCheck(px: number, py: number): number {
  // Coordinates in 12×24 grid (aspect ~1:2 per cell, so we center vertically)
  // Check mark: from (3, 13) down to (5, 15) then up to (9, 9)
  const d1 = distToSegment(px, py, 3, 13, 5, 15)
  const d2 = distToSegment(px, py, 5, 15, 9, 9)
  return blendMax(strokeIntensity(d1), strokeIntensity(d2))
}

/** Lucide-style circle-dot (idle): ring + center filled dot — "alive but waiting" */
function drawCircleDot(px: number, py: number): number {
  const dRing = distToCircle(px, py, 6, 12, 4.5)
  const dDot = distToFilledCircle(px, py, 6, 12, 1.0)
  return blendMax(strokeIntensity(dRing), strokeIntensity(dDot))
}

/** Lucide-style circle-x (error): ring with X inside — "blocked/failed" */
function drawCircleX(px: number, py: number): number {
  const dRing = distToCircle(px, py, 6, 12, 5)
  // X inside the circle, smaller and centered
  const d1 = distToSegment(px, py, 4, 10, 8, 14)
  const d2 = distToSegment(px, py, 8, 10, 4, 14)
  let r = strokeIntensity(dRing)
  r = blendMax(r, strokeIntensity(d1, STROKE_WIDTH / 2 * 0.8))
  r = blendMax(r, strokeIntensity(d2, STROKE_WIDTH / 2 * 0.8))
  return r
}

/** Lucide-style loader / spinner: 3/4 arc with gap at top */
function drawLoader(px: number, py: number): number {
  // Arc from 30° to 330° (gap at top), center (6,12), radius 4.5
  const d = distToArc(px, py, 6, 12, 4.5, Math.PI * 0.15, Math.PI * 1.85)
  return strokeIntensity(d)
}

/** Lucide-style refresh: circular arrow with arrowhead */
function drawRefresh(px: number, py: number): number {
  // Arc from -60° to 210° (most of a circle, gap at top-right)
  const dArc = distToArc(px, py, 6, 12, 4.5, Math.PI * (-0.33), Math.PI * 1.16)
  // Arrowhead: short line at the end of the arc pointing down-left
  // End of arc at angle 210° = (6 + 4.5*cos(210°), 12 + 4.5*sin(210°)) = (6-3.9, 12-2.25) = (2.1, 9.75)
  const dArrow = distToSegment(px, py, 2.1, 9.75, 1.5, 11.5)
  return blendMax(strokeIntensity(dArc), strokeIntensity(dArrow))
}

/** Lucide-style terminal/prompt: chevron + line */
function drawTerminal(px: number, py: number): number {
  // Chevron: (3, 9) → (5.5, 12) → (3, 15)
  const d1 = distToSegment(px, py, 3, 9, 5.5, 12)
  const d2 = distToSegment(px, py, 5.5, 12, 3, 15)
  // Short underline
  const d3 = distToSegment(px, py, 7, 15, 9.5, 15)
  return blendMax(blendMax(strokeIntensity(d1), strokeIntensity(d2)), strokeIntensity(d3))
}

/** Lucide-style search: circle + diagonal handle */
function drawSearch(px: number, py: number): number {
  // Circle center (5, 11), radius 3
  const dCircle = distToCircle(px, py, 5, 11, 3)
  // Handle: from (7.2, 13.2) to (9.5, 15.5)
  const dHandle = distToSegment(px, py, 7.2, 13.2, 9.5, 15.5)
  return blendMax(strokeIntensity(dCircle), strokeIntensity(dHandle))
}

/** Lucide-style folder-search (glob): folder outline + magnifier inside */
function drawFolderSearch(px: number, py: number): number {
  // Folder top tab: (2, 7) → (4.5, 7) → (5.5, 8) → (10, 8)
  const dTab1 = distToSegment(px, py, 2, 7, 4.5, 7)
  const dTab2 = distToSegment(px, py, 4.5, 7, 5.5, 8)
  const dTab3 = distToSegment(px, py, 5.5, 8, 10, 8)
  // Folder bottom: (2, 8) → (2, 17) → (10, 17) → (10, 8)
  const dLeft = distToSegment(px, py, 2, 8, 2, 17)
  const dBot = distToSegment(px, py, 2, 17, 10, 17)
  const dRight = distToSegment(px, py, 10, 17, 10, 8)
  // Magnifier circle inside folder (smaller, at center-bottom)
  const dCircle = distToCircle(px, py, 5, 14, 1.8)
  // Magnifier handle
  const dHandle = distToSegment(px, py, 6.3, 15.3, 7.5, 16.5)
  let r = blendMax(strokeIntensity(dTab1), strokeIntensity(dTab2))
  r = blendMax(r, strokeIntensity(dTab3))
  r = blendMax(r, strokeIntensity(dLeft))
  r = blendMax(r, strokeIntensity(dBot))
  r = blendMax(r, strokeIntensity(dRight))
  r = blendMax(r, strokeIntensity(dCircle, STROKE_WIDTH / 2 * 0.7))
  r = blendMax(r, strokeIntensity(dHandle, STROKE_WIDTH / 2 * 0.7))
  return r
}

/** Lucide-style globe (webfetch): circle + meridians — "network/world" */
function drawGlobe(px: number, py: number): number {
  // Outer circle
  const dOuter = distToCircle(px, py, 6, 12, 5)
  // Vertical meridian (ellipse-like — simplified as vertical line)
  const dMeridian = distToSegment(px, py, 6, 7, 6, 17)
  // Horizontal equator
  const dEquator = distToSegment(px, py, 1, 12, 11, 12)
  // Left arc (latitude curve)
  const dLeftArc = distToArc(px, py, 6, 12, 3.5, Math.PI * 0.6, Math.PI * 1.4)
  // Right arc (latitude curve)
  const dRightArc = distToArc(px, py, 6, 12, 3.5, Math.PI * -0.4, Math.PI * 0.4)
  let r = blendMax(strokeIntensity(dOuter), strokeIntensity(dMeridian))
  r = blendMax(r, strokeIntensity(dEquator))
  r = blendMax(r, strokeIntensity(dLeftArc, STROKE_WIDTH / 2 * 0.7))
  r = blendMax(r, strokeIntensity(dRightArc, STROKE_WIDTH / 2 * 0.7))
  return r
}

/** Lucide-style globe-search (websearch): globe outline + magnifier — "search the web" */
function drawGlobeSearch(px: number, py: number): number {
  // Globe circle (smaller, upper area)
  const dGlobe = distToCircle(px, py, 5, 10, 3.5)
  // Vertical meridian
  const dMeridian = distToSegment(px, py, 5, 6.5, 5, 13.5)
  // Horizontal equator
  const dEquator = distToSegment(px, py, 1.5, 10, 8.5, 10)
  // Magnifier handle (lower-right)
  const dHandle = distToSegment(px, py, 7.5, 14.5, 10, 17)
  let r = blendMax(strokeIntensity(dGlobe), strokeIntensity(dMeridian, STROKE_WIDTH / 2 * 0.7))
  r = blendMax(r, strokeIntensity(dEquator, STROKE_WIDTH / 2 * 0.7))
  r = blendMax(r, strokeIntensity(dHandle))
  return r
}

/** Lucide-style pencil/edit */
function drawPencil(px: number, py: number): number {
  // Pencil: diagonal line from top-right to bottom-left
  // Main shaft: (8.5, 7.5) → (4, 14)
  const d1 = distToSegment(px, py, 8.5, 7.5, 4.5, 13.5)
  // Tip: (4.5, 13.5) → (3.5, 15.5)
  const d2 = distToSegment(px, py, 4.5, 13.5, 3.5, 15.5)
  // Top edge: (8.5, 7.5) → (9.5, 8.5) (eraser end)
  const d3 = distToSegment(px, py, 8.5, 7.5, 9.5, 8.5)
  let result = blendMax(strokeIntensity(d1), strokeIntensity(d2))
  result = blendMax(result, strokeIntensity(d3))
  return result
}

/** Lucide-style play/triangle */
function drawPlay(px: number, py: number): number {
  // Filled triangle: (4, 8) → (4, 16) → (9, 12)
  // Use distance to the three edges, and check if inside
  const d1 = distToSegment(px, py, 4, 8, 4, 16)
  const d2 = distToSegment(px, py, 4, 16, 9, 12)
  const d3 = distToSegment(px, py, 9, 12, 4, 8)
  const minDist = Math.min(d1, d2, d3)
  // Check if inside triangle (barycentric)
  const s = (9 - 4) * (py - 8) - (12 - 8) * (px - 4)
  const inside = s >= 0 && (4 - 9) * (py - 16) - (8 - 16) * (px - 9) >= 0 && (4 - 4) * (py - 8) - (16 - 8) * (px - 4) >= 0
  if (inside) return 1
  return strokeIntensity(minDist, STROKE_WIDTH / 2)
}

/** Lucide-style file-diff (apply_patch): file outline with + and - lines */
function drawFileDiff(px: number, py: number): number {
  // File outline: (3, 7) → (8, 7) → (10, 9) → (10, 17) → (3, 17) → (3, 7)
  const dTop = distToSegment(px, py, 3, 7, 8, 7)
  const dFold = distToSegment(px, py, 8, 7, 10, 9)
  const dRight = distToSegment(px, py, 10, 9, 10, 17)
  const dBot = distToSegment(px, py, 10, 17, 3, 17)
  const dLeft = distToSegment(px, py, 3, 17, 3, 7)
  // Plus line (added): (4, 10) → (7, 10) and vertical (5.5, 9) → (5.5, 11)
  const dPlusH = distToSegment(px, py, 4, 10, 7, 10)
  const dPlusV = distToSegment(px, py, 5.5, 8.5, 5.5, 11.5)
  // Minus line (removed): (4, 13) → (7, 13)
  const dMinus = distToSegment(px, py, 4, 13, 7, 13)
  // Neutral line: (4, 16) → (7, 16)
  const dNeutral = distToSegment(px, py, 4, 16, 7, 16)
  let r = blendMax(strokeIntensity(dTop), strokeIntensity(dFold))
  r = blendMax(r, strokeIntensity(dRight))
  r = blendMax(r, strokeIntensity(dBot))
  r = blendMax(r, strokeIntensity(dLeft))
  r = blendMax(r, strokeIntensity(dPlusH, STROKE_WIDTH / 2 * 0.7))
  r = blendMax(r, strokeIntensity(dPlusV, STROKE_WIDTH / 2 * 0.7))
  r = blendMax(r, strokeIntensity(dMinus, STROKE_WIDTH / 2 * 0.7))
  r = blendMax(r, strokeIntensity(dNeutral, STROKE_WIDTH / 2 * 0.7))
  return r
}

/** Lucide-style check-square: square outline + check */
function drawCheckSquare(px: number, py: number): number {
  // Square outline: (3, 8) → (9, 8) → (9, 16) → (3, 16) → (3, 8)
  const d1 = distToSegment(px, py, 3, 8, 9, 8)
  const d2 = distToSegment(px, py, 9, 8, 9, 16)
  const d3 = distToSegment(px, py, 9, 16, 3, 16)
  const d4 = distToSegment(px, py, 3, 16, 3, 8)
  // Check inside: (4.5, 12) → (6, 14) → (8, 9.5)
  const d5 = distToSegment(px, py, 4.5, 12, 6, 14)
  const d6 = distToSegment(px, py, 6, 14, 8, 9.5)
  let result = blendMax(strokeIntensity(d1), strokeIntensity(d2))
  result = blendMax(result, strokeIntensity(d3))
  result = blendMax(result, strokeIntensity(d4))
  result = blendMax(result, strokeIntensity(d5, STROKE_WIDTH / 2 * 0.8))
  result = blendMax(result, strokeIntensity(d6, STROKE_WIDTH / 2 * 0.8))
  return result
}

/** Lucide-style help/question: arc + dot */
function drawHelp(px: number, py: number): number {
  // Top arc: question mark curve
  const dArc = distToArc(px, py, 6, 10, 2.5, Math.PI * 0.2, Math.PI * 1.3)
  // Stem: from arc end down
  const dStem = distToSegment(px, py, 6 + 2.5 * Math.cos(Math.PI * 1.3), 10 + 2.5 * Math.sin(Math.PI * 1.3), 6, 14.5)
  // Dot
  const dDot = distToFilledCircle(px, py, 6, 17, 0.7)
  let result = blendMax(strokeIntensity(dArc), strokeIntensity(dStem))
  result = blendMax(result, strokeIntensity(dDot))
  return result
}

/** Lucide-style git-branch: line + two circles */
function drawBranch(px: number, py: number): number {
  // Vertical line: (4, 8) → (4, 16)
  const dLine = distToSegment(px, py, 4, 8, 4, 16)
  // Top circle: center (4, 8.5), r=1.2 (filled)
  const dTop = distToFilledCircle(px, py, 4, 8.5, 1.2)
  // Curved branch: from (4, 13) curve to (8, 10)
  const dArc = distToArc(px, py, 6, 14, 3.5, Math.PI * 1.0, Math.PI * 1.7)
  // Bottom-right circle: center (8, 10), r=1.2 (filled)
  const dBot = distToFilledCircle(px, py, 8.5, 9.5, 1.2)
  let result = blendMax(strokeIntensity(dLine), strokeIntensity(dTop))
  result = blendMax(result, strokeIntensity(dArc))
  result = blendMax(result, strokeIntensity(dBot))
  return result
}

/** Lucide-style alert-triangle: triangle outline + exclamation */
function drawAlert(px: number, py: number): number {
  // Triangle: (6, 7) → (10, 16) → (2, 16) → (6, 7)
  const d1 = distToSegment(px, py, 6, 7, 10, 16)
  const d2 = distToSegment(px, py, 10, 16, 2, 16)
  const d3 = distToSegment(px, py, 2, 16, 6, 7)
  // Exclamation line: (6, 11) → (6, 14)
  const dExcl = distToSegment(px, py, 6, 11, 6, 14)
  // Dot
  const dDot = distToFilledCircle(px, py, 6, 15.5, 0.6)
  let result = blendMax(strokeIntensity(d1), strokeIntensity(d2))
  result = blendMax(result, strokeIntensity(d3))
  result = blendMax(result, strokeIntensity(dExcl, STROKE_WIDTH / 2 * 0.7))
  result = blendMax(result, strokeIntensity(dDot))
  return result
}

/** Lucide-style command (generic): four corner squares forming a command box */
function drawCommand(px: number, py: number): number {
  // Four small corner squares (quarter circles at corners)
  const r = 1.5
  // Top-left corner: quarter circle arc from π to 1.5π
  const dTL = distToArc(px, py, 3.5, 8.5, r, Math.PI, Math.PI * 1.5)
  // Top-right corner: quarter circle arc from 1.5π to 2π
  const dTR = distToArc(px, py, 8.5, 8.5, r, Math.PI * 1.5, Math.PI * 2)
  // Bottom-right corner: quarter circle arc from 0 to 0.5π
  const dBR = distToArc(px, py, 8.5, 15.5, r, 0, Math.PI * 0.5)
  // Bottom-left corner: quarter circle arc from 0.5π to π
  const dBL = distToArc(px, py, 3.5, 15.5, r, Math.PI * 0.5, Math.PI)
  let result = blendMax(strokeIntensity(dTL), strokeIntensity(dTR))
  result = blendMax(result, strokeIntensity(dBR))
  result = blendMax(result, strokeIntensity(dBL))
  return result
}

/** Small filled circle — used for "dot" indicator (status badges, separators) */
function drawDot(px: number, py: number): number {
  return strokeIntensity(distToFilledCircle(px, py, 6, 12, 1.2))
}

/** Lucide-style chevron-down (collapse open): downward angle bracket */
function drawChevronDown(px: number, py: number): number {
  const d1 = distToSegment(px, py, 3, 10, 6, 14)
  const d2 = distToSegment(px, py, 6, 14, 9, 10)
  return blendMax(strokeIntensity(d1), strokeIntensity(d2))
}

/** Lucide-style chevron-right (collapse closed): rightward angle bracket */
function drawChevronRightSmall(px: number, py: number): number {
  const d1 = distToSegment(px, py, 4, 8, 8, 12)
  const d2 = distToSegment(px, py, 8, 12, 4, 16)
  return blendMax(strokeIntensity(d1), strokeIntensity(d2))
}

/** Lucide-style arrow-up */
function drawArrowUp(px: number, py: number): number {
  // Vertical line: (6, 7) → (6, 15)
  const dLine = distToSegment(px, py, 6, 7, 6, 15)
  // Arrowhead: (3.5, 10) → (6, 7) → (8.5, 10)
  const dLeft = distToSegment(px, py, 3.5, 10, 6, 7)
  const dRight = distToSegment(px, py, 6, 7, 8.5, 10)
  let r = blendMax(strokeIntensity(dLine), strokeIntensity(dLeft))
  r = blendMax(r, strokeIntensity(dRight))
  return r
}

/** Lucide-style arrow-down */
function drawArrowDownNav(px: number, py: number): number {
  // Vertical line: (6, 7) → (6, 15)
  const dLine = distToSegment(px, py, 6, 7, 6, 15)
  // Arrowhead: (3.5, 12) → (6, 15) → (8.5, 12)
  const dLeft = distToSegment(px, py, 3.5, 12, 6, 15)
  const dRight = distToSegment(px, py, 6, 15, 8.5, 12)
  let r = blendMax(strokeIntensity(dLine), strokeIntensity(dLeft))
  r = blendMax(r, strokeIntensity(dRight))
  return r
}

/** Lucide-style arrow-left */
function drawArrowLeft(px: number, py: number): number {
  // Horizontal line: (3, 12) → (11, 12)
  const dLine = distToSegment(px, py, 3, 12, 11, 12)
  // Arrowhead: (6, 9) → (3, 12) → (6, 15)
  const dTop = distToSegment(px, py, 6, 9, 3, 12)
  const dBot = distToSegment(px, py, 3, 12, 6, 15)
  let r = blendMax(strokeIntensity(dLine), strokeIntensity(dTop))
  r = blendMax(r, strokeIntensity(dBot))
  return r
}

/** Lucide-style arrow-right */
function drawArrowRight(px: number, py: number): number {
  // Horizontal line: (3, 12) → (11, 12)
  const dLine = distToSegment(px, py, 3, 12, 11, 12)
  // Arrowhead: (8, 9) → (11, 12) → (8, 15)
  const dTop = distToSegment(px, py, 8, 9, 11, 12)
  const dBot = distToSegment(px, py, 11, 12, 8, 15)
  let r = blendMax(strokeIntensity(dLine), strokeIntensity(dTop))
  r = blendMax(r, strokeIntensity(dBot))
  return r
}
function drawBookOpen(px: number, py: number): number {
  // Center spine: (6, 7) → (6, 17)
  const dSpine = distToSegment(px, py, 6, 7, 6, 17)
  // Left page top: (2, 8) → (6, 7)
  const dLT = distToSegment(px, py, 2, 8, 6, 7)
  // Left page bottom: (2, 8) → (2, 17) → (6, 17)
  const dLB = distToSegment(px, py, 2, 8, 2, 17)
  const dLL = distToSegment(px, py, 2, 17, 6, 17)
  // Left text lines
  const dL1 = distToSegment(px, py, 3, 10, 5, 10)
  const dL2 = distToSegment(px, py, 3, 12, 5, 12)
  const dL3 = distToSegment(px, py, 3, 14, 5, 14)
  // Right page top: (10, 8) → (6, 7)
  const dRT = distToSegment(px, py, 10, 8, 6, 7)
  // Right page bottom: (10, 8) → (10, 17) → (6, 17)
  const dRB = distToSegment(px, py, 10, 8, 10, 17)
  const dRL = distToSegment(px, py, 10, 17, 6, 17)
  // Right text lines
  const dR1 = distToSegment(px, py, 7, 10, 9, 10)
  const dR2 = distToSegment(px, py, 7, 12, 9, 12)
  const dR3 = distToSegment(px, py, 7, 14, 9, 14)
  let r = blendMax(strokeIntensity(dSpine), strokeIntensity(dLT))
  r = blendMax(r, strokeIntensity(dLB))
  r = blendMax(r, strokeIntensity(dLL))
  r = blendMax(r, strokeIntensity(dL1, STROKE_WIDTH / 2 * 0.6))
  r = blendMax(r, strokeIntensity(dL2, STROKE_WIDTH / 2 * 0.6))
  r = blendMax(r, strokeIntensity(dL3, STROKE_WIDTH / 2 * 0.6))
  r = blendMax(r, strokeIntensity(dRT))
  r = blendMax(r, strokeIntensity(dRB))
  r = blendMax(r, strokeIntensity(dRL))
  r = blendMax(r, strokeIntensity(dR1, STROKE_WIDTH / 2 * 0.6))
  r = blendMax(r, strokeIntensity(dR2, STROKE_WIDTH / 2 * 0.6))
  r = blendMax(r, strokeIntensity(dR3, STROKE_WIDTH / 2 * 0.6))
  return r
}

/** Lucide-style arrow-down (for "write" tool) */
function drawArrowDown(px: number, py: number): number {
  // Vertical line: (6, 7) → (6, 14)
  const d1 = distToSegment(px, py, 6, 7, 6, 14)
  // Arrowhead: (3.5, 11.5) → (6, 14) → (8.5, 11.5)
  const d2 = distToSegment(px, py, 3.5, 11.5, 6, 14)
  const d3 = distToSegment(px, py, 6, 14, 8.5, 11.5)
  let result = blendMax(strokeIntensity(d1), strokeIntensity(d2))
  result = blendMax(result, strokeIntensity(d3))
  return result
}

/** Lucide-style brain (agent label): central fissure + two hemispheres with bumps */
function drawBrain(px: number, py: number): number {
  // Central fissure
  const dLine = distToSegment(px, py, 6, 5, 6, 18)
  // Right hemisphere outer curve (top → bottom, right semicircle)
  const dROuter = distToArc(px, py, 9, 12, 5, Math.PI * -0.5, Math.PI * 0.5)
  // Left hemisphere outer curve (bottom → top, left semicircle)
  const dLOuter = distToArc(px, py, 3, 12, 5, Math.PI * 0.5, Math.PI * 1.5)
  // Right top bump
  const dRTop = distToArc(px, py, 9, 7, 2.5, Math.PI * -0.8, Math.PI * -0.2)
  // Left top bump
  const dLTop = distToArc(px, py, 3, 7, 2.5, Math.PI * -0.8, Math.PI * -0.2)
  // Right bottom bump
  const dRBot = distToArc(px, py, 9, 17, 2.5, Math.PI * 0.2, Math.PI * 0.8)
  // Left bottom bump
  const dLBot = distToArc(px, py, 3, 17, 2.5, Math.PI * 0.2, Math.PI * 0.8)
  let r = blendMax(strokeIntensity(dLine), strokeIntensity(dROuter))
  r = blendMax(r, strokeIntensity(dLOuter))
  r = blendMax(r, strokeIntensity(dRTop))
  r = blendMax(r, strokeIntensity(dLTop))
  r = blendMax(r, strokeIntensity(dRBot))
  r = blendMax(r, strokeIntensity(dLBot))
  return r
}

/** Lucide-style sparkles (skill label): 4-point concave star + small plus + small circle */
function drawSparkles(px: number, py: number): number {
  // Main 4-point concave star (outline polygon)
  const pts: Point[] = [
    { x: 6, y: 3 },    // top tip
    { x: 5.0, y: 8.5 },  // top-left valley
    { x: 1.4, y: 12 },   // left tip
    { x: 4.2, y: 14.5 }, // bottom-left valley
    { x: 6, y: 21.5 },   // bottom tip
    { x: 7.0, y: 15.5 }, // bottom-right valley
    { x: 10.6, y: 12 },  // right tip
    { x: 7.8, y: 9.5 }, // top-right valley
  ]
  let minDist = Infinity
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    const d = distToSegment(px, py, pts[i]!.x, pts[i]!.y, pts[j]!.x, pts[j]!.y)
    if (d < minDist) minDist = d
  }
  let result = strokeIntensity(minDist)
  // Small plus sign (top-right) at 60% stroke width
  const dPlusV = distToSegment(px, py, 10, 2, 10, 6)
  const dPlusH = distToSegment(px, py, 9, 4, 11, 4)
  result = blendMax(result, strokeIntensity(dPlusV, STROKE_WIDTH / 2 * 0.6))
  result = blendMax(result, strokeIntensity(dPlusH, STROKE_WIDTH / 2 * 0.6))
  // Small circle (bottom-left) at 60% stroke width
  const dCircle = distToCircle(px, py, 2, 20, 1.3)
  result = blendMax(result, strokeIntensity(dCircle, STROKE_WIDTH / 2 * 0.6))
  return result
}

/** Lucide-style brain-circuit (thinking label): brain outline + circuit nodes + traces */
function drawBrainCircuit(px: number, py: number): number {
  // Central stem
  const dStem = distToSegment(px, py, 6, 5, 6, 18)
  // Right lobe arc
  const dR = distToArc(px, py, 8, 12, 3, Math.PI * 1.5, Math.PI * 2.0)
  // Left lobe arc
  const dL = distToArc(px, py, 4, 12, 3, Math.PI * 1.0, Math.PI * 1.5)
  // Top connecting arc
  const dTop = distToArc(px, py, 6, 8, 2.5, Math.PI * 1.1, Math.PI * 1.9)
  // Bottom connecting arc
  const dBot = distToArc(px, py, 6, 16, 2.5, Math.PI * 0.1, Math.PI * 0.9)
  // Circuit nodes (filled dots)
  const dN1 = distToFilledCircle(px, py, 2.5, 8, 0.7)
  const dN2 = distToFilledCircle(px, py, 9.5, 8, 0.7)
  const dN3 = distToFilledCircle(px, py, 2.5, 16, 0.7)
  const dN4 = distToFilledCircle(px, py, 9.5, 16, 0.7)
  // Circuit traces (short stubs from nodes toward center, 70% width)
  const dT1 = distToSegment(px, py, 2.5, 8, 4, 8)
  const dT2 = distToSegment(px, py, 9.5, 8, 8, 8)
  const dT3 = distToSegment(px, py, 2.5, 16, 4, 16)
  const dT4 = distToSegment(px, py, 9.5, 16, 8, 16)
  let r = blendMax(strokeIntensity(dStem), strokeIntensity(dR))
  r = blendMax(r, strokeIntensity(dL))
  r = blendMax(r, strokeIntensity(dTop))
  r = blendMax(r, strokeIntensity(dBot))
  r = blendMax(r, strokeIntensity(dN1))
  r = blendMax(r, strokeIntensity(dN2))
  r = blendMax(r, strokeIntensity(dN3))
  r = blendMax(r, strokeIntensity(dN4))
  r = blendMax(r, strokeIntensity(dT1, STROKE_WIDTH / 2 * 0.7))
  r = blendMax(r, strokeIntensity(dT2, STROKE_WIDTH / 2 * 0.7))
  r = blendMax(r, strokeIntensity(dT3, STROKE_WIDTH / 2 * 0.7))
  r = blendMax(r, strokeIntensity(dT4, STROKE_WIDTH / 2 * 0.7))
  return r
}

/** Lucide-style target (model label): three concentric rings */
function drawTargetModel(px: number, py: number): number {
  // Outer ring
  const dOuter = distToCircle(px, py, 6, 12, 5)
  // Middle ring
  const dMiddle = distToCircle(px, py, 6, 12, 3)
  // Center dot (filled)
  const dDot = distToFilledCircle(px, py, 6, 12, 0.9)
  let r = strokeIntensity(dOuter)
  r = blendMax(r, strokeIntensity(dMiddle))
  r = blendMax(r, strokeIntensity(dDot))
  return r
}

/** Lucide-style flag (task label): flag on a pole */
function drawFlag(px: number, py: number): number {
  // Pole: (3.5, 5) → (3.5, 19)
  const dPole = distToSegment(px, py, 3.5, 5, 3.5, 19)
  // Flag top: (3.5, 5) → (8.5, 5)
  const dTop = distToSegment(px, py, 3.5, 5, 8.5, 5)
  // Flag right edge: (8.5, 5) → (8.5, 7.5)
  const dRight = distToSegment(px, py, 8.5, 5, 8.5, 7.5)
  // Flag bottom wave: gentle curve from (8.5, 7.5) to (3.5, 9)
  // Arc centered at (6, 9) radius 3.2, from angle ~-0.5 (right side, slightly up) to ~π+0.5 (left side, slightly up)
  // Actually simpler: just use a segment with slight downward curve via arc
  // Arc from right to left, sweeping downward (bottom half of circle)
  // Center (6, 6), radius 3.2: angle 0 = (9.2, 6), angle π = (2.8, 6)
  // We want lower arc: angle 0 to π passes through (6, 9.2) — yes that's the downward curve
  const dWave = distToArc(px, py, 6, 6, 3.2, Math.PI * 0.05, Math.PI * 0.95)
  // Connect wave endpoints to the corners
  const waveStartX = 6 + 3.2 * Math.cos(Math.PI * 0.05)
  const waveStartY = 6 + 3.2 * Math.sin(Math.PI * 0.05)
  const waveEndX = 6 + 3.2 * Math.cos(Math.PI * 0.95)
  const waveEndY = 6 + 3.2 * Math.sin(Math.PI * 0.95)
  const dConn1 = distToSegment(px, py, 8.5, 7.5, waveStartX, waveStartY)
  const dConn2 = distToSegment(px, py, waveEndX, waveEndY, 3.5, 9)
  let r = blendMax(strokeIntensity(dPole), strokeIntensity(dTop))
  r = blendMax(r, strokeIntensity(dRight))
  r = blendMax(r, strokeIntensity(dWave))
  r = blendMax(r, strokeIntensity(dConn1))
  r = blendMax(r, strokeIntensity(dConn2))
  return r
}

// ─── icon registry ───────────────────────────────────────

export type IconName =
  | "idle" | "busy" | "retry" | "error" | "success"
  | "bash" | "glob" | "read" | "grep" | "webfetch" | "websearch"
  | "write" | "edit" | "task" | "execute" | "apply_patch" | "todowrite"
  | "question" | "skill" | "generic"
  | "agent" | "model" | "thinking" | "branch" | "warn" | "dot"
  | "chevron_down" | "chevron_right" | "arrow_up" | "arrow_down" | "arrow_left" | "arrow_right"

const DRAW_FNS: Record<IconName, DrawFn> = {
  idle: drawCircleDot,
  busy: drawLoader,
  retry: drawRefresh,
  error: drawCircleX,
  success: drawCheck,
  bash: drawTerminal,
  glob: drawFolderSearch,
  read: drawBookOpen,
  grep: drawSearch,
  webfetch: drawGlobe,
  websearch: drawGlobeSearch,
  write: drawPencil,
  edit: drawPencil,
  task: drawFlag,
  execute: drawPlay,
  apply_patch: drawFileDiff,
  todowrite: drawCheckSquare,
  question: drawHelp,
  skill: drawSparkles,
  generic: drawCommand,
  agent: drawBrain,
  model: drawTargetModel,
  thinking: drawBrainCircuit,
  branch: drawBranch,
  warn: drawAlert,
  dot: drawDot,
  chevron_down: drawChevronDown,
  chevron_right: drawChevronRightSmall,
  arrow_up: drawArrowUp,
  arrow_down: drawArrowDownNav,
  arrow_left: drawArrowLeft,
  arrow_right: drawArrowRight,
}

const _cache = new Map<IconName, IconPixelData>()

export function getIconPixelData(name: IconName): IconPixelData {
  const cached = _cache.get(name)
  if (cached) return cached
  const data = renderGrid(DRAW_FNS[name]!)
  _cache.set(name, data)
  return data
}
