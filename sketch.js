/*
  FIX: hydra params driven by p5 keyboard position (NOT mouse)
  - no more UI panel / mouse jitter distortion
*/

let movingLetter = '?'
const SIZE_RATIO = 0.35
const MOVE_SPEED = 6
const CTRL_EDGE_PAD = 0.12

// ============================================================
// Trigger tuning / debug
// ============================================================
const TRIGGER_GAP_X = 70
const TRIGGER_SEG_H_DEFAULT = 40
const TRIGGER_SEG_H_BOTTOM = 56 // P~Y: 세로 ±7px
// 90도 회전한 트리거(가로 10, 세로 70)
// - 기존: x±70 위치의 "세로" 벽(높이 10)
// - 회전: y±70 위치의 "가로" 벽(폭 10)
const ROT_TRIGGER_GAP_Y = 42
const ROT_TRIGGER_SEG_W = 40
// 트리거에 "걸려서" 반복 판정되는 것 방지용
const TRIGGER_COOLDOWN_FRAMES = 6
const TRIGGER_GATE_PAD = 20
const DEBUG_SHOW_TRIGGERS = false
const DEBUG_SHOW_MOVING_BBOX = false
const DEBUG_SHOW_SAMPLE_POINTS = true
const DEBUG_SHOW_MOVING_LETTER_OUTLINE = false

// A/J/P/Y (45도 트리거): 벽 간격(gap) 스케일
const ANGLED45_GAP_SCALE = 1.95

const isRotatedTriggerChar = (ch) => (
  ch === 'B' ||
  (ch >= 'C' && ch <= 'I') ||
  (ch >= 'Q' && ch <= 'X')
)

// K~O, Z, !, ?, Space, ←: 기본(세로) 트리거의 가로 폭(=벽 간격)을 40% 줄임
const isNarrowGapChar = (ch) => (
  (ch >= 'K' && ch <= 'O') || ch === 'Z' || ch === '!' || ch === '?' || ch === 'Space' || ch === '←'
)

// A, J, P, Y: 45도 기울어진 트리거
const isAngled45TriggerChar = (ch) => (
  ch === 'A' || ch === 'J' || ch === 'P' || ch === 'Y'
)

const gapXForChar = (ch) => (isNarrowGapChar(ch) ? TRIGGER_GAP_X * 0.6 : TRIGGER_GAP_X)

// 45도 트리거 방향 벡터
// - 기본(+45°): dir=(+,+)
// - A/P만 90도 회전(= +45° -> -45°): dir=(+,-)
const angled45VectorsForChar = (ch) => {
  const inv = 1 / Math.sqrt(2)
  const dirX = inv
  const dirY = (ch === 'A' || ch === 'P') ? -inv : inv
  // dir의 수직(법선) 방향
  const nX = -dirY
  const nY = dirX
  return { dirX, dirY, nX, nY }
}


// SVG 반사 경계 미세 조정 (px 단위, + 는 안쪽으로 줄이기, - 는 바깥으로 늘리기)
const SVG_OFFSET_LEFT   =  400   // 왼쪽 경계
const SVG_OFFSET_RIGHT  =  0   // 오른쪽 경계
const SVG_OFFSET_TOP    =  -20   // 위쪽 경계
const SVG_OFFSET_BOTTOM =  0   // 아래쪽 경계

// ============================================================
// ✅ shared controls (p5 -> hydra)
// ============================================================
let ctrlX01 = 0.5
let ctrlY01 = 0.5

const clamp01 = (v) => Math.max(0, Math.min(1, v))

let boxFillIndex = 0
let lastBoxPushTime = -1000
const BOX_PUSH_INTERVAL = 500  // ms

function pushToBox(ch) {
  const now = millis()
  if (now - lastBoxPushTime < BOX_PUSH_INTERVAL) return
  if (boxEls.length === 0) return
  boxFillIndex = boxFillIndex % boxEls.length  // 넘치면 처음부터
  boxEls[boxFillIndex].textContent = ch
  boxFillIndex++
  lastBoxPushTime = now
}
function popFromBox() {
  const now = millis()
  if (now - lastBoxPushTime < BOX_PUSH_INTERVAL) return
  if (boxEls.length === 0) return
  if (boxFillIndex === 0) boxFillIndex = boxEls.length
  boxFillIndex--
  boxEls[boxFillIndex].textContent = ''
  lastBoxPushTime = now
}const clampCtrl = (v) => Math.max(CTRL_EDGE_PAD, Math.min(1 - CTRL_EDGE_PAD, v))
const safeCtrlX01 = () => (typeof ctrlX01 === 'number' ? clampCtrl(clamp01(ctrlX01)) : 0.5)
const safeCtrlY01 = () => (typeof ctrlY01 === 'number' ? clampCtrl(clamp01(ctrlY01)) : 0.5)

function updateCtrlFromPosition(viewW, viewH) {
  const gutter = fontPx * 0.25
  const safeW = Math.max(1, viewW)
  const safeH = Math.max(1, viewH)
  ctrlX01 = (posX + gutter) / (safeW + gutter * 2)
  ctrlY01 = (posY + gutter) / (safeH + gutter * 2)
}

function constrainPositionToTextBounds(viewW, viewH) {
  if (!maskPg) return
  maskPg.textSize(fontPx)
  const halfW = Math.max(1, maskPg.textWidth(movingLetter) * 0.5)
  const halfH = Math.max(1, (maskPg.textAscent() + maskPg.textDescent()) * 0.5)
  const margin = 0.6  // E의 50%만 보여도 OK
  const minX = halfW * margin
  const maxX = Math.max(halfW * margin, viewW - halfW * margin)
  const minY = halfH * margin
  const maxY = Math.max(halfH * margin, viewH - halfH * margin)
  posX = constrain(posX, minX, maxX)
  posY = constrain(posY, minY, maxY)
}

// ============================================================
// p5 mask
// ============================================================

let fontPx = 0
let posX, posY
let velX = 2.5
let velY = 1.8
let rot = 0
let hydraInitialized = false
let maskPg = null
let collisionPg = null
let svgOverlay = null
let svgBounds = null  // SVG 실제 렌더링 영역 (bounce 경계)
// SVG(흰 라인) 위에 코드로 그리는 빨간 라인 오버레이
let svgRedOverlayCanvas = null
let svgRedOverlayCtx = null
let svgLineData = null // { viewBoxW, viewBoxH, strokeWidth, segments: [{x1,y1,x2,y2}] }

