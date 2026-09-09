/**
 * dsh-liangwenfeng-moment — 波峰/波谷相位引擎（纯函数，浏览器/Node 通用）。
 *
 * “波峰/波谷”沿用 DeepSeek API 峰谷计价时段的口径：
 *   - 波峰（高峰计价）→ 【梁文锋时刻】
 *   - 波谷（低谷计价）→ 【梁文谷时刻】
 * 默认按北京时间：工作日低谷窗口 valleyStart～valleyEnd，其余为高峰；
 * 周末默认全天低谷（DeepSeek 周末统一按低谷价计费的规则）。
 * 所有时段均可通过配置调整。
 */

export const DEFAULTS = Object.freeze({
  timezone: 'Asia/Shanghai',
  /** 周末是否全天按低谷（波谷）处理。 */
  weekendValley: true,
  /** 工作日低谷窗口起止（北京时间 HH:mm）。窗口外为高峰。 */
  valleyStart: '00:30',
  valleyEnd: '08:30',
  labels: {
    peak: '梁文锋时刻',
    valley: '梁文谷时刻',
  },
})

/** 把 date 换算到指定时区的本地“墙上时间”并取整到 UTC 基准，返回时差毫秒。 */
export function timezoneShiftMs(date, timezone) {
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
export function hmToMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value))
  if (!match) throw new Error(`invalid time "${value}", expected "HH:mm"`)
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`invalid time "${value}", out of range`)
  }
  return hours * 60 + minutes
}

function mergeConfig(config = {}) {
  return {
    timezone: config.timezone ?? DEFAULTS.timezone,
    weekendValley: config.weekendValley ?? DEFAULTS.weekendValley,
    valleyStart: config.valleyStart ?? DEFAULTS.valleyStart,
    valleyEnd: config.valleyEnd ?? DEFAULTS.valleyEnd,
    labels: { ...DEFAULTS.labels, ...(config.labels ?? {}) },
  }
}

/** 计算某一时刻的相位。返回 { kind, label, weekend, weekday, minutes, ... } */
export function phaseAt(date = new Date(), config = {}) {
  const cfg = mergeConfig(config)
  const shifted = new Date(date.getTime() + timezoneShiftMs(date, cfg.timezone))
  const dow = shifted.getUTCDay() // 0=周日 … 6=周六
  const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
  const weekend = dow === 0 || dow === 6

  let valley
  if (weekend && cfg.weekendValley) {
    valley = true
  } else {
    const start = hmToMinutes(cfg.valleyStart)
    const end = hmToMinutes(cfg.valleyEnd)
    valley = start <= end
      ? minutes >= start && minutes < end
      : minutes >= start || minutes < end
  }

  const kind = valley ? 'valley' : 'peak'
  return {
    kind,
    label: cfg.labels[kind],
    weekend,
    weekday: (dow + 6) % 7 + 1, // 1=周一 … 7=周日
    minutes,
    valleyStart: cfg.valleyStart,
    valleyEnd: cfg.valleyEnd,
  }
}

/** 【梁文锋时刻】 / 【梁文谷时刻】 */
export function bracketText(phaseOrLabel) {
  const label = typeof phaseOrLabel === 'string' ? phaseOrLabel : phaseOrLabel.label
  return `【${label}】`
}

/** 人类可读的当前规则描述（tooltip 使用）。 */
export function describe(config = {}) {
  const cfg = mergeConfig(config)
  const windowDesc = cfg.weekendValley
    ? `${cfg.valleyStart}–${cfg.valleyEnd} 低谷，其余高峰；周末全天低谷`
    : `${cfg.valleyStart}–${cfg.valleyEnd} 低谷，其余高峰`
  return `DeepSeek 峰谷计价（${cfg.timezone}）：${windowDesc}`
}

function localDayKey(date, cfg) {
  const shifted = new Date(date.getTime() + timezoneShiftMs(date, cfg.timezone))
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  }
}

/** 计算下一个相位切换时刻。返回 { at: Date, nextKind }；3 天内找不到返回 null。 */
export function nextTransition(date = new Date(), config = {}) {
  const cfg = mergeConfig(config)
  const nowPhase = phaseAt(date, cfg)
  const today = localDayKey(date, cfg)
  const candidates = []
  for (let dayOffset = 0; dayOffset <= 3; dayOffset += 1) {
    const probe = new Date(Date.UTC(today.year, today.month, today.day + dayOffset, 12))
    const dayKey = localDayKey(probe, cfg)
    const midnightUtc = Date.UTC(dayKey.year, dayKey.month, dayKey.day)
    const offset = timezoneShiftMs(new Date(midnightUtc), cfg.timezone)
    const dayStart = midnightUtc - offset
    for (const minute of new Set([0, hmToMinutes(cfg.valleyStart), hmToMinutes(cfg.valleyEnd)])) {
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
export function countdownText(date = new Date(), config = {}) {
  const transition = nextTransition(date, config)
  if (!transition) return ''
  const diffMs = Math.max(0, transition.at.getTime() - date.getTime())
  const total = Math.floor(diffMs / 1000)
  const hh = String(Math.floor(total / 3600)).padStart(2, '0')
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const ss = String(total % 60).padStart(2, '0')
  const nextLabel = DEFAULTS.labels[transition.nextKind]
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
export function sentenceOf(date = new Date(), config = {}) {
  const cfg = mergeConfig(config)
  const phase = phaseAt(date, cfg)
  const transition = nextTransition(date, cfg)
  const nextLabel = transition
    ? cfg.labels[transition.nextKind]
    : (phase.kind === 'peak' ? cfg.labels.valley : cfg.labels.peak)
  const remain = transition ? hhmmssBetween(date, transition.at) : '--:--:--'
  return `当前为 ${phase.label}，距离下一次${nextLabel}还剩 ${remain}`
}
