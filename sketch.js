/*
  FIX: hydra params driven by p5 keyboard position (NOT mouse)
  - no more UI panel / mouse jitter distortion
*/

let movingLetter = '?'
const SIZE_RATIO = 0.35
const MOVE_SPEED = 6
let maxSpeed = 9
const CTRL_EDGE_PAD = 0.12

// ============================================================
// Trigger tuning / debug
// ============================================================
const TRIGGER_GAP_X = 70
const TRIGGER_SEG_H_DEFAULT = 125
const TRIGGER_SEG_H_BOTTOM = 175 // 146 * 1.2
// 90도 회전한 트리거(가로 10, 세로 70)
// - 기존: x±70 위치의 "세로" 벽(높이 10)
// - 회전: y±70 위치의 "가로" 벽(폭 10)
const ROT_TRIGGER_GAP_Y = 42
const ROT_TRIGGER_SEG_W = 125
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
const SVG_OFFSET_LEFT = 400   // 왼쪽 경계
const SVG_OFFSET_RIGHT = 0   // 오른쪽 경계
const SVG_OFFSET_TOP = -20   // 위쪽 경계
const SVG_OFFSET_BOTTOM = 0   // 아래쪽 경계

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
  // 27개 다 차면 전부 '?'로 리셋
  if (boxFillIndex >= boxEls.length) {
    for (let i = 0; i < boxEls.length; i++) boxEls[i].textContent = ''
    boxFillIndex = 0
  }
  boxEls[boxFillIndex].textContent = ch
  boxFillIndex++
  lastBoxPushTime = now
}
function popFromBox() {
  const now = millis()
  if (now - lastBoxPushTime < BOX_PUSH_INTERVAL) return
  if (boxEls.length === 0) return
  if (boxFillIndex <= 0) return
  boxFillIndex--
  boxEls[boxFillIndex].textContent = ''
  lastBoxPushTime = now
} const clampCtrl = (v) => Math.max(CTRL_EDGE_PAD, Math.min(1 - CTRL_EDGE_PAD, v))
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
let hydraVal = 1.0  // 🎥 하이드라 강도 조절 (버튼 4/6)

// 🎮 Gamepad
let gamepadConnected = false
let prevBtnState = []  // 버튼 디바운스용

// 💫 회전 및 스케일 애니메이션 (버튼 7)
let isSpinning = false
let spinProgress = 0
let savedFontPx = 0
let savedRot = 0
const SPIN_DURATION_FRAMES = 120 // ~2초 (60fps 기준)

// 🎆 방사형 글자 발사 파티클
let burstParticles = []

function spawnBurst() {
  const count = Math.floor(Math.random() * 21) + 10  // 10~30개 랜덤
  const speed = 5
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 / count) * i
    const el = document.createElement('div')
    el.textContent = movingLetter
    el.style.position = 'fixed'
    el.style.left = posX + 'px'
    el.style.top = posY + 'px'
    el.style.transform = 'translate(-50%, -50%)'
    el.style.fontFamily = '"Courier New", Courier, monospace'
    el.style.fontSize = '20pt'
    el.style.fontWeight = 'bold'
    el.style.color = '#ffffff'
    el.style.pointerEvents = 'none'
    el.style.zIndex = '10000'
    document.body.appendChild(el)
    burstParticles.push({
      el,
      x: posX,
      y: posY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 600,  // 600프레임 (~10초)
    })
  }
}
window.addEventListener('gamepadconnected', (e) => {
  console.log('Gamepad connected:', e.gamepad.id)
  gamepadConnected = true
})
window.addEventListener('gamepaddisconnected', () => {
  console.log('Gamepad disconnected')
  gamepadConnected = false
})
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

// ============================================================
// ✅ Responsive positioning — fixed 1920×1080 reference
// ============================================================
const REF_W = 1727  // 기준 해상도 (고정)
const REF_H = 972   // 기준 해상도 (고정)

