import { useState, useMemo } from 'react'
import { useAsync, PageHeader, Empty, Label, formatTime, TagButton } from '../components'
import type { SkillRow } from '../types'

type SortBy = 'count' | 'latest'

export function Skills() {
  const { data, loading } = useAsync(() => window.navi.getSkills())
  const [toggles, setToggles] = useState<Record<string, boolean>>({})
  const [sortBy, setSortBy] = useState<SortBy>('count')

  // 只展示用过的（callCount > 0 且 lastUsedAt 有值）
  const used = useMemo(() => {
    return (data ?? []).filter((s) => s.callCount > 0 && s.lastUsedAt)
  }, [data])

  const skills = used.filter((s) => s.source === 'skill')
  const mcps = used.filter((s) => s.source === 'mcp')

  // 排序：count 按使用次数降序；latest 按最近使用时间降序
  const sorter = (a: SkillRow, b: SkillRow): number => {
    if (sortBy === 'count') return b.callCount - a.callCount
    return (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)
  }
  skills.sort(sorter)
  mcps.sort(sorter)

  function effectiveEnabled(s: SkillRow): boolean {
    if (s.id in toggles) return toggles[s.id]!
    return s.enabled === 1
  }

  async function toggle(id: string, toEnabled: boolean): Promise<void> {
    setToggles((prev) => ({ ...prev, [id]: toEnabled }))
    await window.navi.toggleSkill(id, toEnabled)
  }

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="技能" subtitle="你给 AI 装的扩展能力（只展示用过的）" />
      <div className="flex-1 overflow-auto px-12 py-12">
        {loading ? (
          <p className="text-gray-500">加载中...</p>
        ) : used.length === 0 ? (
          <Empty text="还没用过任何扩展，去 ClaudeCode 里调几个 skill 或 MCP 吧" />
        ) : (
          <div className="space-y-12 max-w-6xl">
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-gray-500">排序</span>
              <TagButton onClick={() => setSortBy('count')} active={sortBy === 'count'}>
                按使用次数
              </TagButton>
              <TagButton onClick={() => setSortBy('latest')} active={sortBy === 'latest'}>
                按最近使用
              </TagButton>
            </div>

            {skills.length > 0 && (
              <section>
                <div className="flex items-baseline gap-4 mb-4">
                  <h3 className="text-xl font-black">Skill</h3>
                  <Label>{skills.length} 个</Label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {skills.map((s) => (
                    <SkillCard key={s.id} skill={s} enabled={effectiveEnabled(s)} onToggle={(v) => toggle(s.id, v)} />
                  ))}
                </div>
              </section>
            )}
            {mcps.length > 0 && (
              <section>
                <div className="flex items-baseline gap-4 mb-4">
                  <h3 className="text-xl font-black">MCP</h3>
                  <Label>{mcps.length} 个</Label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {mcps.map((s) => (
                    <SkillCard key={s.id} skill={s} enabled={effectiveEnabled(s)} onToggle={(v) => toggle(s.id, v)} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function SkillCard({ skill, enabled, onToggle }: { skill: SkillRow; enabled: boolean; onToggle: (v: boolean) => void }) {
  return (
    <article className="border-2 border-black p-4 flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-black truncate">{skill.id}</h3>
          <p className="text-xs opacity-50 mt-1 uppercase tracking-widest">{skill.source}</p>
        </div>
        <button
          onClick={() => onToggle(!enabled)}
          className={`text-xs font-bold border-2 border-black px-3 py-1 transition-none shrink-0 ${
            enabled ? 'bg-black text-white hover:bg-white hover:text-black' : 'bg-white text-black hover:bg-black hover:text-white'
          }`}
        >
          {enabled ? 'ON' : 'OFF'}
        </button>
      </div>
      {skill.description && (
        <p className="text-sm leading-relaxed mt-3 opacity-80 line-clamp-3">{skill.description}</p>
      )}
      <div className="mt-4 flex items-center justify-between text-xs">
        <span className="opacity-50">用过 {skill.callCount} 次</span>
        {skill.lastUsedAt && <span className="opacity-50">{formatTime(skill.lastUsedAt)}</span>}
      </div>
    </article>
  )
}
