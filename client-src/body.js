/**
 * dsh-liangwenfeng-moment 浏览器端装饰逻辑（纯 DOM，不依赖 React 内部）。
 * 由 scripts/build-client.mjs 与 src/wave.js（去掉 export 后）一起拼进 lib/client.js。
 *
 * 视觉方案（v0.3）：
 *  1) 对话窗口右下角模型切换按钮右侧常驻彩色箭头：
 *       波峰（梁文锋时刻）→ 红色 ▲   波谷（梁文谷时刻）→ 绿色 ▼
 *  2) 鼠标悬浮（或键盘聚焦）模型按钮/箭头时，弹出浮动面板：
 *       “当前为 梁文锋时刻，距离下一次梁文谷时刻还剩 hh:mm:ss” 每秒动态倒数，
 *       句中的时刻名称按文字着色（梁文锋时刻→红、梁文谷时刻→绿），
 *       附一行峰谷计价规则说明；相位翻转时自动更新。
 *  3) 切换模型下拉菜单里 DeepSeek 各选项仍追加【…时刻】文本（不会被截断，
 *      后缀文字同样按名称着色：梁文锋时刻→红、梁文谷时刻→绿）。
 *
 * 判峰谷规则（DeepSeek 官网口径，北京时间）：
 *   高峰（波峰）= 周一至周五 09:00–12:00、14:00–18:00；
 *   其余时间（含周末）= 空闲时段（波谷），价格为高峰的一半。
 */

// ---- 运行时配置（如需调整波峰/波谷规则，改这里即可） ----
// DeepSeek 官网口径：高峰（波峰）= 北京时间周一至周五 09:00–12:00、14:00–18:00，
// 其余（含周末）为空闲时段（波谷），空闲价格为高峰的一半。
const LWFG_CONFIG = {
  timezone: 'Asia/Shanghai',
  weekendValley: true, // 周末全天低谷
  peakWindows: [
    ['09:00', '12:00'], // 工作日早高峰
    ['14:00', '18:00'], // 工作日晚高峰
  ],
}

const LWFG_REFRESH_MS = 1000
const LWFG_PEAK_COLOR = '#f5222d' // 红 ↑ 梁文锋时刻
const LWFG_VALLEY_COLOR = '#16a34a' // 绿 ↓ 梁文谷时刻
const LWFG_CHIP_ATTR = 'data-lwfg-chip'
const LWFG_SUFFIX_ATTR = 'data-lwfg-suffix'
const LWFG_PANEL_ATTR = 'data-lwfg-panel'

let lwfgTimer = null
let lwfgObserver = null
const lwfgObserved = new Set()
let lwfgStarted = false

// 悬浮面板状态
let lwfgPanel = null
let lwfgAnchor = null
let lwfgVisible = false
let lwfgHideTimer = null
let lwfgEscBound = false

function lwfgPhaseNow() {
  return phaseAt(new Date(), LWFG_CONFIG)
}

function lwfgIsDeepseek(text) {
  return /deepseek/i.test(text || '')
}

// ---------- 菜单项内部的小后缀（下拉里使用，不会被截断） ----------
function lwfgFindSuffix(container) {
  for (const child of container.childNodes) {
    if (child.nodeType === 1 && child.getAttribute && child.getAttribute(LWFG_SUFFIX_ATTR) === 'true') {
      return child
    }
  }
  return null
}

function lwfgSetSuffix(container, phase) {
  const text = bracketText(phase)
  let node = lwfgFindSuffix(container)
  if (!node) {
    node = document.createElement('span')
    node.setAttribute(LWFG_SUFFIX_ATTR, 'true')
    node.style.cssText =
      'display:inline-block;margin-left:4px;font-size:12px;font-weight:600;line-height:20px;' +
      'vertical-align:baseline;opacity:0.95;cursor:help;white-space:nowrap;flex:none;'
    container.appendChild(node)
  }
  if (node.textContent !== text) node.textContent = text
  node.style.color = phase.kind === 'peak' ? LWFG_PEAK_COLOR : LWFG_VALLEY_COLOR
  node.title = sentenceOf(new Date(), LWFG_CONFIG)
}