// line.svg viewBox fallback (libraries/line.svg)
const SVG_VIEWBOX_W_FALLBACK = 5442.52
const SVG_VIEWBOX_H_FALLBACK = 3061.42
let letterTriggers = []
let boxEls = []
let triggerDebugLayer = null
let movingDebugEl = null
let sampleDebugCanvas = null
let sampleDebugCtx = null
let collisionOverlayAttached = false
let triggerCooldown = 0

function ensureCollisionOverlay() {
  if (!collisionPg || !collisionPg.elt) return
  if (collisionOverlayAttached) return
  const el = collisionPg.elt
  el.style.position = 'fixed'
  el.style.left = '0'
  el.style.top = '0'
  el.style.width = '100vw'
  el.style.height = '100vh'
  el.style.pointerEvents = 'none'
  // 어떤 캔버스(Hydra 포함) 위에도 무조건 보이게
  el.style.zIndex = '2147483647'
  el.style.opacity = '1'
  el.style.background = 'transparent'
  el.style.mixBlendMode = 'normal'
  el.style.border = '1px solid rgba(255, 0, 255, 0.25)'
  document.body.appendChild(el)
  collisionOverlayAttached = true
}

function setCollisionOverlayVisible(visible) {
  if (!collisionPg || !collisionPg.elt) return
  collisionPg.elt.style.display = visible ? 'block' : 'none'
}

function ensureSampleDebug() {
  if (sampleDebugCanvas && sampleDebugCtx) return sampleDebugCtx
  const canvas = document.createElement('canvas')
  canvas.style.position = 'fixed'
  canvas.style.left = '0'
  canvas.style.top = '0'
  canvas.style.width = '100vw'
  canvas.style.height = '100vh'
  canvas.style.pointerEvents = 'none'
  // 다른 오버레이(svg/labels/trigger debug) 위로 올려서 "안 보임" 문제 방지
  canvas.style.zIndex = '10010'
  canvas.style.mixBlendMode = 'normal'
  document.body.appendChild(canvas)
  sampleDebugCanvas = canvas
  sampleDebugCtx = canvas.getContext('2d')
  resizeSampleDebug()
  return sampleDebugCtx
}

function ensureSvgRedOverlay() {
  if (svgRedOverlayCanvas && svgRedOverlayCtx) return svgRedOverlayCtx
  const canvas = document.createElement('canvas')
  canvas.style.position = 'fixed'
  canvas.style.left = '0'
  canvas.style.top = '0'
  canvas.style.width = '100vw'
  canvas.style.height = '100vh'
  canvas.style.pointerEvents = 'none'
  // svgOverlay(zIndex=9999)와 동일하게 두고, DOM 추가 순서로 위에 오게 함
  canvas.style.zIndex = '9999'
  canvas.style.mixBlendMode = 'normal'
  document.body.appendChild(canvas)
  svgRedOverlayCanvas = canvas
  svgRedOverlayCtx = canvas.getContext('2d')
  resizeSvgRedOverlay()
  return svgRedOverlayCtx
}

function resizeSvgRedOverlay() {
  if (!svgRedOverlayCanvas) return
  const dpr = Math.max(1, window.devicePixelRatio || 1)
  const w = Math.max(1, Math.floor(windowWidth))
  const h = Math.max(1, Math.floor(windowHeight))
  const pw = Math.max(1, Math.floor(w * dpr))
  const ph = Math.max(1, Math.floor(h * dpr))
  if (svgRedOverlayCanvas.width !== pw) svgRedOverlayCanvas.width = pw
  if (svgRedOverlayCanvas.height !== ph) svgRedOverlayCanvas.height = ph
}

function updateSvgBoundsForOverlay() {
  // 기존 SVG 이미지 레이아웃을 그대로 재현:
  // position: fixed; right: 0; top: 50%; transform: translateY(-50%);
  // height: 100vh; width: auto;
  const viewBoxW = (svgLineData && svgLineData.viewBoxW) ? svgLineData.viewBoxW : SVG_VIEWBOX_W_FALLBACK
  const viewBoxH = (svgLineData && svgLineData.viewBoxH) ? svgLineData.viewBoxH : SVG_VIEWBOX_H_FALLBACK
  const aspect = viewBoxW / Math.max(1e-9, viewBoxH)

  const h = Math.max(1, windowHeight)
  const w = h * aspect
  const left = windowWidth - w
  const top = 0
  const right = left + w
  const bottom = top + h

  // DOMRect 유사 형태로 저장
  svgBounds = {
    x: left,
    y: top,
    left,
    top,
    right,
    bottom,
    width: w,
    height: h,
  }
}

