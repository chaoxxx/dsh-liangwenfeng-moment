/**
 * 验证 dsh-liangwenfeng-moment 是否已真正被 DSH Desktop 加载。
 * 用法：node scripts/verify-install.mjs
 *
 * 输出分两部分：
 *  1) 文件/配置层是否就位（vendor tgz、desktop profile package.json、node_modules 模块、client bundle）
 *  2) 运行时层：拉取 GUI 首页注入的 __DSH_BOOT__ 清单，检查是否包含本插件
 *     （若未包含，说明 loader 还没重载 —— 需重启 DSH Desktop 或到 设置→插件 里重载后重试）。
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const VENDOR = 'C:/Users/zhuchao/.dsh/vendor/dsh-liangwenfeng-moment-0.1.0.tgz'
const PROFILE_PKG = 'C:/Users/zhuchao/.dsh/profiles/desktop/package.json'
const MODULE_DIR = 'C:/Users/zhuchao/.dsh/profiles/desktop/node_modules/dsh-liangwenfeng-moment'
const CLIENT_BUNDLE = join(MODULE_DIR, 'lib', 'client.js')
const WEB_URL = process.env.DSH_WEB_URL ?? 'http://127.0.0.1:55950/'

let failed = false
const ok = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`)
  if (!cond) failed = true
}

ok(existsSync(VENDOR), `vendor tgz 存在: ${VENDOR}`)
ok(existsSync(PROFILE_PKG), 'desktop profile package.json 存在')

if (existsSync(PROFILE_PKG)) {
  let raw = readFileSync(PROFILE_PKG, 'utf8')
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
  const pkg = JSON.parse(raw)
  ok(
    pkg.dependencies?.['dsh-liangwenfeng-moment'] !== undefined,
    'package.json dependencies 含 dsh-liangwenfeng-moment',
  )
  ok(
    (pkg.dsh?.profile?.bundles ?? []).includes('dsh-liangwenfeng-moment'),
    'package.json dsh.profile.bundles 含 dsh-liangwenfeng-moment',
  )
}
ok(existsSync(MODULE_DIR), `模块已装入 node_modules: ${MODULE_DIR}`)
ok(existsSync(CLIENT_BUNDLE), 'client bundle lib/client.js 存在')

console.log('--- 运行时层（需要 DSH Desktop 已重载 loader）---')
try {
  const response = await fetch(WEB_URL)
  const html = await response.text()
  const found = html.includes('dsh-liangwenfeng-moment')
  ok(found, `GUI 启动清单(__DSH_BOOT__) 包含 dsh-liangwenfeng-moment（GET ${WEB_URL}）`)
  if (!found) {
    console.log('提示：未包含说明 loader 仍在使用旧组合。请完全退出并重开 DSH Desktop，')
    console.log('或打开 设置 → 插件 并触发一次重载，然后重跑本脚本。')
  } else {
    console.log('插件已被 DSH Desktop 组合进启动清单，页面刷新后即可在模型切换处看到时刻徽标。')
  }
} catch (error) {
  ok(false, `无法访问 ${WEB_URL}: ${error?.message ?? error}`)
}

process.exit(failed ? 1 : 0)