function lwfgRemoveSuffix(container) {
  const node = lwfgFindSuffix(container)
  if (node) node.remove()
}

function lwfgOptionNameSpan(option) {
  const classy = (el) => (typeof el.className === 'string' ? el.className : '')
  let nameSpan = null
  for (const span of option.querySelectorAll('span')) {
    if (/modelName/i.test(classy(span))) {
      nameSpan = span
      break
    }
  }
  if (!nameSpan) {
    const copy = option.querySelector('span')
    if (copy) nameSpan = copy
  }
  return nameSpan
}

function lwfgDecorateMenus(phase) {
  const menus = document.querySelectorAll('[role="menu"]')
  for (const menu of menus) {
    if (!menu.isConnected) continue
    const sections = menu.querySelectorAll('section[role="group"]')
    for (const section of sections) {
      const titleId = section.getAttribute('aria-labelledby')
      let heading = null
      if (titleId) {
        for (const el of menu.querySelectorAll('[id]')) {
          if (el.id === titleId) {
            heading = el
            break
          }
        }
      }
      const groupName = heading ? heading.textContent || '' : ''
      if (!lwfgIsDeepseek(groupName)) continue
      const options = section.querySelectorAll('button[role="menuitemradio"]')
      for (const option of options) {
        const nameSpan = lwfgOptionNameSpan(option)
        if (nameSpan) {
          const raw = (nameSpan.textContent || '').replace(/【[^】]*时刻】/g, '').trim()
          if (lwfgIsDeepseek(raw)) lwfgSetSuffix(nameSpan, phase)
          else lwfgRemoveSuffix(nameSpan)
        }
      }
    }
    const cells = menu.querySelectorAll('button[role="menuitem"]')
    for (const cell of cells) {
      let valueSpan = null
      for (const span of cell.querySelectorAll('span')) {
        const className = typeof span.className === 'string' ? span.className : ''
        if (/cellValue|value/i.test(className)) {
          valueSpan = span
          break
        }
      }
      if (valueSpan) {
        const raw = (valueSpan.textContent || '').replace(/【[^】]*时刻】/g, '').trim()
        if (lwfgIsDeepseek(raw)) lwfgSetSuffix(valueSpan, phase)
        else lwfgRemoveSuffix(valueSpan)
      }
    }
  }
}

// ---------- 触发器定位 ----------
function lwfgRawNameOf(title, labelText) {
  const part = String(title || '').split(' · ')[0].trim()
  if (part) return part
  return String(labelText || '').replace(/【[^】]*时刻】/g, '').trim()
}

function lwfgFindTriggers() {
  const out = []
  const seen = new Set()
  const roots = document.querySelectorAll('[data-composer-seat]')
  const anchors = roots.length > 0 ? roots : [document]
  for (const root of anchors) {
    for (const button of root.querySelectorAll('button')) {
      if (seen.has(button)) continue
      if (button.getAttribute('aria-haspopup') !== 'menu') continue
      const title = button.getAttribute('title') || ''
      if (!title) continue
      let labelSpan = null
      for (const child of button.childNodes) {
        if (child.nodeType === 1 && child.tagName === 'SPAN') {
          labelSpan = child
          break
        }
      }
      if (!labelSpan) continue
      const buttonClass = typeof button.className === 'string' ? button.className : ''
      const spanClass = typeof labelSpan.className === 'string' ? labelSpan.className : ''
      const labelText = labelSpan.textContent || ''
      const looksModel =
        /trigger/i.test(buttonClass) ||
        /triggerLabel/i.test(spanClass) ||
        lwfgIsDeepseek(title) ||
        lwfgIsDeepseek(labelText)
      if (!looksModel) continue
      seen.add(button)
      const rawName = lwfgRawNameOf(title, labelText)
      out.push({
        button,
        root: button.parentElement, // ModelSelect 根容器（含按钮与下拉）
        row: button.parentElement ? button.parentElement.parentElement : null, // composer 尾部 flex 行
        rawName,
        deepseek: lwfgIsDeepseek(rawName) || lwfgIsDeepseek(title),
      })
    }
  }
  return out
}

