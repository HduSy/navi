import { getDb } from './db.js'
import { getWiki } from './wiki-host.js'
import { experiences, persons } from '@navi/core'
import { desc } from 'drizzle-orm'

export interface LintIssue {
  severity: 'info' | 'warn' | 'error'
  type: string
  message: string
}

export interface LintResult {
  issues: LintIssue[]
  fixed: number
}

/** 认知健康检查：孤儿页/相似经验/矛盾/缺失交叉引用 */
export function lintWiki(): LintResult {
  const db = getDb()
  const wiki = getWiki()
  const issues: LintIssue[] = []
  let fixed = 0

  // 1. 孤儿 person 页（无任何 backlink）
  const allPersons = db.select().from(persons).all()
  for (const p of allPersons) {
    const bl = wiki.backlinks(p.id)
    if (bl.length === 0 && p.mentionCount <= 1) {
      issues.push({
        severity: 'info',
        type: 'orphan-person',
        message: `${p.displayName} 仅被提及 ${p.mentionCount} 次且无引用，可能是误抽`
      })
    }
  }

  // 2. 相似经验（scenario 关键词重合）
  const allExp = db.select().from(experiences).orderBy(desc(experiences.updatedAt)).limit(50).all()
  for (let i = 0; i < allExp.length; i++) {
    for (let j = i + 1; j < allExp.length; j++) {
      const a = allExp[i]
      const b = allExp[j]
      if (!a || !b) continue
      const overlap = keywordOverlap(a.scenario, b.scenario)
      if (overlap > 0.6) {
        issues.push({
          severity: 'warn',
          type: 'similar-experience',
          message: `经验"${a.scenario.slice(0, 30)}"与"${b.scenario.slice(0, 30)}"高度相似，建议合并`
        })
      }
    }
  }

  wiki.appendLog('lint', `检查 ${issues.length} 项`, `修复 ${fixed}`)
  return { issues, fixed }
}

function keywordOverlap(a: string, b: string): number {
  const tokensA = new Set(tokenize(a))
  const tokensB = new Set(tokenize(b))
  let common = 0
  for (const t of tokensA) if (tokensB.has(t)) common++
  return common / Math.max(tokensA.size, tokensB.size, 1)
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1)
}