async function loadSvgLineData(url) {
  const res = await fetch(url, { cache: 'no-cache' })
  if (!res.ok) throw new Error('Failed to fetch SVG: ' + res.status)
  const svgText = await res.text()

  const viewBoxMatch = svgText.match(/viewBox="\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*"/i)
  const viewBoxW = viewBoxMatch ? parseFloat(viewBoxMatch[1]) : 1
  const viewBoxH = viewBoxMatch ? parseFloat(viewBoxMatch[2]) : 1

  // Illustrator export: stroke-width: 3.44px
  const strokeWidthMatch = svgText.match(/stroke-width:\s*([\d.]+)px/i)
  const strokeWidth = strokeWidthMatch ? parseFloat(strokeWidthMatch[1]) : 3.44

  const segments = []
  const lineRegex = /<line\b[^>]*\bx1="([^"]+)"[^>]*\by1="([^"]+)"[^>]*\bx2="([^"]+)"[^>]*\by2="([^"]+)"[^>]*(?:\/>|>)/gi
  let m
  while ((m = lineRegex.exec(svgText)) !== null) {
    const x1 = parseFloat(m[1])
    const y1 = parseFloat(m[2])
    const x2 = parseFloat(m[3])
    const y2 = parseFloat(m[4])
    if (![x1, y1, x2, y2].every(Number.isFinite)) continue
    segments.push({ x1, y1, x2, y2 })
  }

  return { viewBoxW, viewBoxH, strokeWidth, segments }
}

function redrawSvgRedOverlay() {
  if (!svgBounds) return
  if (!svgLineData || !svgLineData.segments || svgLineData.segments.length === 0) return

  const ctx = ensureSvgRedOverlay()
  resizeSvgRedOverlay()

  const dpr = Math.max(1, window.devicePixelRatio || 1)
  // draw in CSS pixel coordinates
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, windowWidth, windowHeight)

  const b = svgBounds
  const sx = b.width / Math.max(1e-9, svgLineData.viewBoxW)
  const sy = b.height / Math.max(1e-9, svgLineData.viewBoxH)

  // uniform scale(이미지 비율 유지)라면 sx≈sy, 그래도 안전하게 y기반으로 두께 계산
  const lineW = Math.max(1, svgLineData.strokeWidth * sy)

  ctx.save()
  // SVG 대신 코드로 그리는 흰색 라인
  ctx.strokeStyle = 'rgba(255, 255, 255, 1)'
  ctx.lineWidth = lineW
  ctx.lineCap = 'round'
  ctx.lineJoin = 'miter'
  ctx.beginPath()
  // 전체 화면 중앙 기준 90% 스케일 적용
  const SCALE = 0.9
  const centerX = windowWidth / 2
  const centerY = windowHeight / 2
  for (const seg of svgLineData.segments) {
    let x1 = b.left + seg.x1 * sx
    let y1 = b.top + seg.y1 * sy
    let x2 = b.left + seg.x2 * sx
    let y2 = b.top + seg.y2 * sy
    x1 = (x1 - centerX) * SCALE + centerX
    y1 = (y1 - centerY) * SCALE + centerY
    x2 = (x2 - centerX) * SCALE + centerX
    y2 = (y2 - centerY) * SCALE + centerY
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
  }
  ctx.stroke()
  ctx.restore()
}

function initSvgRedOverlay() {
  // SVG 이미지는 제거하고, 코드로 흰 라인만 그림
  ensureSvgRedOverlay()
  loadSvgLineData('libraries/line.svg')
    .then((data) => {
      svgLineData = data
      updateSvgBoundsForOverlay()
      redrawSvgRedOverlay()
    })
    .catch((err) => {
      console.error('[svg red overlay] failed:', err)
    })
}

function resizeSampleDebug() {
  if (!sampleDebugCanvas) return
  // CSS 크기(뷰포트)와 실제 캔버스 픽셀 크기를 맞춤
  const w = Math.max(1, Math.floor(windowWidth))
  const h = Math.max(1, Math.floor(windowHeight))
  if (sampleDebugCanvas.width !== w) sampleDebugCanvas.width = w
  if (sampleDebugCanvas.height !== h) sampleDebugCanvas.height = h
}

function clearSampleDebug() {
  if (!sampleDebugCtx || !sampleDebugCanvas) return
  sampleDebugCtx.clearRect(0, 0, sampleDebugCanvas.width, sampleDebugCanvas.height)
}

function clearTriggerDebug() {
  if (triggerDebugLayer && triggerDebugLayer.parentNode) {
    triggerDebugLayer.parentNode.removeChild(triggerDebugLayer)
  }
  triggerDebugLayer = null
}

function ensureMovingDebug() {
  if (movingDebugEl) return movingDebugEl
  const el = document.createElement('div')
  el.style.position = 'fixed'
  el.style.left = '0'
  el.style.top = '0'
  el.style.width = '0'
  el.style.height = '0'
  el.style.border = '2px solid rgba(255, 0, 0, 0.7)'
  el.style.boxSizing = 'border-box'
  el.style.pointerEvents = 'none'
  el.style.zIndex = '9998'
  el.style.mixBlendMode = 'screen'
  document.body.appendChild(el)
  movingDebugEl = el
  return el
}

function updateMovingDebug(x, y, halfWidth, halfHeight) {
  if (!DEBUG_SHOW_TRIGGERS) return
  const el = ensureMovingDebug()
  el.style.left = (x - halfWidth) + 'px'
  el.style.top = (y - halfHeight) + 'px'
  el.style.width = (halfWidth * 2) + 'px'
  el.style.height = (halfHeight * 2) + 'px'
}