// ---------- 悬浮面板 ----------
function lwfgEnsurePanel() {
  if (lwfgPanel) return
  const panel = document.createElement('div')
  panel.setAttribute(LWFG_PANEL_ATTR, 'true')
  panel.style.cssText =
    'position:fixed;z-index:2147483000;pointer-events:none;opacity:0;visibility:hidden;' +
    'background:var(--dsw-specific-menu, rgba(30,32,38,0.96));' +
    'color:var(--dsw-alias-label-primary, #f2f2f2);' +
    'border:1px solid var(--dsw-alias-border-inverted, rgba(255,255,255,0.14));' +
    'border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,0.22);padding:9px 12px;' +
    'font-size:12px;line-height:1.55;max-width:min(380px,calc(100vw - 24px));' +
    'transition:opacity 0.12s ease;'
  const line = document.createElement('div')
  line.setAttribute('data-lwfg-line', 'true')
  line.style.cssText = 'font-weight:600;white-space:nowrap;'
  const sub = document.createElement('div')
  sub.setAttribute('data-lwfg-sub', 'true')
  sub.style.cssText = 'opacity:0.72;margin-top:4px;'
  panel.appendChild(line)
  panel.appendChild(sub)
  document.body.appendChild(panel)
  lwfgPanel = panel
}

function lwfgPositionPanel(anchor) {
  if (!lwfgPanel || !anchor) return
  const rect = anchor.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  lwfgPanel.style.visibility = 'visible'
  const pw = lwfgPanel.offsetWidth
  const ph = lwfgPanel.offsetHeight
  let left = rect.left + rect.width / 2 - pw / 2
  left = Math.max(8, Math.min(left, vw - pw - 8))
  let top = rect.top - ph - 8
  if (top < 8) top = rect.bottom + 8
  if (top + ph > vh - 8) top = Math.max(8, vh - ph - 8)
  lwfgPanel.style.left = `${left}px`
  lwfgPanel.style.top = `${top}px`
}

function lwfgRefreshPanel(forcePosition = false) {
  if (!lwfgVisible || !lwfgAnchor || !lwfgPanel) return
  try {
    const phase = lwfgPhaseNow()
    const line = lwfgPanel.querySelector('[data-lwfg-line]')
    const sub = lwfgPanel.querySelector('[data-lwfg-sub]')
    if (line) lwfgRenderColoredSentence(line, sentenceOf(new Date(), LWFG_CONFIG))
    if (sub) sub.textContent = describe(LWFG_CONFIG)
    if (forcePosition || lwfgPanel.style.opacity === '0') {
      lwfgPositionPanel(lwfgAnchor)
    }
    lwfgPanel.style.opacity = '1'
  } catch (_) { /* noop */ }
}