// 원래 고정 px 위치 (setup 시점 기준)
const LABEL_POSITIONS = [
  { n: 'A', left: 375, top: 32 },
  { n: 'B', left: 559, top: 32 },
  { n: 'C', left: 695, top: 32 },
  { n: 'D', left: 831, top: 32 },
  { n: 'E', left: 967, top: 32 },
  { n: 'F', left: 1103, top: 32 },
  { n: 'G', left: 1239, top: 32 },
  { n: 'H', left: 1375, top: 32 },
  { n: 'I', left: 1511, top: 32 },
  { n: 'J', left: 1690, top: 32 },

  { n: 'K', left: 1690, top: 214 },
  { n: 'L', left: 1690, top: 350 },
  { n: 'M', left: 1690, top: 485 },
  { n: 'N', left: 1690, top: 621 },
  { n: 'O', left: 1690, top: 757 },
  { n: 'P', left: 1690, top: 940 },

  { n: 'Q', left: 1511, top: 940 },
  { n: 'R', left: 1375, top: 940 },
  { n: 'S', left: 1239, top: 940 },
  { n: 'T', left: 1103, top: 940 },
  { n: 'U', left: 967, top: 940 },
  { n: 'V', left: 831, top: 940 },
  { n: 'W', left: 695, top: 940 },
  { n: 'X', left: 559, top: 940 },
  { n: 'Y', left: 375, top: 940 },

  { n: 'Z', left: 375, top: 757 },
  { n: '←', left: 375, top: 621 },
  { n: 'Space', left: 375, top: 485 },
  { n: '?', left: 375, top: 350 },
  { n: '!', left: 375, top: 214 },
]

// 박스/기타 원래 px 값
const BOX_X = 30, BOX_Y = 30, BOX_SIZE = 70, BOX_GAP = 10
const DIVIDER_X = 30, DIVIDER_Y = 765, DIVIDER_W = 230
const DESC_X = 30, DESC_Y = 782, DESC_W = 230

// DOM element references for repositioning
let labelEls = []
let dividerEl = null
let descEl = null

// ============================================================
// ✅ Reposition all UI elements based on current window size
// ============================================================
function repositionAllUI() {
  const sx = windowWidth / REF_W    // 가로 스케일
  const sy = windowHeight / REF_H   // 세로 스케일

  // --- Labels ---
  LABEL_POSITIONS.forEach((p, i) => {
    if (!labelEls[i]) return
    labelEls[i].style.left = (p.left * sx) + 'px'
    labelEls[i].style.top = (p.top * sy) + 'px'
  })

  // --- Triggers (update positions) ---
  letterTriggers = LABEL_POSITIONS
    .filter((p) => {
      if (typeof p.n !== 'string') return false
      if (p.n >= 'A' && p.n <= 'Z') return true
      return p.n === '!' || p.n === '?' || p.n === 'Space' || p.n === '←'
    })
    .map((p) => ({ ch: p.n, x: p.left * sx, y: p.top * sy }))

  renderTriggerDebug(letterTriggers)

  // --- Boxes ---
  const scale = Math.min(sx, sy)
  for (let idx = 0; idx < boxEls.length; idx++) {
    const row = Math.floor(idx / 3)
    const col = idx % 3
    const bx = (BOX_X + col * (BOX_SIZE + BOX_GAP)) * sx
    const by = (BOX_Y + row * (BOX_SIZE + BOX_GAP)) * sy
    const bw = BOX_SIZE * sx
    const bh = BOX_SIZE * sy
    const el = boxEls[idx]
    el.style.left = bx + 'px'
    el.style.top = by + 'px'
    el.style.width = bw + 'px'
    el.style.height = bh + 'px'
    el.style.fontSize = (35 * scale) + 'px'
  }

  // --- Divider ---
  if (dividerEl) {
    dividerEl.style.left = (DIVIDER_X * sx) + 'px'
    dividerEl.style.top = (DIVIDER_Y * sy) + 'px'
    dividerEl.style.width = (DIVIDER_W * sx) + 'px'
  }

  // --- Description ---
  if (descEl) {
    descEl.style.left = (DESC_X * sx) + 'px'
    descEl.style.top = (DESC_Y * sy) + 'px'
    descEl.style.width = (DESC_W * sx) + 'px'
    descEl.style.fontSize = (11 * scale) + 'pt'
  }
}

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
  // 코드 기반 라인에서도 바운스 경계를 계산하기 위해 유지
  // 전체 화면을 사용 (SVG 비율 대신 직접 화면 크기)
  svgBounds = {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: windowWidth,
    bottom: windowHeight,
    width: windowWidth,
    height: windowHeight,
  }
}