function renderTriggerDebug(triggers) {
  clearTriggerDebug()
  if (!DEBUG_SHOW_TRIGGERS) return
  if (!Array.isArray(triggers) || triggers.length === 0) return

  const layer = document.createElement('div')
  layer.style.position = 'fixed'
  layer.style.left = '0'
  layer.style.top = '0'
  layer.style.width = '100vw'
  layer.style.height = '100vh'
  layer.style.pointerEvents = 'none'
  layer.style.zIndex = '9998'

  const makeLine = (x, yTop, h) => {
    const el = document.createElement('div')
    el.style.position = 'fixed'
    el.style.left = x + 'px'
    el.style.top = yTop + 'px'
    el.style.width = '2px'
    el.style.height = h + 'px'
    el.style.background = 'rgba(0, 255, 0, 0.65)'
    el.style.mixBlendMode = 'screen'
    return el
  }

  const makeHLine = (xLeft, y, w) => {
    const el = document.createElement('div')
    el.style.position = 'fixed'
    el.style.left = xLeft + 'px'
    el.style.top = y + 'px'
    el.style.width = w + 'px'
    el.style.height = '2px'
    el.style.background = 'rgba(0, 255, 0, 0.65)'
    el.style.mixBlendMode = 'screen'
    return el
  }

  const makeDiagLine = (x1, y1, x2, y2) => {
    const el = document.createElement('div')
    const dx = x2 - x1
    const dy = y2 - y1
    const len = Math.max(1, Math.hypot(dx, dy))
    const ang = Math.atan2(dy, dx) * 180 / Math.PI
    el.style.position = 'fixed'
    el.style.left = x1 + 'px'
    el.style.top = y1 + 'px'
    el.style.width = len + 'px'
    el.style.height = '2px'
    el.style.transformOrigin = '0 50%'
    el.style.transform = `rotate(${ang}deg)`
    el.style.background = 'rgba(0, 255, 0, 0.65)'
    el.style.mixBlendMode = 'screen'
    return el
  }

  for (const t of triggers) {
    // Space / ← : 좌우 세로 벽으로 표시 (isRotatedTriggerChar 오판 방지)
    if (t.ch === 'Space' || t.ch === '←') {
      const segH = TRIGGER_SEG_H_DEFAULT
      const yTop = t.y - segH / 2
      const gapX = gapXForChar(t.ch)
      layer.appendChild(makeLine(t.x - gapX, yTop, segH))
      layer.appendChild(makeLine(t.x + gapX, yTop, segH))
      continue
    }

    if (isRotatedTriggerChar(t.ch)) {
      const wallTop = t.y - ROT_TRIGGER_GAP_Y
      const wallBottom = t.y + ROT_TRIGGER_GAP_Y
      const xLeft = t.x - ROT_TRIGGER_SEG_W / 2
      layer.appendChild(makeHLine(xLeft, wallTop, ROT_TRIGGER_SEG_W))
      layer.appendChild(makeHLine(xLeft, wallBottom, ROT_TRIGGER_SEG_W))
      continue
    }

    if (isAngled45TriggerChar(t.ch)) {
      const segH = (t.ch >= 'P' && t.ch <= 'Y') ? TRIGGER_SEG_H_BOTTOM : TRIGGER_SEG_H_DEFAULT
      const segLen = segH
      const gap = TRIGGER_GAP_X * ANGLED45_GAP_SCALE

      const { dirX, dirY, nX, nY } = angled45VectorsForChar(t.ch)

      const cx1 = t.x + nX * gap
      const cy1 = t.y + nY * gap
      const cx2 = t.x - nX * gap
      const cy2 = t.y - nY * gap

      const x1a = cx1 - dirX * (segLen / 2)
      const y1a = cy1 - dirY * (segLen / 2)
      const x1b = cx1 + dirX * (segLen / 2)
      const y1b = cy1 + dirY * (segLen / 2)
      const x2a = cx2 - dirX * (segLen / 2)
      const y2a = cy2 - dirY * (segLen / 2)
      const x2b = cx2 + dirX * (segLen / 2)
      const y2b = cy2 + dirY * (segLen / 2)

      layer.appendChild(makeDiagLine(x1a, y1a, x1b, y1b))
      layer.appendChild(makeDiagLine(x2a, y2a, x2b, y2b))
      continue
    }

    const segH = (t.ch >= 'P' && t.ch <= 'Y') ? TRIGGER_SEG_H_BOTTOM : TRIGGER_SEG_H_DEFAULT
    const yTop = t.y - segH / 2
    const gapX = gapXForChar(t.ch)
    const wallLeft = t.x - gapX
    const wallRight = t.x + gapX
    layer.appendChild(makeLine(wallLeft, yTop, segH))
    layer.appendChild(makeLine(wallRight, yTop, segH))
  }

  document.body.appendChild(layer)
  triggerDebugLayer = layer
}

