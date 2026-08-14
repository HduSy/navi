import { app, BrowserWindow, shell, ipcMain } from 'electron'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import { getDb } from './db.js'
import { getWiki } from './wiki-host.js'
import { ingestAllSessions, getSessionStats, generateTimelineForHour, generateTimelineForDay, regenerateAllTimeline, generateDiary, generateExperiencesForSession, generatePersonsForSession } from './ingest.js'
import { sendMessage, getRecentMessages } from './dialogue.js'
import { getPersonality, setPersonalityDimensions, setPersonalityFreeText, type PersonalityDimensions } from './personality.js'
import { getBrain, getAllBrain, getClaudeConfigStatus, saveBrainConfig, clearBrainConfig, isBrainCustomized, getSecretProtectionStatus } from './brain-host.js'
import { lintWiki } from './lint.js'
import { startScheduler } from './scheduler.js'
import { initCognitionSync, runCognitionSync, getCognitionSyncStatus } from './cognition-sync.js'
import {
  projects,
  sessions,
  skills,
  timelineEntries,
  experiences,
  persons,
  relationships,
  diaries,
  personalityHistory,
  fromLocalDateStr
} from '@navi/core'
import { eq, desc } from 'drizzle-orm'
import type { BrainScope, BrainProviderConfig } from '@navi/brain'
import { PROVIDER_PRESETS } from '@navi/brain'

const __dirname = dirname(fileURLToPath(import.meta.url))
const isDev = !app.isPackaged

// dev 模式开 CDP 调试端口（截图自动化 / DevTools 调试用），打包版不带
if (isDev) app.commandLine.appendSwitch('remote-debugging-port', '9223')

/** 安全日志：stdout 管道关闭时（dev server 退出）不抛 EPIPE */
function safeLog(...args: unknown[]): void {
  try {
    console.log(...args)
  } catch {
    // EPIPE / 写入失败时静默吞掉，避免主进程崩溃
  }
}

// 兜底：捕获 stdout/stderr 的 EPIPE，防止 setTimeout/setInterval 里的日志把进程干崩
process.stdout?.on?.('error', () => {})
process.stderr?.on?.('error', () => {})
process.on('uncaughtException', (e: NodeJS.ErrnoException) => {
  if (e?.code === 'EPIPE') return
  safeLog('[navi] uncaughtException:', e)
})