// ============================================================
// ✅ 코드 기반 그리드 라인 (SVG 대체)
// ============================================================
// SVG viewBox: 5442.52 × 3061.42 기준 좌표를 비율로 변환
const VB_W = 5442.52
const VB_H = 3061.42

// 세로 라인 9개의 x 위치 (viewBox 비율)
const VERT_X_RATIOS = [
  1548.91 / VB_W, 1977.17 / VB_W, 2405.44 / VB_W, 2833.70 / VB_W,
  3261.97 / VB_W, 3690.24 / VB_W, 4118.50 / VB_W, 4546.77 / VB_W, 4975.03 / VB_W
]
// 세로 라인 세그먼트 y 범위 (7개 세그먼트)
const VERT_SEG_Y = [
  [75.18 / VB_H, 413.90 / VB_H],
  [503.90 / VB_H, 842.62 / VB_H],
  [932.63 / VB_H, 1271.34 / VB_H],
  [1361.35 / VB_H, 1700.07 / VB_H],
  [1790.07 / VB_H, 2128.79 / VB_H],
  [2218.80 / VB_H, 2557.51 / VB_H],
  [2647.52 / VB_H, 2986.24 / VB_H],
]

// 가로 라인 6개의 y 위치 (viewBox 비율)
const HORIZ_Y_RATIOS = [
  458.98 / VB_H, 886.73 / VB_H, 1314.47 / VB_H,
  1742.22 / VB_H, 2169.96 / VB_H, 2597.70 / VB_H
]
// 가로 라인 세그먼트 x 범위 (11개 세그먼트)
const HORIZ_SEG_X = [
  [1163.62 / VB_W, 1502.34 / VB_W],
  [1592.34 / VB_W, 1931.06 / VB_W],
  [2021.07 / VB_W, 2359.78 / VB_W],
  [2449.79 / VB_W, 2788.51 / VB_W],
  [2878.51 / VB_W, 3217.23 / VB_W],
  [3307.24 / VB_W, 3645.95 / VB_W],
  [3735.96 / VB_W, 4074.68 / VB_W],
  [4164.68 / VB_W, 4503.40 / VB_W],
  [4593.40 / VB_W, 4932.12 / VB_W],
  [5022.13 / VB_W, 5360.84 / VB_W],
]

// SVG 원본의 화면 매핑 기준값 (초기 윈도우에서의 그리드 영역)
// 원래 SVG는 right-aligned, height:100vh, aspect=VB_W/VB_H
function getGridBounds() {
  const sx = windowWidth / REF_W
  const sy = windowHeight / REF_H
  const aspect = VB_W / VB_H
  const h = REF_H
  const w = h * aspect
  const left = REF_W - w
  return {
    left: left * sx,
    top: 0,
    width: w * sx,
    height: h * sy,
  }
}

function redrawSvgRedOverlay() {
  const ctx = ensureSvgRedOverlay()
  resizeSvgRedOverlay()

  const dpr = Math.max(1, window.devicePixelRatio || 1)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, windowWidth, windowHeight)

  const gb = getGridBounds()
  const lineW = Math.max(1, 3.44 * (gb.height / VB_H))

  ctx.save()
  ctx.strokeStyle = 'rgba(255, 255, 255, 1)'
  ctx.lineWidth = lineW
  ctx.lineCap = 'round'
  ctx.lineJoin = 'miter'
  ctx.beginPath()

  // 세로 라인
  for (const xr of VERT_X_RATIOS) {
    const x = gb.left + xr * gb.width
    for (const [y1r, y2r] of VERT_SEG_Y) {
      ctx.moveTo(x, gb.top + y1r * gb.height)
      ctx.lineTo(x, gb.top + y2r * gb.height)
    }
  }

  // 가로 라인
  for (const yr of HORIZ_Y_RATIOS) {
    const y = gb.top + yr * gb.height
    for (const [x1r, x2r] of HORIZ_SEG_X) {
      ctx.moveTo(gb.left + x1r * gb.width, y)
      ctx.lineTo(gb.left + x2r * gb.width, y)
    }
  }

  ctx.stroke()
  ctx.restore()
}

