window.__ModuleLoader__.load({
  id: "dsh-liangwenfeng-moment",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    /**
 * dsh-liangwenfeng-moment — 波峰/波谷相位引擎（纯函数，浏览器/Node 通用）。
 *
 * “波峰/波谷”沿用 DeepSeek API 峰谷计价时段的口径（以 DeepSeek 官网公告为准）：
 *   - 波峰（高峰计价）→ 【梁文锋时刻】
 *   - 波谷（低谷/空闲计价）→ 【梁文谷时刻】
 *
 * 真实规则（北京时间）：
 *   - 高峰时段：周一至周五 09:00–12:00、14:00–18:00（其余时间均为空闲时段）；
 *   - 空闲时段价格为高峰时段价格的一半；
 *   - 周末全天按空闲（波谷）计费。
 * 所有时段均可通过配置调整。
 */

const DEFAULTS = Object.freeze({
  timezone: 'Asia/Shanghai',
  /** 周末是否全天按低谷（波谷）处理。 */
  weekendValley: true,
  /**
   * 高峰（波峰）时段窗口（北京时间 HH:mm，[start, end)）。
   * DeepSeek 官网口径：工作日 09:00–12:00、14:00–18:00。
   */
  peakWindows: [['09:00', '12:00'], ['14:00', '18:00']],
  labels: {
    peak: '梁文锋时刻',
    valley: '梁文谷时刻',
  },
})

/** 把 date 换算到指定时区的本地“墙上时间”并取整到 UTC 基准，返回时差毫秒。 */
function timezoneShiftMs(date, timezone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = {}
  for (const part of dtf.formatToParts(date)) parts[part.type] = part.value
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  )
  return asUtc - date.getTime()
}

/** 解析 'HH:mm' → 当日分钟数（0..1439）。非法输入抛错。 */
function hmToMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value))
  if (!match) throw new Error(`invalid time "${value}", expected "HH:mm"`)
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`invalid time "${value}", out of range`)
  }
  return hours * 60 + minutes
}

/** minutes 是否落在 [startMinute, endMinute) 内（支持跨午夜窗口）。 */
function inWindow(minutes, startMinute, endMinute) {
  return startMinute <= endMinute
    ? minutes >= startMinute && minutes < endMinute
    : minutes >= startMinute || minutes < endMinute
}

function mergeConfig(config = {}) {
  return {
    timezone: config.timezone ?? DEFAULTS.timezone,
    weekendValley: config.weekendValley ?? DEFAULTS.weekendValley,
    peakWindows: config.peakWindows ?? DEFAULTS.peakWindows,
    labels: { ...DEFAULTS.labels, ...(config.labels ?? {}) },
  }
}

/** 计算某一时刻的相位。返回 { kind, label, weekend, weekday, minutes, peakWindows } */
function phaseAt(date = new Date(), config = {}) {
  const cfg = mergeConfig(config)
  const shifted = new Date(date.getTime() + timezoneShiftMs(date, cfg.timezone))
  const dow = shifted.getUTCDay() // 0=周日 … 6=周六
  const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
  const weekend = dow === 0 || dow === 6

  let peak
  if (weekend && cfg.weekendValley) {
    peak = false
  } else {
    peak = cfg.peakWindows.some(([startText, endText]) => {
      const start = hmToMinutes(startText)
      const end = hmToMinutes(endText)
      return inWindow(minutes, start, end)
    })
  }

  const kind = peak ? 'peak' : 'valley'
  return {
    kind,
    label: cfg.labels[kind],
    weekend,
    weekday: (dow + 6) % 7 + 1, // 1=周一 … 7=周日
    minutes,
    peakWindows: cfg.peakWindows,
  }
}

/** 【梁文锋时刻】 / 【梁文谷时刻】 */
function bracketText(phaseOrLabel) {
  const label = typeof phaseOrLabel === 'string' ? phaseOrLabel : phaseOrLabel.label
  return `【${label}】`
}

