import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import vm from 'node:vm'

import {
  DEFAULTS,
  phaseAt,
  bracketText,
  describe,
  nextTransition,
  countdownText,
  sentenceOf,
} from '../src/wave.js'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

/** 构造一个“北京时间墙钟为给定值”的时刻（Asia/Shanghai 固定 UTC+8）。 */
function bjTime(year, month1, day, hour, minute = 0, second = 0) {
  return new Date(Date.UTC(year, month1 - 1, day, hour, minute, second) - 8 * 3600 * 1000)
}

test('DEFAULTS 使用北京时间与 DeepSeek 官网高峰窗口', () => {
  assert.equal(DEFAULTS.timezone, 'Asia/Shanghai')
  assert.deepEqual(DEFAULTS.peakWindows, [['09:00', '12:00'], ['14:00', '18:00']])
  assert.equal(DEFAULTS.weekendValley, true)
  assert.equal(DEFAULTS.labels.peak, '梁文锋时刻')
  assert.equal(DEFAULTS.labels.valley, '梁文谷时刻')
})

test('工作日波峰/波谷判定（2026-09-10 是周四）', () => {
  // 高峰窗口 09:00–12:00、14:00–18:00；其余为空闲（波谷）
  assert.equal(phaseAt(bjTime(2026, 9, 10, 4, 0)).kind, 'valley')
  assert.equal(phaseAt(bjTime(2026, 9, 10, 8, 59)).kind, 'valley')
  assert.equal(phaseAt(bjTime(2026, 9, 10, 9, 0)).kind, 'peak')
  assert.equal(phaseAt(bjTime(2026, 9, 10, 11, 59)).kind, 'peak')
  // 12:00–14:00 午间为空闲
  assert.equal(phaseAt(bjTime(2026, 9, 10, 12, 0)).kind, 'valley')
  assert.equal(phaseAt(bjTime(2026, 9, 10, 13, 0)).kind, 'valley')
  assert.equal(phaseAt(bjTime(2026, 9, 10, 14, 0)).kind, 'peak')
  assert.equal(phaseAt(bjTime(2026, 9, 10, 17, 59)).kind, 'peak')
  // 18:00 后为空闲
  assert.equal(phaseAt(bjTime(2026, 9, 10, 18, 0)).kind, 'valley')
  assert.equal(phaseAt(bjTime(2026, 9, 10, 20, 0)).kind, 'valley')
  assert.equal(phaseAt(bjTime(2026, 9, 10, 23, 59)).kind, 'valley')
  // 周四（weekday=4）
  assert.equal(phaseAt(bjTime(2026, 9, 10, 9, 0)).weekday, 4)
  assert.equal(phaseAt(bjTime(2026, 9, 10, 9, 0)).weekend, false)
})

test('周末全天波谷（2026-09-12 周六 / 09-13 周日）', () => {
  assert.equal(phaseAt(bjTime(2026, 9, 12, 15, 0)).kind, 'valley')
  assert.equal(phaseAt(bjTime(2026, 9, 12, 10, 0)).kind, 'valley')
  assert.equal(phaseAt(bjTime(2026, 9, 12, 0, 0)).kind, 'valley')
  assert.equal(phaseAt(bjTime(2026, 9, 13, 9, 0)).kind, 'valley')
  assert.equal(phaseAt(bjTime(2026, 9, 13, 16, 0)).kind, 'valley')
  assert.equal(phaseAt(bjTime(2026, 9, 12, 15, 0)).weekend, true)
})

test('周一高峰窗口照常（2026-09-14 是周一）', () => {
  assert.equal(phaseAt(bjTime(2026, 9, 14, 0, 0)).kind, 'valley')
  assert.equal(phaseAt(bjTime(2026, 9, 14, 8, 59)).kind, 'valley')
  assert.equal(phaseAt(bjTime(2026, 9, 14, 9, 0)).kind, 'peak')
  assert.equal(phaseAt(bjTime(2026, 9, 14, 10, 30)).kind, 'peak')
  assert.equal(phaseAt(bjTime(2026, 9, 14, 12, 0)).kind, 'valley')
  assert.equal(phaseAt(bjTime(2026, 9, 14, 15, 0)).kind, 'peak')
  assert.equal(phaseAt(bjTime(2026, 9, 14, 18, 0)).kind, 'valley')
})

test('文案：梁文锋时刻 / 梁文谷时刻', () => {
  assert.equal(bracketText(phaseAt(bjTime(2026, 9, 10, 9, 0))), '【梁文锋时刻】')
  assert.equal(bracketText(phaseAt(bjTime(2026, 9, 10, 4, 0))), '【梁文谷时刻】')
  assert.equal(bracketText('梁文锋时刻'), '【梁文锋时刻】')
})

test('describe 提到时区与高峰窗口', () => {
  const text = describe()
  assert.match(text, /Asia\/Shanghai/)
  assert.match(text, /09:00–12:00/)
  assert.match(text, /14:00–18:00/)
  assert.match(text, /周末全天/)
})