function initSvgRedOverlay() {
  ensureSvgRedOverlay()
  updateSvgBoundsForOverlay()
  redrawSvgRedOverlay()
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
    el.style.background = 'rgba(255, 0, 255, 0.8)'
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
    el.style.background = 'rgba(255, 0, 255, 0.8)'
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
    el.style.background = 'rgba(255, 0, 255, 0.8)'
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

  // ✅ SVG 이미지는 제거됨, 흰 라인을 코드로 렌더링
  updateSvgBoundsForOverlay()
  initSvgRedOverlay()
  // 기존 SVG element 삽입 코드 완전 제거 (이미 없음)

  // ✅ 좌측 상단 흰색 라인 박스들: 가로 3개 × 세로 9줄 (총 27개)
  boxEls = []
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 3; col++) {
      const box = createDiv('')
      box.style('position', 'fixed')
      box.style('background', 'transparent')
      box.style('border', '1px solid #ffffff')
      box.style('box-sizing', 'border-box')
      box.style('pointer-events', 'none')
      box.style('z-index', '9999')
      box.style('display', 'flex')
      box.style('align-items', 'center')
      box.style('justify-content', 'center')
      box.style('font-family', '"Courier New", Courier, monospace')
      box.style('color', '#ffffff')
      boxEls.push(box.elt)
    }
  }

  // ✅ 흰색 점선(divider)
  const dividerLine = createDiv('')
  dividerLine.style('position', 'fixed')
  dividerLine.style('height', '0px')
  dividerLine.style('margin', '0')
  dividerLine.style('padding', '0')
  dividerLine.style('border-top', '2px dotted #ffffff')
  dividerLine.style('pointer-events', 'none')
  dividerLine.style('z-index', '9999')
  dividerEl = dividerLine.elt

  // ✅ 점선 아래 설명 텍스트
  const descText = createDiv('This work rethinks writing as a practice that unfolds on a surface constantly in motion, asking how writing might be understood not as a static act but as one shaped by continuous movement.')
  descText.style('position', 'fixed')
  descText.style('font-family', '"Courier New", Courier, monospace')
  descText.style('color', '#ffffff')
  descText.style('line-height', '1.5')
  descText.style('pointer-events', 'none')
  descText.style('z-index', '9999')
  descEl = descText.elt

  // ✅ 라벨 (A~Z, !, ?, Space, ←) 생성
  labelEls = []
  LABEL_POSITIONS.forEach((p) => {
    const label = document.createElement('div')
    label.textContent = String(p.n)
    label.style.position = 'fixed'
    label.style.transform = 'translate(-50%, -50%)'
    label.style.fontFamily = '"Courier New", Courier, monospace'
    label.style.fontSize = '15pt'
    label.style.color = '#ffffff'
    label.style.pointerEvents = 'none'
    label.style.zIndex = '9999'
    document.body.appendChild(label)
    labelEls.push(label)
  })

  // ✅ 비율 기반으로 모든 요소 위치 설정 (초기 + 리사이즈)
  repositionAllUI()

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
    width: Math.floor(windowWidth * dpr),
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
      .modulate(osc(9, () => 0.03 * hydraVal, 0.8), () => 0.05 * hydraVal)
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
          .modulate(osc(10, () => 0.1 * hydraVal).brightness(-0.5), () => 0.05 * hydraVal)
          .scale(() => 0.9 + hydraVal * 0.02)
      )
      .mask(src(s0).thresh(0.35, 0.15))
      .out()
  }, 100)
}

