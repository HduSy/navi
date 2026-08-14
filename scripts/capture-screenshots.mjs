#!/usr/bin/env node
/**
 * 产品截图自动化：通过 CDP 驱动 dev 模式的 Navi 窗口，逐页导航 + 高清截图。
 *
 * 前置：`pnpm dev` 已启动（main 进程 dev 模式开了 remote-debugging-port=9223）。
 * 用法：node scripts/capture-screenshots.mjs
 * 产物：docs/screenshots/*.png（1280x832 @2x = 2560x1664）
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '../docs/screenshots')
const CDP_HTTP = 'http://127.0.0.1:9223'
const APP_URL_PREFIX = 'http://localhost:5173/#'

/** 截图清单：路由 + 文件名 + 截图前可选的 DOM 交互 */
const SHOTS = [
  { hash: '/', name: 'chat', wait: 1200 },
  { hash: '/timeline', name: 'timeline', wait: 1000 },
  { hash: '/diary', name: 'diary', wait: 1000 },
  { hash: '/projects', name: 'projects', wait: 1000 },
  { hash: '/wiki', name: 'experiences', wait: 1000 },
  { hash: '/personality', name: 'personality', wait: 1000 },
  { hash: '/skills', name: 'skills', wait: 1000 },
  { hash: '/relations', name: 'relations', wait: 1600 },
  { hash: '/brain', name: 'brain', wait: 1000 },
  // 大脑配置抽屉：进入 brain 后点击第一张 scope 卡片
  {
    hash: '/brain',
    name: 'brain-config',
    wait: 600,
    beforeShot: `(() => {
      const cards = document.querySelectorAll('article')
      if (cards[0]) cards[0].dispatchEvent(new MouseEvent('click', { bubbles: true }))
      return cards.length
    })()`,
    afterWait: 700
  }
]

let msgId = 0
const pending = new Map()

function send(ws, method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++msgId
    pending.set(id, { res, rej })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function main() {
  // 1. 找 Navi 的 page target
  const targets = await (await fetch(`${CDP_HTTP}/json`)).json()
  const page = targets.find((t) => t.type === 'page' && /5173|Navi/i.test(t.url + t.title))
  if (!page) {
    console.error('未找到 Navi 窗口 target，确认 pnpm dev 已启动。现有 targets:')
    targets.forEach((t) => console.error(`  [${t.type}] ${t.title} — ${t.url}`))
    process.exit(1)
  }
  console.log(`找到窗口：${page.title} (${page.url})`)

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = () => { console.log('ws open'); res() }
    ws.onerror = (e) => rej(new Error('ws error: ' + e.message))
  })
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data))
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result)
    }
  }
  ws.onclose = (ev) => console.log(`ws closed: code=${ev.code}`)

  // 2. 固定视口 1280x832 @2x（截图高清，页面布局与窗口一致）
  await send(ws, 'Page.enable')
  await send(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 832,
    deviceScaleFactor: 2,
    mobile: false
  })

  mkdirSync(OUT_DIR, { recursive: true })

  // 3. 逐页导航 + 截图
  for (const shot of SHOTS) {
    await send(ws, 'Page.navigate', { url: APP_URL_PREFIX + shot.hash })
    await sleep(shot.wait)
    if (shot.beforeShot) {
      const r = await send(ws, 'Runtime.evaluate', { expression: shot.beforeShot })
      console.log(`  交互 ${shot.name}: ${r?.result?.value}`)
      await sleep(shot.afterWait ?? 400)
    }
    const { data } = await send(ws, 'Page.captureScreenshot', { format: 'png' })
    writeFileSync(resolve(OUT_DIR, `${shot.name}.png`), Buffer.from(data, 'base64'))
    console.log(`✓ ${shot.name}.png`)
  }

  ws.close()
  console.log(`\n完成，共 ${SHOTS.length} 张 → ${OUT_DIR}`)
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

main().catch((e) => {
  console.error('截图失败：', e)
  process.exit(1)
})
