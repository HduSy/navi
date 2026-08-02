import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/** 用户安装的能力（skill / mcp），不含内置工具 */
export interface InstalledCapability {
  id: string
  source: 'skill' | 'mcp'
  scope: 'global' | 'project'
  projectPath?: string // 仅 project 级
  description: string
  dir?: string // skill 目录
}

const SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills')
const CLAUDE_JSON = path.join(os.homedir(), '.claude.json')

/** 发现用户安装的 skills（~/.claude/skills/<name>/SKILL.md） */
export function discoverSkills(): InstalledCapability[] {
  const out: InstalledCapability[] = []
  if (!fs.existsSync(SKILLS_DIR)) return out
  let names: string[] = []
  try {
    names = fs.readdirSync(SKILLS_DIR).filter((n) => {
      const p = path.join(SKILLS_DIR, n)
      try {
        return fs.statSync(p).isDirectory()
      } catch {
        return false
      }
    })
  } catch {
    return out
  }
  for (const name of names) {
    const dir = path.join(SKILLS_DIR, name)
    const skillMd = path.join(dir, 'SKILL.md')
    let description = ''
    if (fs.existsSync(skillMd)) {
      try {
        const raw = fs.readFileSync(skillMd, 'utf8')
        description = extractSkillDescription(raw)
      } catch {
        // ignore
      }
    }
    out.push({
      id: name,
      source: 'skill',
      scope: 'global',
      description,
      dir
    })
  }
  return out
}

/** 发现 MCP servers（~/.claude.json 的 mcpServers + projects.<path>.mcpServers） */
export function discoverMcps(): InstalledCapability[] {
  const out: InstalledCapability[] = []
  if (!fs.existsSync(CLAUDE_JSON)) return out
  let cfg: any
  try {
    cfg = JSON.parse(fs.readFileSync(CLAUDE_JSON, 'utf8'))
  } catch {
    return out
  }
  const globalMcp: Record<string, any> = cfg?.mcpServers ?? {}
  for (const name of Object.keys(globalMcp)) {
    out.push({
      id: name,
      source: 'mcp',
      scope: 'global',
      description: describeMcp(globalMcp[name])
    })
  }
  const projects: Record<string, any> = cfg?.projects ?? {}
  for (const projPath of Object.keys(projects)) {
    const projMcp: Record<string, any> = projects[projPath]?.mcpServers ?? {}
    for (const name of Object.keys(projMcp)) {
      out.push({
        id: name,
        source: 'mcp',
        scope: 'project',
        projectPath: projPath,
        description: describeMcp(projMcp[name])
      })
    }
  }
  return out
}

export function discoverAllCapabilities(): InstalledCapability[] {
  return [...discoverSkills(), ...discoverMcps()]
}

function extractSkillDescription(md: string): string {
  // SKILL.md 的 frontmatter 里 name/description，或第一段
  const fmMatch = md.match(/^---\n([\s\S]*?)\n---/)
  if (fmMatch) {
    const fm = fmMatch[1] ?? ''
    const descLine = fm.split('\n').find((l) => /^description\s*:/i.test(l))
    if (descLine) {
      const val = descLine.replace(/^description\s*:\s*/i, '').replace(/^"|"$/g, '').trim()
      if (val) return val
    }
    const nameLine = fm.split('\n').find((l) => /^name\s*:/i.test(l))
    if (nameLine) {
      return nameLine.replace(/^name\s*:\s*/i, '').replace(/^"|"$/g, '').trim()
    }
  }
  // 第一段非标题文本
  const firstPara = md
    .split('\n\n')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#'))[0]
  return firstPara ? firstPara.slice(0, 120) : ''
}

function describeMcp(mcp: any): string {
  if (!mcp || typeof mcp !== 'object') return ''
  const cmd = mcp.command ?? ''
  const args = Array.isArray(mcp.args) ? mcp.args.join(' ') : ''
  const url = mcp.url ?? ''
  if (url) return `url: ${url}`
  if (cmd) return `cmd: ${cmd}${args ? ' ' + args : ''}`
  return ''
}