function setup() {
  noCanvas()
  maskPg = createGraphics(windowWidth, windowHeight)
  maskPg.pixelDensity(1)
  maskPg.textAlign(CENTER, CENTER)
  maskPg.noStroke()

  collisionPg = createGraphics(windowWidth, windowHeight)
  collisionPg.pixelDensity(1)
  collisionPg.textAlign(CENTER, CENTER)
  collisionPg.noStroke()

  if (DEBUG_SHOW_MOVING_LETTER_OUTLINE) {
    ensureCollisionOverlay()
    setCollisionOverlayVisible(true)
  }

  if (DEBUG_SHOW_TRIGGERS && DEBUG_SHOW_SAMPLE_POINTS) {
    ensureSampleDebug()
  }

  updateFontSize()

  // ✅ SVG 이미지는 제거하고, 흰 라인을 코드로 렌더링
  updateSvgBoundsForOverlay()
  initSvgRedOverlay()


  // 화면 중앙 기준 90% 축소
  const SCALE = 0.9
  const centerX = windowWidth / 2
  const centerY = windowHeight / 2

  // 좌측 상단 흰색 라인 박스들: 가로 3개 × 세로 9줄 (총 27개)
  const BOX_X = 30
  const BOX_Y = 30
  const BOX_SIZE = 70
  const BOX_GAP = 10
  boxEls = []
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 3; col++) {
      const origX = BOX_X + col * (BOX_SIZE + BOX_GAP)
      const origY = BOX_Y + row * (BOX_SIZE + BOX_GAP)
      const scaledX = (origX - centerX) * SCALE + centerX
      const scaledY = (origY - centerY) * SCALE + centerY
      const box = createDiv('')
      box.position(scaledX, scaledY)
      box.style('position', 'fixed')
      box.style('width', (BOX_SIZE * SCALE) + 'px')
      box.style('height', (BOX_SIZE * SCALE) + 'px')
      box.style('background', 'transparent')
      box.style('border', '1px solid #ffffff')
      box.style('box-sizing', 'border-box')
      box.style('pointer-events', 'none')
      box.style('z-index', '9999')
      box.style('display', 'flex')
      box.style('align-items', 'center')
      box.style('justify-content', 'center')
      box.style('font-family', '"Courier New", Courier, monospace')
      box.style('font-size', (35 * SCALE) + 'px')
      box.style('color', '#ffffff')
      boxEls.push(box.elt)
    }
  }

  // 흰색 점선(divider)
  const origDividerX = 30
  const origDividerY = 765
  const scaledDividerX = (origDividerX - centerX) * SCALE + centerX
  const scaledDividerY = (origDividerY - centerY) * SCALE + centerY
  const dividerLine = createDiv('')
  dividerLine.position(scaledDividerX, scaledDividerY)
  dividerLine.style('position', 'fixed')
  dividerLine.style('width', (230 * SCALE) + 'px')
  dividerLine.style('height', '0px')
  dividerLine.style('margin', '0')
  dividerLine.style('padding', '0')
  dividerLine.style('border-top', (2 * SCALE) + 'px dotted #ffffff')
  dividerLine.style('pointer-events', 'none')
  dividerLine.style('z-index', '9999')

  // 점선 아래 설명 텍스트
  const origDescX = 30
  const origDescY = 782
  const scaledDescX = (origDescX - centerX) * SCALE + centerX
  const scaledDescY = (origDescY - centerY) * SCALE + centerY
  const descText = createDiv('This work explores axial accumulation as a visual method, asking what kind of typeface might emerge when letterforms are layered and reassembled, shifting our perspective on what a font can become in future.')
  descText.position(scaledDescX, scaledDescY)
  descText.style('position', 'fixed')
  descText.style('width', (230 * SCALE) + 'px')
  descText.style('font-family', '"Courier New", Courier, monospace')
  descText.style('font-size', (11 * SCALE) + 'pt')
  descText.style('color', '#ffffff')
  descText.style('line-height', '1.5')
  descText.style('pointer-events', 'none')
  descText.style('z-index', '9999')

  // ✅ 숫자 위치를 하나하나 직접 입력 (원하는 값으로 수정)
  // left/top은 화면 px 기준. transform은 글자 기준점(앵커)용.
  const labelPositions = [
    { n: 'A',  left: 345,  top: 32 },
    { n: 'B',  left: 530,  top: 32 },
    { n: 'C',  left: 670,  top: 32 },
    { n: 'D',  left: 810,  top: 32 },
    { n: 'E',  left: 950,  top: 32 },
    { n: 'F',  left: 1090, top: 32 },
    { n: 'G',  left: 1230, top: 32 },
    { n: 'H',  left: 1370, top: 32 },
    { n: 'I',  left: 1510, top: 32 },
    { n: 'J', left: 1690, top: 32,},

    { n: 'K', left: 1690, top: 220 },
    { n: 'L', left: 1690, top: 360 },
    { n: 'M', left: 1690, top: 500 },
    { n: 'N', left: 1690, top: 640 },
    { n: 'O', left: 1690, top: 780 },
    { n: 'P', left: 1690, top: 970 },

    { n: 'Q', left: 1510, top: 970 },
    { n: 'R', left: 1370, top: 970 },
    { n: 'S', left: 1230, top: 970 },
    { n: 'T', left: 1090, top: 970 },
    { n: 'U', left: 950,  top: 970 },
    { n: 'V', left: 810,  top: 970 },
    { n: 'W', left: 670,  top: 970 },
    { n: 'X', left: 530,  top: 970 },
    { n: 'Y', left: 345,  top: 970},

    { n: 'Z', left: 345,  top: 780 },
    { n: '←', left: 345,  top: 640 },
    { n: 'Space', left: 365,  top: 500 },
    { n: '?', left: 345,  top: 360 },
    { n: '!', left: 345,  top: 220},
  ]

  // 트리거(충돌 기준점) 좌표 저장
  // - A~Z, !, ?, Space, ←
  letterTriggers = labelPositions
    .filter((p) => {
      if (typeof p.n !== 'string') return false
      if (p.n >= 'A' && p.n <= 'Z') return true
      return p.n === '!' || p.n === '?' || p.n === 'Space' || p.n === '←'
    })
    .map((p) => ({ ch: p.n, x: p.left, y: p.top }))

  renderTriggerDebug(letterTriggers)

  labelPositions.forEach((p) => {
    const scaledLeft = (p.left - centerX) * SCALE + centerX
    const scaledTop = (p.top - centerY) * SCALE + centerY
    const label = document.createElement('div')
    label.textContent = String(p.n)
    label.style.position = 'fixed'
    label.style.left = scaledLeft + 'px'
    label.style.top = scaledTop + 'px'
    label.style.transform = p.transform || 'translate(-50%, -50%)'
    label.style.fontFamily = '"Courier New", Courier, monospace'
    label.style.fontSize = (15 * SCALE) + 'pt'
    label.style.color = '#ffffff'
    label.style.pointerEvents = 'none'
    label.style.zIndex = '9999'
    document.body.appendChild(label)
  })

  maskPg.background(0)

  posX = windowWidth / 2
  posY = windowHeight / 2

  // 초기 컨트롤 값 세팅
  updateCtrlFromPosition(windowWidth, windowHeight)

  // Initialize Hydra after p5 is ready
  if (!hydraInitialized) {
    // Wait for Hydra to load
    if (typeof Hydra !== 'undefined') {
      initHydra()
      hydraInitialized = true
    } else {
      // Retry after a short delay
      setTimeout(() => {
        if (typeof Hydra !== 'undefined') {
          initHydra()
          hydraInitialized = true
        }
      }, 100)
    }
  }
}

function initHydra() {
  // Create Hydra instance (Hydra canvas only - p5 maskPg는 건드리지 않음)
  const dpr = window.devicePixelRatio || 1
  new Hydra({
    detectAudio: false,
    width:  Math.floor(windowWidth  * dpr),
    height: Math.floor(windowHeight * dpr),
  })

  // Wait a moment for Hydra to fully initialize
  setTimeout(() => {
    if (!maskPg) return
    s0.init({ src: maskPg.elt })

    // 글자 위치(0~1)를 -0.5~0.5로 바꿔서 Hydra에 섞어줌
    const followX = () => (safeCtrlX01() - 0.5)
    const followY = () => (safeCtrlY01() - 0.5)
    const FOLLOW_STRENGTH_BASE = 0.06
    const FOLLOW_STRENGTH_MAIN = 0.03

    // ---------- Hydra base ----------
    noise(3.0, 0.08)
      .saturate(0)
      .contrast(1.2)
      .brightness(-0.2)
      .scrollX(() => Math.sin(time * 0.20) * 0.01 + followX() * FOLLOW_STRENGTH_BASE)
      .scrollY(() => Math.cos(time * 0.15) * 0.01 + followY() * FOLLOW_STRENGTH_BASE)
      .modulate(osc(9, 0.03, 0.8), 0.03)
      .out(o0)

    // ---------- Hydra main (NO mouse usage) ----------
    shape(
        () => Math.floor(safeCtrlX01() * 5) + 4,   // 4~8
        () => 2 + safeCtrlY01() * 0.22,         // 1.42~1.64 (covers full screen)
        0
      )
      .diff(
        src(o0)
          .scrollX(() => followX() * FOLLOW_STRENGTH_MAIN)
          .scrollY(() => 0.01 + followY() * FOLLOW_STRENGTH_MAIN)
          .modulate(osc(10, 0.1).brightness(-0.5), 0.02)
          .scale(0.9)
      )
      .mask(src(s0).thresh(0.35, 0.15))
      .out()
  }, 100)
}

