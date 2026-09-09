/**
 * 构建浏览器端 client bundle：把 src/wave.js（去掉 ESM 语法）与
 * client-src/body.js 拼进 client-src/template.js，输出到 lib/client.js。
 * 用法：node scripts/build-client.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function stripEsm(raw) {
  // 去掉 default export 对象块（行内无嵌套花括号的对象字面量，收尾 `}` 独占一行）
  let out = raw.replace(/\nexport default \{\n[\s\S]*?\n\}\s*$/m, '')
  // 去掉其它行首 export 关键字
  out = out.replace(/^export\s+/gm, '')
  return out
}

const wavePlain = stripEsm(readFileSync(resolve(root, 'src', 'wave.js'), 'utf8'))
const body = readFileSync(resolve(root, 'client-src', 'body.js'), 'utf8')
let output = readFileSync(resolve(root, 'client-src', 'template.js'), 'utf8')
output = output.replace('//__LWFG_WAVE__//', () => wavePlain.trimEnd())
output = output.replace('//__LWFG_BODY__//', () => body.trimEnd())

mkdirSync(resolve(root, 'lib'), { recursive: true })
writeFileSync(resolve(root, 'lib', 'client.js'), output)
console.log(`[build-client] wrote lib/client.js (${output.length} bytes)`)