/** 人类可读的当前规则描述（tooltip 使用）。 */
function describe(config = {}) {
  const cfg = mergeConfig(config)
  const windowDesc = cfg.peakWindows
    .map(([start, end]) => `${start}–${end}`)
    .join('、')
  const dayDesc = cfg.weekendValley
    ? `工作日高峰 ${windowDesc}，其余空闲（半价）；周末全天空闲`
    : `高峰 ${windowDesc}，其余空闲（半价）`
  return `DeepSeek 峰谷计价（${cfg.timezone}）：${dayDesc}`
}

function localDayKey(date, cfg) {
  const shifted = new Date(date.getTime() + timezoneShiftMs(date, cfg.timezone))
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  }
}

/** 收集一天内所有可能发生相位切换的“本地分钟”候选点（升序去重）。 */
function boundaryMinutes(cfg) {
  const set = new Set([0])
  for (const [startText, endText] of cfg.peakWindows) {
    set.add(hmToMinutes(startText))
    set.add(hmToMinutes(endText))
  }
  return [...set].sort((a, b) => a - b)
}

/** 计算下一个相位切换时刻。返回 { at: Date, nextKind }；找不到返回 null。 */
function nextTransition(date = new Date(), config = {}) {
  const cfg = mergeConfig(config)
  const nowPhase = phaseAt(date, cfg)
  const today = localDayKey(date, cfg)
  const minutesList = boundaryMinutes(cfg)
  const candidates = []
  for (let dayOffset = 0; dayOffset <= 3; dayOffset += 1) {
    const probe = new Date(Date.UTC(today.year, today.month, today.day + dayOffset, 12))
    const dayKey = localDayKey(probe, cfg)
    const midnightUtc = Date.UTC(dayKey.year, dayKey.month, dayKey.day)
    const offset = timezoneShiftMs(new Date(midnightUtc), cfg.timezone)
    const dayStart = midnightUtc - offset
    for (const minute of minutesList) {
      candidates.push(new Date(dayStart + minute * 60000))
    }
  }
  for (const candidate of candidates) {
    const when = candidate.getTime()
    if (when <= date.getTime()) continue
    const phase = phaseAt(candidate, cfg)
    if (phase.kind !== nowPhase.kind) {
      return { at: candidate, nextKind: phase.kind }
    }
  }
  return null
}

/** 距下一次切换的人类可读描述，如 “距低谷切换还有 03:12:05”。 */
function countdownText(date = new Date(), config = {}) {
  const cfg = mergeConfig(config)
  const transition = nextTransition(date, cfg)
  if (!transition) return ''
  const diffMs = Math.max(0, transition.at.getTime() - date.getTime())
  const total = Math.floor(diffMs / 1000)
  const hh = String(Math.floor(total / 3600)).padStart(2, '0')
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const ss = String(total % 60).padStart(2, '0')
  const nextLabel = cfg.labels[transition.nextKind]
  return `距【${nextLabel}】还有 ${hh}:${mm}:${ss}`
}

function hhmmssBetween(date, target) {
  if (!target) return null
  const diffMs = Math.max(0, target.getTime() - date.getTime())
  const total = Math.floor(diffMs / 1000)
  const hh = String(Math.floor(total / 3600)).padStart(2, '0')
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const ss = String(total % 60).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

/**
 * 悬浮主文案（每秒重算即得到动态倒计时）：
 *   波峰：当前为 梁文锋时刻，距离下一次梁文谷时刻还剩 07:12:33
 *   波谷：当前为 梁文谷时刻，距离下一次梁文锋时刻还剩 01:02:03
 */
function sentenceOf(date = new Date(), config = {}) {
  const cfg = mergeConfig(config)
  const phase = phaseAt(date, cfg)
  const transition = nextTransition(date, cfg)
  const nextLabel = transition
    ? cfg.labels[transition.nextKind]
    : (phase.kind === 'peak' ? cfg.labels.valley : cfg.labels.peak)
  const remain = transition ? hhmmssBetween(date, transition.at) : '--:--:--'
  return `当前为 ${phase.label}，距离下一次${nextLabel}还剩 ${remain}`
}

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

    return module.exports;
  }
});
