import { contextBridge, ipcRenderer } from 'electron'

const naviAPI = {
  version: '0.1.0',
  platform: process.platform,
  node: process.versions.node,
  electron: process.versions.electron,

  // 采集
  getSessionStats: () => ipcRenderer.invoke('navi:getSessionStats'),
  ingest: () => ipcRenderer.invoke('navi:ingest'),

  // 对话
  sendMessage: (msg: string) => ipcRenderer.invoke('navi:sendMessage', msg),
  getRecentMessages: () => ipcRenderer.invoke('navi:getRecentMessages'),

  // 人格
  getPersonality: () => ipcRenderer.invoke('navi:getPersonality'),
  setPersonalityDimensions: (dims: Record<string, number>) =>
    ipcRenderer.invoke('navi:setPersonalityDimensions', dims),
  setPersonalityFreeText: (text: string) => ipcRenderer.invoke('navi:setPersonalityFreeText', text),
  getPersonalityHistory: () => ipcRenderer.invoke('navi:getPersonalityHistory'),

  // 大脑（只读，始终从 ~/.claude/settings.json 派生）
  getAllBrain: () => ipcRenderer.invoke('navi:getAllBrain'),
  getBrain: (scope: string) => ipcRenderer.invoke('navi:getBrain', scope),
  getProviderPresets: () => ipcRenderer.invoke('navi:getProviderPresets'),
  getClaudeConfigStatus: () => ipcRenderer.invoke('navi:getClaudeConfigStatus'),

  // 时间线
  getTimeline: (date?: string) => ipcRenderer.invoke('navi:getTimeline', date),
  generateTimeline: (hourStart: string) => ipcRenderer.invoke('navi:generateTimeline', hourStart),
  generateTimelineForDay: (date: string) => ipcRenderer.invoke('navi:generateTimelineForDay', date),
  regenerateAllTimeline: () => ipcRenderer.invoke('navi:regenerateAllTimeline'),

  // 日记
  getDiaries: () => ipcRenderer.invoke('navi:getDiaries'),
  getDiary: (date: string) => ipcRenderer.invoke('navi:getDiary', date),
  generateDiary: (date: string) => ipcRenderer.invoke('navi:generateDiary', date),

  // 经验
  getExperiences: () => ipcRenderer.invoke('navi:getExperiences'),
  generateExperiences: (filePath: string) => ipcRenderer.invoke('navi:generateExperiences', filePath),

  // 项目
  getProjects: () => ipcRenderer.invoke('navi:getProjects'),

  // 技能
  getSkills: () => ipcRenderer.invoke('navi:getSkills'),
  toggleSkill: (id: string, enabled: boolean) => ipcRenderer.invoke('navi:toggleSkill', id, enabled),

  // 人物/关系
  getPersons: () => ipcRenderer.invoke('navi:getPersons'),
  getRelationships: () => ipcRenderer.invoke('navi:getRelationships'),
  generatePersons: (filePath: string) => ipcRenderer.invoke('navi:generatePersons', filePath),
  updatePersonNote: (id: string, note: string, tags: string[]) =>
    ipcRenderer.invoke('navi:updatePersonNote', id, note, tags),

  // Wiki
  readWiki: (relPath: string) => ipcRenderer.invoke('navi:readWiki', relPath),
  writeWiki: (relPath: string, content: string) => ipcRenderer.invoke('navi:writeWiki', relPath, content),
  listWiki: (type?: string) => ipcRenderer.invoke('navi:listWiki', type),
  getBacklinks: (id: string) => ipcRenderer.invoke('navi:getBacklinks', id),
  getWikiLog: () => ipcRenderer.invoke('navi:getWikiLog'),
  rebuildIndex: () => ipcRenderer.invoke('navi:rebuildIndex'),

  // Lint
  lint: () => ipcRenderer.invoke('navi:lint'),

  // 认知同步
  syncCognition: (force = false) => ipcRenderer.invoke('navi:syncCognition', force),
  getCognitionSyncStatus: () => ipcRenderer.invoke('navi:getCognitionSyncStatus')
}

try {
  contextBridge.exposeInMainWorld('navi', naviAPI)
} catch {
  // contextIsolation disabled fallback
}