function createWindow(): void {
  const iconPath = join(__dirname, '../../resources/icon.png')
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1100,
    minHeight: 700,
    title: 'Navi',
    backgroundColor: '#ffffff',
    titleBarStyle: 'hiddenInset',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('console-message', (_e, _level, message, _line, _source) => {
    safeLog(`[renderer] ${message}`)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    safeLog(`[renderer-gone] ${JSON.stringify(details)}`)
  })
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    win.webContents.openDevTools()
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/* ───────────── IPC 注册 ───────────── */

// 采集
ipcMain.handle('navi:getSessionStats', () => getSessionStats())
ipcMain.handle('navi:ingest', () => ingestAllSessions())

// 对话
ipcMain.handle('navi:sendMessage', (_e, msg: string) => sendMessage(msg))
ipcMain.handle('navi:getRecentMessages', () => getRecentMessages(50))

// 人格
ipcMain.handle('navi:getPersonality', () => getPersonality())
ipcMain.handle('navi:setPersonalityDimensions', (_e, dims: Partial<PersonalityDimensions>) =>
  setPersonalityDimensions(dims, 'manual')
)
ipcMain.handle('navi:setPersonalityFreeText', (_e, text: string) =>
  setPersonalityFreeText(text, 'manual')
)
ipcMain.handle('navi:getPersonalityHistory', () =>
  getDb().select().from(personalityHistory).orderBy(desc(personalityHistory.createdAt)).limit(20).all()
)

// 大脑（DB 优先 → fallback ~/.claude/settings.json）
ipcMain.handle('navi:getAllBrain', () => getAllBrain())
ipcMain.handle('navi:getBrain', (_e, scope: BrainScope) => getBrain(scope))
ipcMain.handle('navi:getProviderPresets', () => PROVIDER_PRESETS)
ipcMain.handle('navi:getClaudeConfigStatus', () => getClaudeConfigStatus())
ipcMain.handle('navi:isBrainCustomized', (_e, scope: BrainScope) => isBrainCustomized(scope))
ipcMain.handle('navi:getSecretProtectionStatus', () => getSecretProtectionStatus())
ipcMain.handle('navi:saveBrain', (_e, scope: BrainScope, cfg: BrainProviderConfig) => {
  saveBrainConfig(scope, cfg)
  return getBrain(scope)
})
ipcMain.handle('navi:clearBrain', (_e, scope: BrainScope) => {
  clearBrainConfig(scope)
  return getBrain(scope)
})
ipcMain.handle('navi:testBrain', async (_e, cfg: BrainProviderConfig) => {
  const { testConnection } = await import('@navi/brain')
  return testConnection({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model, protocol: cfg.protocol })
})
ipcMain.handle('navi:fetchBrainModels', async (_e, cfg: BrainProviderConfig) => {
  const { fetchModels } = await import('@navi/brain')
  return fetchModels({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, protocol: cfg.protocol })
})

// 时间线
ipcMain.handle('navi:getTimeline', (_e, date?: string) => {
  const rows = getDb().select().from(timelineEntries).orderBy(desc(timelineEntries.hourStart)).all()
  if (!date) return rows.slice(0, 100)
  const dayStartMs = fromLocalDateStr(date)
  if (Number.isNaN(dayStartMs)) return { entries: [], hasSessions: false }
  const dayEndMs = dayStartMs + 86_400_000 - 1
  const dayEntries = rows.filter((t) => t.hourStart >= dayStartMs && t.hourStart <= dayEndMs)
  // 当天是否有 session（用于区分"啥也没干" vs "正在干但还没到整点"）
  const hasSessions = getDb()
    .select({ startedAt: sessions.startedAt, endedAt: sessions.endedAt })
    .from(sessions)
    .all()
    .some((s) => s.startedAt < dayEndMs && s.endedAt >= dayStartMs)
  return { entries: dayEntries, hasSessions }
})
ipcMain.handle('navi:generateTimeline', (_e, hourStartMs: number) => generateTimelineForHour(hourStartMs))
ipcMain.handle('navi:generateTimelineForDay', (_e, date: string) => generateTimelineForDay(date))
ipcMain.handle('navi:regenerateAllTimeline', () => regenerateAllTimeline())

// 日记
ipcMain.handle('navi:getDiaries', () =>
  getDb().select().from(diaries).orderBy(desc(diaries.date)).limit(30).all()
)
ipcMain.handle('navi:getDiary', (_e, date: string) => {
  const ms = fromLocalDateStr(date)
  if (Number.isNaN(ms)) return null
  return getDb().select().from(diaries).where(eq(diaries.date, ms)).all()[0] ?? null
})
ipcMain.handle('navi:generateDiary', (_e, date: string) => {
  const ms = fromLocalDateStr(date)
  if (Number.isNaN(ms)) return Promise.resolve()
  return generateDiary(ms)
})

// 经验
ipcMain.handle('navi:getExperiences', () =>
  getDb().select().from(experiences).orderBy(desc(experiences.updatedAt)).limit(100).all()
)
ipcMain.handle('navi:generateExperiences', (_e, filePath: string) => generateExperiencesForSession(filePath))

// 项目
ipcMain.handle('navi:getProjects', () =>
  getDb().select().from(projects).orderBy(desc(projects.lastActiveAt)).all()
)

// 技能
ipcMain.handle('navi:getSkills', () =>
  getDb().select().from(skills).orderBy(desc(skills.callCount)).all()
)
ipcMain.handle('navi:toggleSkill', (_e, id: string, enabled: boolean) => {
  const db = getDb()
  const cur = db.select().from(skills).where(eq(skills.id, id)).all()[0]
  if (cur) db.update(skills).set({ enabled: enabled ? 1 : 0 }).where(eq(skills.id, id)).run()
  return true
})

// 人物/关系
ipcMain.handle('navi:getPersons', () =>
  getDb().select().from(persons).orderBy(desc(persons.mentionCount)).all()
)
ipcMain.handle('navi:getRelationships', () => getDb().select().from(relationships).all())
ipcMain.handle('navi:generatePersons', (_e, filePath: string) => generatePersonsForSession(filePath))
ipcMain.handle('navi:updatePersonNote', (_e, id: string, note: string, tags: string[]) => {
  const db = getDb()
  db.update(persons).set({ note, tags: JSON.stringify(tags), updatedAt: Date.now() }).where(eq(persons.id, id)).run()
  return true
})

// Wiki
ipcMain.handle('navi:readWiki', (_e, relPath: string) => {
  const wiki = getWiki()
  const fsRoot = join(app.getPath('userData'), 'wiki')
  const abs = join(fsRoot, relPath)
  if (!abs.startsWith(fsRoot)) return null
  try {
    return fs.readFileSync(abs, 'utf8')
  } catch {
    return null
  }
})
ipcMain.handle('navi:writeWiki', (_e, relPath: string, content: string) => {
  const fsRoot = join(app.getPath('userData'), 'wiki')
  const abs = join(fsRoot, relPath)
  if (!abs.startsWith(fsRoot)) return false
  fs.mkdirSync(dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content, 'utf8')
  getWiki().appendLog('manual', `编辑 ${relPath}`)
  return true
})
ipcMain.handle('navi:listWiki', (_e, type?: string) => {
  const wiki = getWiki()
  if (type) return wiki.listByType(type as any)
  const all: any[] = []
  for (const t of ['experience', 'project', 'person', 'timeline', 'diary', 'habit', 'personality', 'skill']) {
    all.push(...wiki.listByType(t as any))
  }
  return all
})
ipcMain.handle('navi:getBacklinks', (_e, id: string) => getWiki().backlinks(id))
ipcMain.handle('navi:getWikiLog', () => {
  try {
    return fs.readFileSync(join(app.getPath('userData'), 'wiki', 'log.md'), 'utf8')
  } catch {
    return ''
  }
})
ipcMain.handle('navi:rebuildIndex', () => {
  getWiki().rebuildIndex()
  return true
})

// Lint
ipcMain.handle('navi:lint', () => lintWiki())

// 认知同步（导出到各 AI 工具全局上下文）
ipcMain.handle('navi:syncCognition', (_e, force = false) => runCognitionSync(force))
ipcMain.handle('navi:getCognitionSyncStatus', () => getCognitionSyncStatus())

/* ───────────── 启动 ───────────── */

void app.whenReady().then(() => {
  getDb()
  getWiki()
  const result = ingestAllSessions()
  safeLog(
    `[navi] initial ingest: scanned=${result.scanned} upserted=${result.upserted} skipped=${result.skipped} failed=${result.failed} in ${result.durationMs}ms`
  )
  setInterval(() => {
    const r = ingestAllSessions()
    if (r.upserted > 0) safeLog(`[navi] scheduled ingest: +${r.upserted} updated`)
  }, 5 * 60 * 1000)

  // 认知同步：分钟级 hash 增量，内容变化才写目标文件
  initCognitionSync(app.getPath('userData'))
  const syncCognition = (): void => {
    try {
      const r = runCognitionSync()
      if (r.written.length > 0) {
        safeLog(`[navi] cognition sync: +${r.written.length} written (${r.written.join(', ')})`)
      }
    } catch (e) {
      safeLog('[navi] cognition sync error:', e)
    }
  }
  // 启动后先同步一次（延迟 8s 避开启动高峰），之后每 60s 检查
  setTimeout(syncCognition, 8_000)
  setInterval(syncCognition, 60_000)

  startScheduler()

  // 一次性修复历史脏时间线（旧逻辑下长 session 被跨小时重复归纳）。
  // 用 userData 下的标记文件保证只跑一次。延迟 60 秒避开 scheduler 启动期 LLM 高峰。
  // 失败不写标记文件，下次启动会自动重试。
  const regenFlag = join(app.getPath('userData'), '.timeline-v2-regen-done')
  if (!fs.existsSync(regenFlag)) {
    setTimeout(() => {
      void regenerateAllTimeline()
        .then((r) => {
          safeLog(`[navi] timeline v2 regenerate done: days=${r.days} generated=${r.generated} skipped=${r.skipped}`)
          try { fs.writeFileSync(regenFlag, String(Date.now())) } catch { /* ignore */ }
        })
        .catch((e) => safeLog('[navi] timeline v2 regenerate failed (will retry next launch):', e))
    }, 60_000)
  }

  createWindow()
  // dev 模式下主动设置 Dock 图标（macOS 打包后由 .icns 接管，无需此调用）
  if (process.platform === 'darwin' && !app.isPackaged) {
    const dockIcon = join(__dirname, '../../resources/icon.png')
    if (fs.existsSync(dockIcon)) app.dock?.setIcon(dockIcon)
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
