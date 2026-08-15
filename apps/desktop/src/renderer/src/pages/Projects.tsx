import { useAsync, Empty, Label, FitText, formatTime, looksLikeUUID, NoDrag, useScrollRestore } from '../components'
import { useState, useMemo } from 'react'
import type { ProjectRow } from '../types'

type SortKey = 'count' | 'duration' | 'latest'

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'latest', label: '按最近' },
  { key: 'count', label: '按次数' },
  { key: 'duration', label: '按耗时' }
]

function sortProjects(items: ProjectRow[], key: SortKey): ProjectRow[] {
  const cmp = (a: ProjectRow, b: ProjectRow): number => {
    switch (key) {
      case 'count':
        return b.sessionCount - a.sessionCount
      case 'duration':
        return b.totalDurationMs - a.totalDurationMs
      case 'latest':
        return (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0)
    }
  }
  return [...items].sort(cmp)
}

/** 把毫秒按量级换算成紧凑展示（无空格） */
function formatDuration(ms: number): string {
  if (!ms || ms < 0) return '0min'
  const min = Math.floor(ms / 60000)
  const M = Math.floor(min / 43200)   // 30 天
  const d = Math.floor((min % 43200) / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  const parts: string[] = []
  if (M) parts.push(`${M}mo`)
  if (d) parts.push(`${d}d`)
  if (h) parts.push(`${h}h`)
  if (m) parts.push(`${m}min`)
  return parts.length ? parts.join('/') : '0min'
}

export function Projects() {
  const { data, loading } = useAsync(() => window.navi.getProjects())
  const scrollRef = useScrollRestore('navi:scroll:projects')
  const [sortBy, setSortBy] = useState<SortKey>('latest')
  const allItems = useMemo(() => (data ?? []).filter((p) => !looksLikeUUID(p.name)), [data])
  const items = useMemo(() => sortProjects(allItems, sortBy), [allItems, sortBy])

  return (
    <div className="h-full flex flex-col">
      {!loading && allItems.length > 0 && (
        <NoDrag className="shrink-0 flex items-center gap-2 px-7 pt-3 pb-2 border-b border-stone-300">
          <span className="mono text-[11px] text-stone-400 mr-1">排序</span>
          {SORTS.map((s) => (
            <button
              key={s.key}
              onClick={() => setSortBy(s.key)}
              className={
                'text-xs font-medium py-1.5 px-3 rounded-sm border transition-colors ' +
                (sortBy === s.key
                  ? 'bg-accent-soft text-accent border-accent-line'
                  : 'bg-cream-200 text-stone-500 border-stone-300 hover:bg-cream-50 hover:text-stone-600')
              }
            >
              {s.label}
            </button>
          ))}
        </NoDrag>
      )}
      <div ref={scrollRef} className="flex-1 overflow-auto px-7 py-[22px]">
        {loading ? (
          <p className="text-stone-400">加载中...</p>
        ) : items.length === 0 ? (
          <Empty text="还没看到你的项目，打开 ClaudeCode 干点活吧" />
        ) : (
          <>
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
            >
            {items.map((p) => (
              <article
                key={p.path}
                className="border border-stone-300 rounded p-[15px] bg-cream-200 cursor-pointer card-hover"
              >
                <h3 className="mono text-sm font-medium text-stone-700">{p.name}</h3>
                <div className="mono text-[11px] text-stone-400 mt-1 truncate">{p.path}</div>
                <div className="mt-3.5 grid grid-cols-2 gap-3">
                  <div>
                    <Label>对话次数</Label>
                    <p className="mono text-[22px] font-semibold text-stone-700 mt-0.5 tabular-nums">{p.sessionCount}</p>
                  </div>
                  <div>
                    <Label>耗时</Label>
                    <FitText
                      max={22}
                      min={12}
                      className="mono font-semibold text-stone-700 mt-0.5"
                    >
                      {formatDuration(p.totalDurationMs)}
                    </FitText>
                  </div>
                </div>
                {p.lastActiveAt && (
                  <p className="mono text-[11px] text-stone-400 mt-3.5 border-t border-stone-300 pt-2.5">
                    最近 {formatTime(p.lastActiveAt)}
                  </p>
                )}
              </article>
            ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