function draw() {
  if (!maskPg) return
  maskPg.background(0)

  const KEY_ACCEL = 0.6
  const GAMEPAD_DEADZONE = 0.15

  // 키보드: 속도에 가속 적용
  if (keyIsDown(LEFT_ARROW) || keyIsDown(65)) velX -= KEY_ACCEL
  if (keyIsDown(RIGHT_ARROW) || keyIsDown(68)) velX += KEY_ACCEL
  if (keyIsDown(UP_ARROW) || keyIsDown(87)) velY -= KEY_ACCEL
  if (keyIsDown(DOWN_ARROW) || keyIsDown(83)) velY += KEY_ACCEL

  // 🎮 조이스틱 (Gamepad API): 스틱 + D-pad 지원
  if (navigator.getGamepads) {
    const gamepads = navigator.getGamepads()
    for (let i = 0; i < gamepads.length; i++) {
      const gp = gamepads[i]
      if (!gp) continue
      // 아날로그 스틱 (axes 0,1)
      const axisX = gp.axes[0] || 0
      const axisY = gp.axes[1] || 0
      if (Math.abs(axisX) > GAMEPAD_DEADZONE) velX += axisX * KEY_ACCEL
      if (Math.abs(axisY) > GAMEPAD_DEADZONE) velY += axisY * KEY_ACCEL
      // D-pad 버튼 (표준 매핑: 12=Up, 13=Down, 14=Left, 15=Right)
      if (gp.buttons[14] && gp.buttons[14].pressed) velX -= KEY_ACCEL
      if (gp.buttons[15] && gp.buttons[15].pressed) velX += KEY_ACCEL
      if (gp.buttons[12] && gp.buttons[12].pressed) velY -= KEY_ACCEL
      if (gp.buttons[13] && gp.buttons[13].pressed) velY += KEY_ACCEL
      // 버튼 3: 글자 크기 +10px / 버튼 0: 글자 크기 -10px
      const btn3 = gp.buttons[3] && gp.buttons[3].pressed
      const btn0 = gp.buttons[0] && gp.buttons[0].pressed
      if (btn3 && !prevBtnState[3]) fontPx = Math.max(10, fontPx + 20)
      if (btn0 && !prevBtnState[0]) fontPx = Math.max(10, fontPx - 20)
      prevBtnState[3] = btn3
      prevBtnState[0] = btn0
      // 버튼 1: 속도 감소 / 버튼 2: 속도 증가
      const btn1 = gp.buttons[1] && gp.buttons[1].pressed
      const btn2 = gp.buttons[2] && gp.buttons[2].pressed
      if (btn1 && !prevBtnState[1]) maxSpeed += 1.5
      if (btn2 && !prevBtnState[2]) maxSpeed = Math.max(1.5, maxSpeed - 1.5)
      prevBtnState[1] = btn1
      prevBtnState[2] = btn2
      // 버튼 5: 방사형 글자 발사
      const btn5 = gp.buttons[5] && gp.buttons[5].pressed
      if (btn5 && !prevBtnState[5]) spawnBurst()
      prevBtnState[5] = btn5
      // 버튼 4: 하이드라 벨류 업 / 버튼 6: 하이드라 벨류 다운
      const btn4 = gp.buttons[4] && gp.buttons[4].pressed
      const btn6 = gp.buttons[6] && gp.buttons[6].pressed
      if (btn4 && !prevBtnState[4]) {
        hydraVal = Math.min(10.0, hydraVal + 1.0)
        console.log('🎥 Hydra Value Up:', hydraVal.toFixed(1))
      }
      if (btn6 && !prevBtnState[6]) {
        hydraVal = Math.max(0.1, hydraVal - 1.0)
        console.log('🎥 Hydra Value Down:', hydraVal.toFixed(1))
      }
      prevBtnState[4] = btn4
      prevBtnState[6] = btn6
      // 버튼 7: 5바퀴 회전 + 300% 거대화 애니메이션
      const btn7 = gp.buttons[7] && gp.buttons[7].pressed
      if (btn7 && !prevBtnState[7] && !isSpinning) {
        isSpinning = true
        spinProgress = 0
        savedFontPx = fontPx
        savedRot = rot
      }
      prevBtnState[7] = btn7
      // 버튼 9: 페이지 리셋
      if (gp.buttons[9] && gp.buttons[9].pressed) {
        window.location.reload()
      }
      break
    }
  }

  // 💫 회전/스케일 애니메이션 업데이트
  if (isSpinning) {
    spinProgress += 1 / SPIN_DURATION_FRAMES
    if (spinProgress >= 1) {
      isSpinning = false
      spinProgress = 0
      fontPx = savedFontPx
      rot = savedRot
    } else {
      // 5바퀴 회전
      rot = savedRot + spinProgress * (Math.PI * 2 * 5)
      // 300% 커졌다가 돌아오기 (사인 곡선으로 1x -> 3x -> 1x)
      const scaleMult = 1 + Math.sin(spinProgress * Math.PI) * 2
      fontPx = savedFontPx * scaleMult
    }
  }

  // 최대 속도 제한
  velX = constrain(velX, -maxSpeed, maxSpeed)
  velY = constrain(velY, -maxSpeed, maxSpeed)

  // 위치 업데이트
  const prevX = posX
  const prevY = posY
  posX += velX
  posY += velY

  // 벽 충돌 감지 및 반사 — 바운스 오프셋도 화면 비율에 맞게 스케일
  maskPg.textSize(fontPx)
  const halfW = Math.max(1, maskPg.textWidth(movingLetter) * 0.5)
  const halfH = Math.max(1, (maskPg.textAscent() + maskPg.textDescent()) * 0.5)
  const margin = 0.6
  const _sx = windowWidth / REF_W
  const _sy = windowHeight / REF_H
  const scaledOffsetLeft = SVG_OFFSET_LEFT * _sx
  const scaledOffsetRight = SVG_OFFSET_RIGHT * _sx
  const scaledOffsetTop = SVG_OFFSET_TOP * _sy
  const scaledOffsetBottom = SVG_OFFSET_BOTTOM * _sy
  const b = svgBounds
  const minX = b ? b.left + scaledOffsetLeft + halfW * margin : halfW * margin
  const maxX = b ? b.right - scaledOffsetRight - halfW * margin : Math.max(halfW * margin, maskPg.width - halfW * margin)
  const minY = b ? b.top + scaledOffsetTop + halfH * margin : halfH * margin
  const maxY = b ? b.bottom - scaledOffsetBottom - halfH * margin : Math.max(halfH * margin, maskPg.height - halfH * margin)

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
    // 트리거 치수도 화면 비율로 스케일
    const _tsx = windowWidth / REF_W
    const _tsy = windowHeight / REF_H
    const _tscale = Math.min(_tsx, _tsy)
    const WALL_GAP_X = TRIGGER_GAP_X * _tsx
    const WALL_SEG_H_DEFAULT = TRIGGER_SEG_H_DEFAULT * _tsy
    const WALL_SEG_H_BOTTOM = TRIGGER_SEG_H_BOTTOM * _tsy

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
        const wallLeft = t.x - gapX
        const wallRight = t.x + gapX
        const hitFirst = velX >= 0 ? wallRight : wallLeft
        const hitSecond = velX >= 0 ? wallLeft : wallRight
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

  if (posX < minX) { posX = minX; velX = Math.abs(velX) }
  if (posX > maxX) { posX = maxX; velX = -Math.abs(velX) }
  if (posY < minY) { posY = minY; velY = Math.abs(velY) }
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

  // 🎆 방사형 파티클 업데이트 (화면 안에서 바운스)
  for (let i = burstParticles.length - 1; i >= 0; i--) {
    const p = burstParticles[i]
    p.x += p.vx
    p.y += p.vy
    p.life--
    // 화면 가장자리에서 바운스
    if (p.x <= 0 || p.x >= windowWidth) p.vx = -p.vx
    if (p.y <= 0 || p.y >= windowHeight) p.vy = -p.vy
    p.x = constrain(p.x, 0, windowWidth)
    p.y = constrain(p.y, 0, windowHeight)
    p.el.style.left = p.x + 'px'
    p.el.style.top = p.y + 'px'
    // 10초 지나면 제거
    if (p.life <= 0) {
      p.el.remove()
      burstParticles.splice(i, 1)
    }
  }
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

  // ✅ 모든 UI 요소 + 트리거 위치 비율 기반 재배치
  repositionAllUI()

  if (!DEBUG_SHOW_TRIGGERS && movingDebugEl) {
    movingDebugEl.style.width = '0'
    movingDebugEl.style.height = '0'
  }
}

function updateFontSize() {
  fontPx = Math.min(windowWidth, windowHeight) * SIZE_RATIO
}
