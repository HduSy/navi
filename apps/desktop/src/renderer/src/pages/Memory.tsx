import { useState } from 'react'
import { useAsync, Empty, formatTime, useScrollRestore } from '../components'
import type { MemoryRow } from '../types'

/** 分类 → 中文标签 */
const CATEGORY_LABELS: Record<string, string> = {
  schedule: '日程',
  todo: '待办',
  plan: '计划',
  note: '琐事'
}
const FILTERS = ['all', 'schedule', 'todo', 'plan', 'note'] as const
type Filter = (typeof FILTERS)[number]

/** due_at → 展示文案（含今天/明天/已过相对提示） */
function formatDue(ms: number): string {
  const d = new Date(ms)
  const hh = d.getHours()
  const mm = d.getMinutes()
  const date = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d
    .getDate()
    .toString()
    .padStart(2, '0')}`
  return hh === 0 && mm === 0 ? date : `${date} ${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`
}

/** 相对今天的天数：负数 = 已过，0 = 今天 */
function daysFromToday(ms: number): number {
  const due = new Date(ms)
  const today = new Date()
  due.setHours(0, 0, 0, 0)
  today.setHours(0, 0, 0, 0)
  return Math.round((due.getTime() - today.getTime()) / 86_400_000)
}

export function Memory() {
  const { data, loading, reload } = useAsync(() => window.navi.getMemories())
  const scrollRef = useScrollRestore('navi:scroll:memory')
  const [filter, setFilter] = useState<Filter>('all')

  const all = data ?? []
  const filtered = filter === 'all' ? all : all.filter((m) => m.category === filter)

  // 未完成：有时间的按 due_at 升序在前，无时间的按创建时间倒序垫后
  const pending = filtered
    .filter((m) => !m.done)
    .sort((a, b) => {
      if (a.dueAt && b.dueAt) return a.dueAt - b.dueAt
      if (a.dueAt) return -1
      if (b.dueAt) return 1
      return b.createdAt - a.createdAt
    })
  const done = filtered.filter((m) => m.done)

  async function toggleDone(m: MemoryRow): Promise<void> {
    await window.navi.setMemoryDone(m.id, !m.done)
    reload()
  }

  async function remove(m: MemoryRow): Promise<void> {
    await window.navi.deleteMemory(m.id)
    reload()
  }

  return (
    <div className="h-full flex flex-col">
      {all.length > 0 && (
        <div className="shrink-0 flex items-center gap-2 flex-wrap px-7 py-2.5 border-b border-stone-300">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={
                'text-xs font-medium py-1.5 px-3 rounded-sm border transition-colors ' +
                (filter === f
                  ? 'bg-accent-soft text-accent border-accent-line'
                  : 'bg-cream-200 text-stone-500 border-stone-300 hover:bg-cream-50 hover:text-stone-600')
              }
            >
              {f === 'all' ? '全部' : CATEGORY_LABELS[f]}
            </button>
          ))}
        </div>
      )}
      <div ref={scrollRef} className="flex-1 overflow-auto px-7 py-[22px]">
        {loading ? (
          <p className="text-stone-400">加载中...</p>
        ) : all.length === 0 ? (
          <Empty text="还没记下什么。在聊天里对我说「记住xxx」就行。" />
        ) : pending.length === 0 && done.length === 0 ? (
          <Empty text="这个分类下还没有记忆" />
        ) : (
          <div className="space-y-2.5">
            {pending.map((m) => (
              <MemoryCard key={m.id} m={m} onToggle={toggleDone} onRemove={remove} />
            ))}
            {done.length > 0 && (
              <>
                <div className="mono text-[11px] tracking-[0.06em] text-stone-400 pt-4 pb-1">已完成</div>
                {done.map((m) => (
                  <MemoryCard key={m.id} m={m} onToggle={toggleDone} onRemove={remove} />
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function MemoryCard({
  m,
  onToggle,
  onRemove
}: {
  m: MemoryRow
  onToggle: (m: MemoryRow) => Promise<void>
  onRemove: (m: MemoryRow) => Promise<void>
}) {
  const isDone = !!m.done
  const due = m.dueAt
  const days = due !== null ? daysFromToday(due) : null
  // 时间提示：已过=红、今天/明天=accent 强调
  const dueHint =
    days === null ? null : days < 0 ? `已过 ${-days} 天` : days === 0 ? '今天' : days === 1 ? '明天' : `${days} 天后`
  const dueHot = days !== null && days <= 1

  return (
    <article
      className={
        'group border rounded p-3.5 flex items-start gap-3 card-hover ' +
        (isDone ? 'border-stone-200 bg-cream-50 opacity-60' : 'border-stone-300 bg-cream-200')
      }
    >
      {/* 完成勾选 */}
      <button
        onClick={() => void onToggle(m)}
        role="checkbox"
        aria-checked={isDone}
        title={isDone ? '标记未完成' : '标记完成'}
        className="mt-0.5 shrink-0 w-[16px] h-[16px] rounded-sm border transition-colors cursor-pointer flex items-center justify-center"
        style={{
          borderColor: isDone ? 'var(--accent)' : 'var(--border-2)',
          background: isDone ? 'var(--accent)' : 'transparent'
        }}
      >
        {isDone && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </button>

      <div className="flex-1 min-w-0">
        <p className={'text-[13px] leading-[1.55] text-stone-700 whitespace-pre-wrap ' + (isDone ? 'line-through text-stone-400' : '')}>
          {m.content}
        </p>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <span className="mono text-[11px] text-stone-500 bg-stone-100 border border-stone-200 px-[7px] py-[2px] rounded-sm">
            {CATEGORY_LABELS[m.category] ?? '琐事'}
          </span>
          {due !== null && (
            <span
              className="mono text-[11px] px-[7px] py-[2px] rounded-sm border"
              style={
                dueHot && !isDone
                  ? { color: 'var(--danger)', borderColor: 'var(--danger)', background: 'transparent' }
                  : { color: 'var(--muted)', borderColor: 'var(--border)', background: 'transparent' }
              }
            >
              {formatDue(due)}
              {dueHint && !isDone ? ` · ${dueHint}` : ''}
            </span>
          )}
          <span className="mono text-[11px] text-stone-400">
            {m.source === 'dialogue' ? '聊天记下' : 'MCP 记下'} · {formatTime(m.createdAt)}
          </span>
        </div>
      </div>

      {/* 删除：hover 才现身 */}
      <button
        onClick={() => void onRemove(m)}
        title="忘掉这条"
        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-stone-400 hover:text-red-500 cursor-pointer mt-0.5"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6h18" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      </button>
    </article>
  )
}