function draw() {
  if (!maskPg) return
  maskPg.background(0)

  const KEY_ACCEL = 0.6
  const MAX_SPEED = 9

  // 키보드: 속도에 가속 적용
  if (keyIsDown(LEFT_ARROW)  || keyIsDown(65)) velX -= KEY_ACCEL
  if (keyIsDown(RIGHT_ARROW) || keyIsDown(68)) velX += KEY_ACCEL
  if (keyIsDown(UP_ARROW)    || keyIsDown(87)) velY -= KEY_ACCEL
  if (keyIsDown(DOWN_ARROW)  || keyIsDown(83)) velY += KEY_ACCEL

  // 최대 속도 제한
  velX = constrain(velX, -MAX_SPEED, MAX_SPEED)
  velY = constrain(velY, -MAX_SPEED, MAX_SPEED)

  // 위치 업데이트
  const prevX = posX
  const prevY = posY
  posX += velX
  posY += velY

  // 벽 충돌 감지 및 반사 (SVG 영역 기준, 없으면 윈도우 전체)
  maskPg.textSize(fontPx)
  const halfW = Math.max(1, maskPg.textWidth(movingLetter) * 0.5)
  const halfH = Math.max(1, (maskPg.textAscent() + maskPg.textDescent()) * 0.5)
  const margin = 0.6
  const b = svgBounds
  const minX = b ? b.left   + SVG_OFFSET_LEFT   + halfW * margin : halfW * margin
  const maxX = b ? b.right  - SVG_OFFSET_RIGHT  - halfW * margin : Math.max(halfW * margin, maskPg.width  - halfW * margin)
  const minY = b ? b.top    + SVG_OFFSET_TOP    + halfH * margin : halfH * margin
  const maxY = b ? b.bottom - SVG_OFFSET_BOTTOM - halfH * margin : Math.max(halfH * margin, maskPg.height - halfH * margin)

  // ------------------------------------------------------------
  // collision buffer는 매 프레임 업데이트 (트리거 판정/오버레이 공통)
  // ------------------------------------------------------------
  let collisionPixels = null
  let collisionW = 0
  let collisionH = 0
  if (collisionPg) {
    collisionPg.clear()

    // 오버레이가 보이는지 확인용(좌상단 마커)
    if (DEBUG_SHOW_MOVING_LETTER_OUTLINE) {
      collisionPg.push()
      collisionPg.noStroke()
      collisionPg.fill(0, 255, 0, 220)
      collisionPg.rect(10, 10, 12, 12)
      collisionPg.pop()
    }

    collisionPg.push()
    collisionPg.translate(posX, posY)
    collisionPg.rotate(rot)
    // 배경에 묻히지 않게 마젠타로 표시 (R채널 255 유지 → 샘플링에도 문제 없음)
    collisionPg.fill(255, 0, 255)
    collisionPg.textSize(fontPx)
    collisionPg.textStyle(BOLD)
    collisionPg.text(movingLetter, 0, 0)
    collisionPg.pop()

    if (DEBUG_SHOW_MOVING_LETTER_OUTLINE) {
      ensureCollisionOverlay()
      setCollisionOverlayVisible(true)
    } else {
      setCollisionOverlayVisible(false)
    }

    collisionPg.loadPixels()
    collisionPixels = collisionPg.pixels
    collisionW = collisionPg.width
    collisionH = collisionPg.height
  }

  const sampleBright = (x, y) => {
    if (!collisionPixels) return 0
    const xi = Math.max(0, Math.min(collisionW - 1, Math.round(x)))
    const yi = Math.max(0, Math.min(collisionH - 1, Math.round(y)))
    const idx = 4 * (yi * collisionW + xi)
    return collisionPixels[idx] // R 채널
  }

  // A~Z 트리거: 글자 "형태(아웃라인 픽셀)"가 트리거 구간에 닿으면 해당 글자로 변경
  // - bbox(사각형)로 때리는 대신, offscreen 버퍼에 글자를 렌더링하고 픽셀 샘플링으로 판정
  if (triggerCooldown > 0) triggerCooldown -= 1

  if (triggerCooldown === 0 && Array.isArray(letterTriggers) && letterTriggers.length > 0) {
    const WALL_GAP_X = TRIGGER_GAP_X
    const WALL_SEG_H_DEFAULT = TRIGGER_SEG_H_DEFAULT
    const WALL_SEG_H_BOTTOM = TRIGGER_SEG_H_BOTTOM

    let dbg = null
    if (DEBUG_SHOW_TRIGGERS && DEBUG_SHOW_SAMPLE_POINTS) {
      const ctx = ensureSampleDebug()
      resizeSampleDebug()
      clearSampleDebug()
      dbg = {
        ctx,
        threshold: 20,
        pointSize: 4,
      }

      // 오버레이가 실제로 그려지고 있는지 확인용 마커
      ctx.save()
      ctx.fillStyle = 'rgba(255, 0, 255, 0.9)'
      ctx.fillRect(8, 8, 6, 6)
      ctx.restore()
    } else if (sampleDebugCanvas) {
      sampleDebugCanvas.style.display = 'none'
    }
    if (sampleDebugCanvas && dbg) sampleDebugCanvas.style.display = 'block'

    if (DEBUG_SHOW_MOVING_BBOX) {
      updateMovingDebug(posX, posY, halfW + 2, halfH + 2)
    }

      const touchesWallSegment = (wallX, yMin, yMax) => {
        // 세로 구간에 여러 점 샘플 + 벽 두께(주변 1px) 샘플
        const steps = 9
        const thickness = 2

        if (dbg && dbg.ctx) {
          const ctx = dbg.ctx
          ctx.save()
          ctx.lineWidth = 2
          ctx.strokeStyle = 'rgba(0, 255, 255, 0.85)'
          ctx.beginPath()
          ctx.moveTo(wallX + 0.5, yMin)
          ctx.lineTo(wallX + 0.5, yMax)
          ctx.stroke()
          ctx.restore()
        }

        for (let i = 0; i <= steps; i++) {
          const t = i / steps
          const y = yMin + (yMax - yMin) * t
          for (let dx = -thickness; dx <= thickness; dx++) {
            const x = wallX + dx
            const bright = sampleBright(x, y)
            if (dbg && dbg.ctx) {
              const hit = bright > dbg.threshold
              dbg.ctx.fillStyle = hit ? 'rgba(255, 60, 60, 0.95)' : 'rgba(255, 255, 255, 0.65)'
              dbg.ctx.fillRect(x - dbg.pointSize / 2, y - dbg.pointSize / 2, dbg.pointSize, dbg.pointSize)
            }
            if (bright > 20) return true
          }
        }
        return false
      }

      const touchesHWallSegment = (wallY, xMin, xMax) => {
        // 가로 구간에 여러 점 샘플 + 두께(주변 1px) 샘플
        const steps = 9
        const thickness = 2

        if (dbg && dbg.ctx) {
          const ctx = dbg.ctx
          ctx.save()
          ctx.lineWidth = 2
          ctx.strokeStyle = 'rgba(0, 255, 255, 0.85)'
          ctx.beginPath()
          ctx.moveTo(xMin, wallY + 0.5)
          ctx.lineTo(xMax, wallY + 0.5)
          ctx.stroke()
          ctx.restore()
        }

        for (let i = 0; i <= steps; i++) {
          const t = i / steps
          const x = xMin + (xMax - xMin) * t
          for (let dy = -thickness; dy <= thickness; dy++) {
            const y = wallY + dy
            const bright = sampleBright(x, y)
            if (dbg && dbg.ctx) {
              const hit = bright > dbg.threshold
              dbg.ctx.fillStyle = hit ? 'rgba(255, 60, 60, 0.95)' : 'rgba(255, 255, 255, 0.65)'
              dbg.ctx.fillRect(x - dbg.pointSize / 2, y - dbg.pointSize / 2, dbg.pointSize, dbg.pointSize)
            }
            if (bright > 20) return true
          }
        }
        return false
      }

      const touchesLineSegment = (x1, y1, x2, y2) => {
        // 임의 방향 선분(여기서는 45도)에 대해 픽셀 샘플링
        const steps = 11
        const thickness = 2

        const dx = x2 - x1
        const dy = y2 - y1
        const len = Math.max(1e-6, Math.hypot(dx, dy))
        // 선분의 수직 방향(정규화)
        const px = -dy / len
        const py = dx / len

        if (dbg && dbg.ctx) {
          const ctx = dbg.ctx
          ctx.save()
          ctx.lineWidth = 2
          ctx.strokeStyle = 'rgba(0, 255, 255, 0.85)'
          ctx.beginPath()
          ctx.moveTo(x1, y1)
          ctx.lineTo(x2, y2)
          ctx.stroke()
          ctx.restore()
        }

        for (let i = 0; i <= steps; i++) {
          const t = i / steps
          const x = x1 + dx * t
          const y = y1 + dy * t
          for (let o = -thickness; o <= thickness; o++) {
            const sx = x + px * o
            const sy = y + py * o
            const bright = sampleBright(sx, sy)
            if (dbg && dbg.ctx) {
              const hit = bright > dbg.threshold
              dbg.ctx.fillStyle = hit ? 'rgba(255, 60, 60, 0.95)' : 'rgba(255, 255, 255, 0.65)'
              dbg.ctx.fillRect(sx - dbg.pointSize / 2, sy - dbg.pointSize / 2, dbg.pointSize, dbg.pointSize)
            }
            if (bright > 20) return true
          }
        }
        return false
      }

      for (const t of letterTriggers) {
        // Space / ← : 먼저 처리 (문자열 길이가 1이 아니라 isRotatedTriggerChar 오판 방지)
        if (t.ch === 'Space' || t.ch === '←') {
          const segH = TRIGGER_SEG_H_DEFAULT
          if (Math.abs(posY - t.y) > (halfH + segH * 0.5 + TRIGGER_GATE_PAD)) continue
          const gapX = gapXForChar(t.ch)
          if (Math.abs(posX - t.x) > (halfW + gapX + TRIGGER_GATE_PAD)) continue

          const wallYMin = t.y - segH / 2
          const wallYMax = t.y + segH / 2
          const wallLeft  = t.x - gapX
          const wallRight = t.x + gapX
          const hitFirst  = velX >= 0 ? wallRight : wallLeft
          const hitSecond = velX >= 0 ? wallLeft  : wallRight
          const hit = touchesWallSegment(hitFirst, wallYMin, wallYMax) ||
                      touchesWallSegment(hitSecond, wallYMin, wallYMax)
          if (!hit) continue

          posX = prevX
          posY = prevY
          velX = -velX
          posX += velX * 0.5
          // movingLetter는 변경 없음
          if (t.ch === 'Space') {
            pushToBox('\u00a0')
          } else {
            popFromBox()
          }
          triggerCooldown = TRIGGER_COOLDOWN_FRAMES
          break
        }

        // 회전 트리거(B, C~I, Q~X): y±70 위치에 가로 10짜리 세그먼트
        if (isRotatedTriggerChar(t.ch)) {
          // 게이트: 트리거 근처일 때만 픽셀 샘플링(큰 글자가 멀리서도 닿는 듯한 오판 방지)
          if (Math.abs(posX - t.x) > (halfW + ROT_TRIGGER_SEG_W * 0.5 + TRIGGER_GATE_PAD)) continue
          if (Math.abs(posY - t.y) > (halfH + ROT_TRIGGER_GAP_Y + TRIGGER_GATE_PAD)) continue

          const wallTopY = t.y - ROT_TRIGGER_GAP_Y
          const wallBottomY = t.y + ROT_TRIGGER_GAP_Y
          const xMin = t.x - ROT_TRIGGER_SEG_W / 2
          const xMax = t.x + ROT_TRIGGER_SEG_W / 2

          const hitFirstY = velY >= 0 ? wallBottomY : wallTopY
          const hitSecondY = velY >= 0 ? wallTopY : wallBottomY

          const hit = touchesHWallSegment(hitFirstY, xMin, xMax) || touchesHWallSegment(hitSecondY, xMin, xMax)
          if (!hit) continue

          posX = prevX
          posY = prevY
          velY = -velY
          // 살짝 밀어내서 다음 프레임에 계속 닿는 것 방지
          posY += velY * 0.5
          movingLetter = t.ch
          pushToBox(t.ch)
          triggerCooldown = TRIGGER_COOLDOWN_FRAMES
          break
        }

        // 45도 트리거(A, J, P, Y): 대각선 선분 2개
        if (isAngled45TriggerChar(t.ch)) {
          const segH = (t.ch >= 'P' && t.ch <= 'Y') ? WALL_SEG_H_BOTTOM : WALL_SEG_H_DEFAULT
          const segLen = segH
          const gap = TRIGGER_GAP_X * ANGLED45_GAP_SCALE

          // 게이트: 트리거 근처일 때만 샘플링
          if (Math.abs(posX - t.x) > (halfW + gap + TRIGGER_GATE_PAD)) continue
          if (Math.abs(posY - t.y) > (halfH + gap + TRIGGER_GATE_PAD)) continue

          const { dirX, dirY, nX, nY } = angled45VectorsForChar(t.ch)

          // 두 개의 평행 선분 중심
          const c1x = t.x + nX * gap
          const c1y = t.y + nY * gap
          const c2x = t.x - nX * gap
          const c2y = t.y - nY * gap

          const s1x1 = c1x - dirX * (segLen / 2)
          const s1y1 = c1y - dirY * (segLen / 2)
          const s1x2 = c1x + dirX * (segLen / 2)
          const s1y2 = c1y + dirY * (segLen / 2)

          const s2x1 = c2x - dirX * (segLen / 2)
          const s2y1 = c2y - dirY * (segLen / 2)
          const s2x2 = c2x + dirX * (segLen / 2)
          const s2y2 = c2y + dirY * (segLen / 2)

          // 이동 방향에 따라 먼저 닿을 가능성이 큰 선분부터
          const vDotN = velX * nX + velY * nY
          const firstIs2 = vDotN >= 0

          const hit = firstIs2
            ? (touchesLineSegment(s2x1, s2y1, s2x2, s2y2) || touchesLineSegment(s1x1, s1y1, s1x2, s1y2))
            : (touchesLineSegment(s1x1, s1y1, s1x2, s1y2) || touchesLineSegment(s2x1, s2y1, s2x2, s2y2))

          if (!hit) continue

          // 반사(선분 법선 기준)
          posX = prevX
          posY = prevY

          const nLen = Math.hypot(nX, nY) || 1
          const nnX = nX / nLen
          const nnY = nY / nLen
          const dot = velX * nnX + velY * nnY
          velX = velX - 2 * dot * nnX
          velY = velY - 2 * dot * nnY

          // 살짝 밀어내서 다음 프레임에 계속 닿는 것 방지
          posX += velX * 0.5
          posY += velY * 0.5

          movingLetter = t.ch
          pushToBox(t.ch)
          triggerCooldown = TRIGGER_COOLDOWN_FRAMES
          break
        }

        // 게이트: 트리거 근처일 때만 픽셀 샘플링(큰 글자+회전으로 멀리서 닿는 듯한 현상 방지)
        const segH = (t.ch >= 'P' && t.ch <= 'Y') ? WALL_SEG_H_BOTTOM : WALL_SEG_H_DEFAULT
        if (Math.abs(posY - t.y) > (halfH + segH * 0.5 + TRIGGER_GATE_PAD)) continue
        const gapX = gapXForChar(t.ch)
        if (Math.abs(posX - t.x) > (halfW + gapX + TRIGGER_GATE_PAD)) continue

        const wallYMin = t.y - segH / 2
        const wallYMax = t.y + segH / 2
        const wallLeft = t.x - gapX
        const wallRight = t.x + gapX

        // 이동 방향에 따라 먼저 닿을 가능성이 큰 벽부터 체크
        const hitFirst = velX >= 0 ? wallRight : wallLeft
        const hitSecond = velX >= 0 ? wallLeft : wallRight

        const hit = touchesWallSegment(hitFirst, wallYMin, wallYMax) || touchesWallSegment(hitSecond, wallYMin, wallYMax)
        if (!hit) continue

        // 충돌 처리: 일단 이전 위치로 되돌리고 반사 (outline 기반이라 penetration 해결을 단순화)
        posX = prevX
        posY = prevY
        velX = -velX
        // 살짝 밀어내서 다음 프레임에 계속 닿는 것 방지
        posX += velX * 0.5
        movingLetter = t.ch
        pushToBox(t.ch)
        triggerCooldown = TRIGGER_COOLDOWN_FRAMES
        break
      }
  }

  if (posX < minX) { posX = minX; velX =  Math.abs(velX) }
  if (posX > maxX) { posX = maxX; velX = -Math.abs(velX) }
  if (posY < minY) { posY = minY; velY =  Math.abs(velY) }
  if (posY > maxY) { posY = maxY; velY = -Math.abs(velY) }

  // Hydra 컨트롤 값 업데이트
  updateCtrlFromPosition(maskPg.width, maskPg.height)

  // 회전 업데이트
  rot += 0.005

  // 마스크 텍스트 (회전 적용)
  maskPg.push()
  maskPg.translate(posX, posY)
  maskPg.rotate(rot)
  maskPg.fill(255)
  maskPg.textSize(fontPx)
  maskPg.textStyle(BOLD)
  maskPg.text(movingLetter, 0, 0)
  maskPg.pop()
}

function windowResized() {
  if (maskPg) {
    maskPg.resizeCanvas(windowWidth, windowHeight)
    maskPg.background(0)
  }
  if (collisionPg) {
    collisionPg.resizeCanvas(windowWidth, windowHeight)
    collisionPg.clear()
    if (DEBUG_SHOW_MOVING_LETTER_OUTLINE) {
      ensureCollisionOverlay()
      setCollisionOverlayVisible(true)
    }
  }
  if (sampleDebugCanvas) {
    resizeSampleDebug()
    clearSampleDebug()
  }
  // SVG 이미지는 없고, 오버레이 bounds를 다시 계산
  requestAnimationFrame(() => {
    updateSvgBoundsForOverlay()
    redrawSvgRedOverlay()
  })
  updateFontSize()

  constrainPositionToTextBounds(windowWidth, windowHeight)

  updateCtrlFromPosition(windowWidth, windowHeight)

  renderTriggerDebug(letterTriggers)

  if (!DEBUG_SHOW_TRIGGERS && movingDebugEl) {
    movingDebugEl.style.width = '0'
    movingDebugEl.style.height = '0'
  }
}

function updateFontSize() {
  fontPx = Math.min(windowWidth, windowHeight) * SIZE_RATIO
}