// 把句子里出现的名称按文字本身着色：梁文锋时刻→红，梁文谷时刻→绿。
// 其它文字保持普通文本，避免 innerHTML 引入注入/转义问题。
function lwfgRenderColoredSentence(line, sentence) {
  const cfg = mergeConfig(LWFG_CONFIG)
  const peakLabel = cfg.labels.peak
  const valleyLabel = cfg.labels.valley
  const key = `${peakLabel}|${valleyLabel}|${sentence}`
  if (line.__lwfgRendered === key) return
  line.__lwfgRendered = key
  const escapeRe = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(${escapeRe(peakLabel)}|${escapeRe(valleyLabel)})`, 'g')
  const tokens = String(sentence).split(pattern)
  line.textContent = ''
  for (const token of tokens) {
    if (!token) continue
    if (token === peakLabel) {
      const span = document.createElement('span')
      span.style.color = LWFG_PEAK_COLOR
      span.style.fontWeight = 600
      span.textContent = token
      line.appendChild(span)
    } else if (token === valleyLabel) {
      const span = document.createElement('span')
      span.style.color = LWFG_VALLEY_COLOR
      span.style.fontWeight = 600
      span.textContent = token
      line.appendChild(span)
    } else {
      line.appendChild(document.createTextNode(token))
    }
  }
}

function lwfgShowPanel(button) {
  lwfgEnsurePanel()
  lwfgAnchor = button
  lwfgVisible = true
  if (lwfgHideTimer) {
    clearTimeout(lwfgHideTimer)
    lwfgHideTimer = null
  }
  lwfgRefreshPanel(true)
}

function lwfgHidePanelSoon() {
  if (!lwfgVisible) return
  if (lwfgHideTimer) clearTimeout(lwfgHideTimer)
  lwfgHideTimer = setTimeout(() => {
    lwfgHideTimer = null
    lwfgVisible = false
    lwfgAnchor = null
    if (lwfgPanel) {
      lwfgPanel.style.opacity = '0'
      lwfgPanel.style.visibility = 'hidden'
    }
  }, 260)
}

function lwfgHidePanelNow() {
  if (lwfgHideTimer) {
    clearTimeout(lwfgHideTimer)
    lwfgHideTimer = null
  }
  lwfgVisible = false
  lwfgAnchor = null
  if (lwfgPanel) {
    lwfgPanel.style.opacity = '0'
    lwfgPanel.style.visibility = 'hidden'
  }
}

function lwfgBindTrigger(button) {
  if (!button || button.getAttribute('data-lwfg-hover') === 'true') return
  button.setAttribute('data-lwfg-hover', 'true')
  button.addEventListener('mouseenter', () => lwfgShowPanel(button))
  button.addEventListener('mouseleave', lwfgHidePanelSoon)
  button.addEventListener('focus', () => lwfgShowPanel(button))
  button.addEventListener('blur', lwfgHidePanelSoon)
}

function lwfgBindEscape() {
  if (lwfgEscBound) return
  lwfgEscBound = true
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') lwfgHidePanelNow()
  })
}

// ---------- 常驻箭头 chip ----------
function lwfgChipCss() {
  return (
    'display:inline-flex;align-items:center;justify-content:center;' +
    'margin-left:2px;flex:none;cursor:default;user-select:none;' +
    'font-size:12px;line-height:1;'
  )
}

function lwfgRowHasChip(row) {
  for (const child of row.children) {
    if (child.nodeType === 1 && child.getAttribute && child.getAttribute(LWFG_CHIP_ATTR) === 'true') {
      return true
    }
  }
  return false
}

function lwfgCreateChip(trigger, phase) {
  const chip = document.createElement('span')
  chip.setAttribute(LWFG_CHIP_ATTR, 'true')
  chip.style.cssText = lwfgChipCss()
  chip.setAttribute('role', 'img')
  chip.addEventListener('mouseenter', () => lwfgShowPanel(trigger.button))
  chip.addEventListener('mouseleave', lwfgHidePanelSoon)
  lwfgSyncChip(chip, phase)
  trigger.row.insertBefore(chip, trigger.root.nextSibling)
  return chip
}

function lwfgSyncChip(chip, phase) {
  const peak = phase.kind === 'peak'
  const glyph = peak ? '▲' : '▼'
  const color = peak ? LWFG_PEAK_COLOR : LWFG_VALLEY_COLOR
  if (chip.textContent !== glyph) chip.textContent = glyph
  if (chip.style.color !== color) chip.style.color = color
  const aria = peak
    ? '当前为梁文锋时刻（波峰）'
    : '当前为梁文谷时刻（波谷）'
  if (chip.getAttribute('aria-label') !== aria) chip.setAttribute('aria-label', aria)
}

function lwfgUpdateChips(phase, triggers) {
  // 先清掉孤儿/非 DeepSeek 的 chip
  const desiredRows = new Set()
  for (const t of triggers) {
    if (t.deepseek && t.row) desiredRows.add(t.row)
  }
  const chips = document.querySelectorAll(`[${LWFG_CHIP_ATTR}="true"]`)
  for (const chip of [...chips]) {
    if (!chip.parentElement || !desiredRows.has(chip.parentElement)) {
      chip.remove()
      continue
    }
    // 顺序校正：紧跟对应 root 之后
    let root = null
    for (const t of triggers) {
      if (t.deepseek && t.row === chip.parentElement) {
        root = t.root
        break
      }
    }
    if (root && chip.previousElementSibling !== root) {
      chip.parentElement.insertBefore(chip, root.nextSibling)
    }
  }
  // 为每个 DeepSeek 行补齐 chip 并同步状态
  for (const t of triggers) {
    if (!t.deepseek || !t.row || !t.root) continue
    if (!lwfgRowHasChip(t.row)) lwfgCreateChip(t, phase)
  }
  for (const chip of document.querySelectorAll(`[${LWFG_CHIP_ATTR}="true"]`)) {
    lwfgSyncChip(chip, phase)
  }
}

// ---------- 主循环 ----------
function lwfgTick() {
  if (!lwfgStarted || typeof document === 'undefined' || !document.body) return
  if (document.hidden) return
  let phase
  try {
    phase = lwfgPhaseNow()
  } catch (_) {
    return
  }
  try {
    const triggers = lwfgFindTriggers()
    for (const t of triggers) lwfgBindTrigger(t.button)
    lwfgUpdateChips(phase, triggers)
    lwfgDecorateMenus(phase)
    if (lwfgObserver) {
      for (const t of triggers) {
        const parent = t.row || t.button.parentElement
        if (parent && !lwfgObserved.has(parent)) {
          lwfgObserved.add(parent)
          lwfgObserver.observe(parent, { childList: true, subtree: true })
        }
      }
    }
    if (lwfgVisible && lwfgAnchor && lwfgAnchor.isConnected) lwfgRefreshPanel(false)
    else if (lwfgVisible) lwfgHidePanelNow()
  } catch (_) { /* noop */ }
}

function lwfgScheduleTick() {
  if (lwfgTimer) return
  lwfgTimer = setInterval(lwfgTick, LWFG_REFRESH_MS)
  if (lwfgTimer && lwfgTimer.unref) lwfgTimer.unref()
}

function lwfgStart() {
  if (lwfgStarted) return
  lwfgStarted = true
  if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    lwfgObserver = new MutationObserver(() => {
      if (!lwfgTimer) lwfgTick()
    })
  }
  if (typeof document !== 'undefined' && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (!lwfgStarted) return
      lwfgBindEscape()
      lwfgTick()
      lwfgScheduleTick()
    }, { once: true })
  } else {
    lwfgBindEscape()
    lwfgTick()
    lwfgScheduleTick()
  }
}

function lwfgStop() {
  lwfgStarted = false
  lwfgHidePanelNow()
  if (lwfgTimer) {
    clearInterval(lwfgTimer)
    lwfgTimer = null
  }
  if (lwfgObserver) {
    lwfgObserver.disconnect()
    lwfgObserver = null
  }
  lwfgObserved.clear()
  if (typeof document !== 'undefined' && document.body) {
    try {
      const nodes = document.querySelectorAll(
        `[${LWFG_CHIP_ATTR}="true"], [${LWFG_SUFFIX_ATTR}="true"], [${LWFG_PANEL_ATTR}="true"]`,
      )
      for (const node of nodes) node.remove()
    } catch (_) { /* noop */ }
  }
}

function apply(_ctx) {
  if (_ctx && typeof _ctx.effect === 'function') {
    _ctx.effect(() => {
      lwfgStart()
      return lwfgStop
    })
  } else {
    lwfgStart()
  }
}

module.exports = {
  name: 'dsh-liangwenfeng-moment-client',
  inject: [],
  apply,
}
