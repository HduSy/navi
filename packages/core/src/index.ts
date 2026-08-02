/**
 * @navi/core - Navi 的核心：数据模型 + 采集器 + ingest/query/lint pipeline
 *
 * 零 Electron 依赖，可被 main 进程和测试直接使用。
 */

export const CORE_VERSION = '0.1.0'

export * from './types.js'
export * from './collector.js'
export * from './discover.js'
export * from './claude-config.js'
export * from './util.js'
export * from './schema.js'
export * from './wiki.js'
