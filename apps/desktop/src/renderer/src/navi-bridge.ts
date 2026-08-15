/**
 * Navi IPC bridge（Tauri 版）—— 替代 Electron preload 的 `window.navi`。
 *
 * API 签名与 types.ts 的 NaviAPI 完全一致，页面代码零改动：
 * - 请求走 `invoke('<command>', args)`（命令名 = 原 ipc channel 去冒号转 snake_case）
 * - `navi:chat:delta` 事件走 `listen('navi:chat:delta')`
 */

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { BrainProviderConfig, NaviAPI } from './types'

function buildNaviApi(): NaviAPI {
  return {
    // 对应 preload 的静态信息（原值平移；node/electron 字段已无宿主可取，置空）
    version: '0.1.0',
    platform: navigator.platform || 'unknown',
    node: '',
    electron: '',

    // 采集
    getSessionStats: () => invoke('get_session_stats'),
    ingest: () => invoke('ingest'),

    // 对话
    sendMessage: (msg: string, reqId?: string) =>
      invoke('send_message', { msg, reqId: reqId ?? null }),
    onChatDelta: (cb: (payload: { reqId: string; delta: string }) => void): (() => void) => {
      let unlisten: UnlistenFn | null = null
      let disposed = false
      void listen<{ reqId: string; delta: string }>('navi:chat:delta', (e) => cb(e.payload)).then(
        (fn) => {
          if (disposed) fn()
          else unlisten = fn
        }
      )
      return () => {
        disposed = true
        unlisten?.()
      }
    },
    getRecentMessages: () => invoke('get_recent_messages'),
    clearChat: () => invoke('clear_chat'),

    // 人格
    getPersonality: () => invoke('get_personality'),
    setPersonalityDimensions: (dims: Record<string, number>) =>
      invoke('set_personality_dimensions', { dims }),
    setPersonalityFreeText: (text: string) => invoke('set_personality_free_text', { text }),
    getPersonalityHistory: () => invoke('get_personality_history'),

    // 大脑
    getAllBrain: () => invoke('get_all_brain'),
    getBrain: (scope: string) => invoke('get_brain', { scope }),
    getProviderPresets: () => invoke('get_provider_presets'),
    getClaudeConfigStatus: () => invoke('get_claude_config_status'),
    isBrainCustomized: (scope: string) => invoke('is_brain_customized', { scope }),
    getSecretProtectionStatus: () => invoke('get_secret_protection_status'),
    saveBrain: (scope: string, cfg: BrainProviderConfig) => invoke('save_brain', { scope, cfg }),
    clearBrain: (scope: string) => invoke('clear_brain', { scope }),
    testBrain: (cfg: BrainProviderConfig) => invoke('test_brain', { cfg }),
    fetchBrainModels: (cfg: BrainProviderConfig) => invoke('fetch_brain_models', { cfg }),

    // 时间线
    getTimeline: (date?: string) => invoke('get_timeline', { date: date ?? null }),
    generateTimeline: (hourStartMs: number) => invoke('generate_timeline', { hourStart: hourStartMs }),
    generateTimelineForDay: (date: string) => invoke('generate_timeline_for_day', { date }),
    regenerateAllTimeline: () => invoke('regenerate_all_timeline'),

    // 日记
    getDiaries: () => invoke('get_diaries'),
    getDiary: (date: string) => invoke('get_diary', { date }),
    generateDiary: (date: string) => invoke('generate_diary', { date }),

    // 经验
    getExperiences: () => invoke('get_experiences'),
    generateExperiences: (filePath: string) => invoke('generate_experiences', { filePath }),

    // 项目
    getProjects: () => invoke('get_projects'),

    // 技能
    getSkills: () => invoke('get_skills'),
    toggleSkill: (id: string, enabled: boolean) => invoke('toggle_skill', { id, enabled }),

    // 人物/关系
    getPersons: () => invoke('get_persons'),
    getRelationships: () => invoke('get_relationships'),
    generatePersons: (filePath: string) => invoke('generate_persons', { filePath }),
    updatePersonNote: (id: string, note: string, tags: string[]) =>
      invoke('update_person_note', { id, note, tags }),

    // Wiki
    readWiki: (relPath: string) => invoke('read_wiki', { relPath }),
    writeWiki: (relPath: string, content: string) => invoke('write_wiki', { relPath, content }),
    listWiki: (type?: string) => invoke('list_wiki', { wikiType: type ?? null }),
    getBacklinks: (id: string) => invoke('get_backlinks', { id }),
    getWikiLog: () => invoke('get_wiki_log'),
    rebuildIndex: () => invoke('rebuild_index'),

    // Lint
    lint: () => invoke('lint'),

    // 认知同步
    syncCognition: (force = false) => invoke('sync_cognition', { force }),
    getCognitionSyncStatus: () => invoke('get_cognition_sync_status')
  }
}

export function installNaviBridge(): void {
  const w = window as unknown as { navi?: NaviAPI }
  if (!w.navi) {
    w.navi = buildNaviApi()
  }
}