test('nextTransition 与 countdownText', () => {
  // 周四 09:00（高峰开始）→ 下一次切换是 12:00（波谷/空闲）
  const t1 = nextTransition(bjTime(2026, 9, 10, 9, 0))
  assert.ok(t1)
  assert.equal(t1.nextKind, 'valley')
  assert.equal(t1.at.getTime(), bjTime(2026, 9, 10, 12, 0).getTime())

  // 周四 12:30（空闲）→ 14:00 切回高峰
  const t2 = nextTransition(bjTime(2026, 9, 10, 12, 30))
  assert.ok(t2)
  assert.equal(t2.nextKind, 'peak')
  assert.equal(t2.at.getTime(), bjTime(2026, 9, 10, 14, 0).getTime())

  // 周四 18:00 空闲 → 周五 09:00 高峰
  const t3 = nextTransition(bjTime(2026, 9, 10, 19, 0))
  assert.ok(t3)
  assert.equal(t3.nextKind, 'peak')
  assert.equal(t3.at.getTime(), bjTime(2026, 9, 11, 9, 0).getTime())

  // 周五 23:00（空闲）→ 周六/周日全天空闲 → 周一 09:00 高峰
  const t4 = nextTransition(bjTime(2026, 9, 11, 23, 0))
  assert.ok(t4)
  assert.equal(t4.nextKind, 'peak')
  assert.equal(t4.at.getTime(), bjTime(2026, 9, 14, 9, 0).getTime())

  // 周六 15:00（周末空闲）→ 周一 09:00 高峰
  const t5 = nextTransition(bjTime(2026, 9, 12, 15, 0))
  assert.ok(t5)
  assert.equal(t5.nextKind, 'peak')
  assert.equal(t5.at.getTime(), bjTime(2026, 9, 14, 9, 0).getTime())

  const cd = countdownText(bjTime(2026, 9, 10, 9, 0))
  assert.match(cd, /距【梁文谷时刻】还有 03:00:00/)
})

test('自定义高峰窗口生效', () => {
  const cfg = { peakWindows: [['12:00', '14:00']] }
  assert.equal(phaseAt(bjTime(2026, 9, 10, 13, 0), cfg).kind, 'peak')
  assert.equal(phaseAt(bjTime(2026, 9, 10, 11, 0), cfg).kind, 'valley')
  assert.equal(phaseAt(bjTime(2026, 9, 10, 15, 0), cfg).kind, 'valley')
})

test('sentenceOf：波峰/波谷悬浮文案与动态倒数', () => {
  // 周四 09:00（波峰）→ 下一次波谷 12:00，剩余 3h → 03:00:00
  const peak = sentenceOf(bjTime(2026, 9, 10, 9, 0, 0))
  assert.match(peak, /^当前为 梁文锋时刻，距离下一次梁文谷时刻还剩 03:00:00$/)

  // 1 秒后剩余 02:59:59（验证每秒动态递减）
  const peakLater = sentenceOf(bjTime(2026, 9, 10, 9, 0, 1))
  assert.match(peakLater, /还剩 02:59:59$/)

  // 周四 12:30（波谷）→ 下一次波峰 14:00，剩余 1.5h
  const valley = sentenceOf(bjTime(2026, 9, 10, 12, 30, 0))
  assert.match(valley, /^当前为 梁文谷时刻，距离下一次梁文锋时刻还剩 01:30:00$/)

  // 周末（周六 15:00 全天谷）→ 下一次波峰 周一 09:00，跨周末 42h
  const weekend = sentenceOf(bjTime(2026, 9, 12, 15, 0, 0))
  assert.match(weekend, /^当前为 梁文谷时刻，距离下一次梁文锋时刻还剩 42:00:00$/)

  // 自定义时段生效
  const cfg = { peakWindows: [['12:00', '14:00']] }
  assert.match(sentenceOf(bjTime(2026, 9, 10, 13, 0, 0), cfg), /^当前为 梁文锋时刻/)
  assert.match(sentenceOf(bjTime(2026, 9, 10, 15, 0, 0), cfg), /^当前为 梁文谷时刻/)
})

test('lib/client.js 语法与模块形态（smoke）', () => {
  const code = readFileSync(resolve(root, 'lib', 'client.js'), 'utf8')
  // 不应残留 ESM 语法
  assert.ok(!/^export\s/m.test(code), 'lib/client.js 不应含 export 语句')
  let captured = null
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(entry) {
          captured = entry
        },
      },
    },
  }
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox)
  assert.ok(captured, 'client bundle 应调用 __ModuleLoader__.load')
  assert.equal(captured.id, 'dsh-liangwenfeng-moment')
  const exportsOf = captured.factory(() => { throw new Error('body 不应 require 任何模块') })
  assert.equal(exportsOf.name, 'dsh-liangwenfeng-moment-client')
  assert.ok(Array.isArray(exportsOf.inject))
  assert.equal(typeof exportsOf.apply, 'function')
  // apply 必须能注册进 ctx.effect（且 effect 返回清理函数）
  let registered = null
  const ctx = { effect: (fn) => { registered = fn } }
  exportsOf.apply(ctx)
  assert.equal(typeof registered, 'function')
})
