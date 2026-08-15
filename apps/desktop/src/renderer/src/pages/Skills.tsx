import { useState, useMemo } from 'react'
import { useAsync, Empty, formatTime, useScrollRestore } from '../components'
import type { SkillRow } from '../types'

type SortBy = 'count' | 'latest'

export function Skills() {
  const { data, loading } = useAsync(() => window.navi.getSkills())
  const scrollRef = useScrollRestore('navi:scroll:skills')
  const [toggles, setToggles] = useState<Record<string, boolean>>({})
  const [sortBy, setSortBy] = useState<SortBy>('latest')
  const [filter, setFilter] = useState<'skill' | 'mcp'>('skill')

  // 只展示用过的（callCount > 0 且 lastUsedAt 有值）
  const used = useMemo(() => {
    return (data ?? []).filter((s) => s.callCount > 0 && s.lastUsedAt)
  }, [data])

  const skills = used.filter((s) => s.source === 'skill')
  const mcps = used.filter((s) => s.source === 'mcp')

  // 排序
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
      {!loading && used.length > 0 && (
        <div className="shrink-0 flex items-center gap-2 flex-wrap px-7 pt-[22px] pb-3 border-b border-stone-300">
          <button
            onClick={() => setSortBy('latest')}
            className={
              'text-xs font-medium py-1.5 px-3 rounded-sm border transition-colors ' +
              (sortBy === 'latest'
                ? 'bg-accent-soft text-accent border-accent-line'
                : 'bg-cream-200 text-stone-500 border-stone-300 hover:bg-cream-50 hover:text-stone-600')
            }
          >
            按最近
          </button>
          <button
            onClick={() => setSortBy('count')}
            className={
              'text-xs font-medium py-1.5 px-3 rounded-sm border transition-colors ' +
              (sortBy === 'count'
                ? 'bg-accent-soft text-accent border-accent-line'
                : 'bg-cream-200 text-stone-500 border-stone-300 hover:bg-cream-50 hover:text-stone-600')
            }
          >
            按次数
          </button>
          <span className="w-px h-4 bg-stone-300" aria-hidden />
          <button
            onClick={() => setFilter('skill')}
            className={
              'text-xs font-medium py-1.5 px-3 rounded-sm border transition-colors ' +
              (filter === 'skill'
                ? 'bg-accent-soft text-accent border-accent-line'
                : 'bg-cream-200 text-stone-500 border-stone-300 hover:bg-cream-50 hover:text-stone-600')
            }
          >
            SKILL
          </button>
          <button
            onClick={() => setFilter('mcp')}
            className={
              'text-xs font-medium py-1.5 px-3 rounded-sm border transition-colors ' +
              (filter === 'mcp'
                ? 'bg-accent-soft text-accent border-accent-line'
                : 'bg-cream-200 text-stone-500 border-stone-300 hover:bg-cream-50 hover:text-stone-600')
            }
          >
            MCP
          </button>
        </div>
      )}
      <div ref={scrollRef} className="flex-1 overflow-auto px-7 py-[22px]">
        {loading ? (
          <p className="text-stone-400">加载中...</p>
        ) : used.length === 0 ? (
          <Empty text="还没用过任何扩展，去 ClaudeCode 里调几个 skill 或 MCP 吧" />
        ) : (
          <div className="space-y-5 w-full">

            {filter === 'skill' && skills.length > 0 && (
              <CardGrid items={skills} effectiveEnabled={effectiveEnabled} onToggle={toggle} />
            )}
            {filter === 'mcp' && mcps.length > 0 && (
              <CardGrid items={mcps} effectiveEnabled={effectiveEnabled} onToggle={toggle} />
            )}
            {filter === 'mcp' && mcps.length === 0 && (
              <Empty text="还没用过 MCP" />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function CardGrid({
  items,
  effectiveEnabled,
  onToggle
}: {
  items: SkillRow[]
  effectiveEnabled: (s: SkillRow) => boolean
  onToggle: (id: string, v: boolean) => void
}) {
  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
    >
      {items.map((s) => (
        <SkillCard key={s.id} skill={s} enabled={effectiveEnabled(s)} onToggle={(v) => onToggle(s.id, v)} />
      ))}
    </div>
  )
}

function SkillCard({ skill, enabled, onToggle }: { skill: SkillRow; enabled: boolean; onToggle: (v: boolean) => void }) {
  const isMcp = skill.source === 'mcp'
  return (
    <article className="border border-stone-300 rounded p-3.5 flex flex-col bg-cream-200 card-hover">
      <div className="flex items-baseline justify-between gap-2.5">
        <span className="mono text-[13px] font-medium text-stone-700 truncate">{skill.id}</span>
        <span className="mono text-xs text-accent whitespace-nowrap tabular-nums">{skill.callCount} 次</span>
      </div>
      {skill.description && (
        <p className="text-[12.5px] leading-[1.55] text-stone-500 mt-2 line-clamp-2">{skill.description}</p>
      )}
      {isMcp && (
        <span className="inline-flex items-center gap-1 self-start mono text-[11px] text-accent bg-accent-soft border border-accent-line px-[7px] py-[3px] rounded-sm mt-2.5">
          ⬡ MCP
        </span>
      )}
      <div className="mt-3.5 pt-2.5 border-t border-stone-300 flex items-center justify-between">
        {skill.lastUsedAt && (
          <span className="mono text-[11px] text-stone-400">{formatTime(skill.lastUsedAt)}</span>
        )}
        <button
          onClick={() => onToggle(!enabled)}
          role="switch"
          aria-checked={enabled}
          className="relative inline-flex items-center w-[44px] h-[24px] rounded-full border transition-colors duration-150 shrink-0 cursor-pointer"
          style={{
            background: enabled ? 'var(--accent)' : 'var(--surface-2)',
            borderColor: enabled ? 'var(--accent)' : 'var(--border-2)'
          }}
        >
          {/* 滑块：标准 switch —— ON 在右（accent 填充），OFF 在左（灰） */}
          <span
            className="absolute top-[2px] w-[18px] h-[18px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-all duration-150"
            style={{ left: enabled ? '22px' : '2px' }}
          />
        </button>
      </div>
    </article>
  )
}
