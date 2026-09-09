/**
 * dsh-liangwenfeng-moment 宿主侧入口（Cordis 插件）。
 * 真正的“实时显示”在浏览器端 client bundle（./lib/client.js）完成：
 * 它扫描对话窗口右下角模型切换控件，给 DeepSeek 模型名后追加
 * 【梁文锋时刻】（波峰）或【梁文谷时刻】（波谷），并每秒刷新。
 *
 * 宿主侧只负责：随 loader 一起被启用/禁用、提供配置声明供 cordis.patch.yml 使用。
 */
import Schema from '@deepseek-ai/schemastery'
import { DEFAULTS } from './wave.js'

export const name = 'dsh-liangwenfeng-moment'

// 纯展示插件：不需要任何宿主服务。
export const inject = []

export const Config = Schema.object({
  enabled: Schema.boolean().default(true).description('启用右下角模型切换处的波峰/波谷时刻显示'),
  timezone: Schema.string().default(DEFAULTS.timezone).description('判峰谷所用的时区（IANA，如 Asia/Shanghai）'),
  weekendValley: Schema.boolean().default(DEFAULTS.weekendValley).description('周末全天按低谷（波谷）处理'),
  valleyStart: Schema.string().default(DEFAULTS.valleyStart).description('工作日低谷窗口开始（HH:mm，北京时间）'),
  valleyEnd: Schema.string().default(DEFAULTS.valleyEnd).description('工作日低谷窗口结束（HH:mm，北京时间）'),
}).description('DeepSeek 波峰/波谷时刻（梁文锋时刻 / 梁文谷时刻）')

export function apply(ctx, config = {}) {
  const logger = ctx?.logger ?? console
  if (config.enabled === false) {
    logger.info?.('[dsh-liangwenfeng-moment] disabled，未启用波峰/波谷时刻显示')
    return
  }
  logger.info?.('[dsh-liangwenfeng-moment] enabled：波峰显示【梁文锋时刻】，波谷显示【梁文谷时刻】')
}

export { DEFAULTS }
