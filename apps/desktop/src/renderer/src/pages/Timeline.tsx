import { useState, useMemo } from 'react'
import { useAsync, PageHeader, Empty, NoDrag, formatTime, basename, formatHourLocal, toLocalDateStr } from '../components'
import type { TimelineEntryRow } from '../types'

export function Timeline() {
  const today = useMemo(() => toLocalDateStr(Date.now()), [])
  const [date, setDate] = useState(today)
  const { data, loading } = useAsync(() => window.navi.getTimeline(date), [date])

  // 新接口返回 { entries, hasSessions }；老接口（无 date 时）返回数组
  const entries = useMemo(() => {
    const list = Array.isArray(data) ? data : data?.entries ?? []
    return list
      .filter((e) => e.summary && e.summary.trim().length > 0)
      .sort((a, b) => b.hourStart - a.hourStart)
  }, [data])
  const hasSessions = Array.isArray(data) ? true : data?.hasSessions ?? false

  const isToday = date === today
  const isFuture = date > today

  function shift(days: number): void {
    const d = new Date(date + 'T00:00:00')
    d.setDate(d.getDate() + days)
    const next = toLocalDateStr(d.getTime())
    if (next > today) return
    setDate(next)
  }

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="时间线" subtitle="每小时记下你做了什么" />
      <div className="flex-1 overflow-auto px-12 py-12">
        <div className="max-w-5xl">
          <NoDrag>
            <div className="flex items-center gap-3 mb-8">
              <button
                onClick={() => shift(-1)}
                className="border-2 border-black w-10 h-10 flex items-center justify-center font-black hover:bg-black hover:text-white transition-none"
                aria-label="前一天"
              >
                ←
              </button>
              <button
                onClick={() => shift(1)}
                disabled={isToday}
                className="border-2 border-black w-10 h-10 flex items-center justify-center font-black hover:bg-black hover:text-white transition-none disabled:opacity-30 disabled:hover:bg-white disabled:hover:text-black"
                aria-label="后一天"
              >
                →
              </button>
              <div className="border-2 border-black px-5 py-2 text-sm font-black">
                {formatDateDisplay(date)}
                {isToday && <span className="ml-2 text-xs opacity-50">今天</span>}
              </div>
              {!isToday && (
                <button
                  onClick={() => setDate(today)}
                  className="border-2 border-black px-4 h-10 text-xs font-bold hover:bg-black hover:text-white transition-none"
                >
                  回到今天
                </button>
              )}
              <span className="text-xs text-gray-500 ml-2">Navi 会自动记下每个有活动的小时</span>
            </div>
          </NoDrag>

          {loading ? (
            <p className="text-gray-500">加载中...</p>
          ) : isFuture ? (
            <Empty text="这一天还没到呢" />
          ) : entries.length === 0 ? (
            <Empty text={hasSessions ? '今天干活了么？过会儿再来看吧，整点更新哦' : '这一天 Navi 没看到你活动'} />
          ) : (
            <div className="space-y-4">
              {entries.map((e) => (
                <TimelineItem key={e.hourStart} entry={e} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function TimelineItem({ entry }: { entry: TimelineEntryRow }) {
  const projects = safeParseArray(entry.projectPaths)
  const localHour = formatHourLocal(entry.hourStart)
  return (
    <div className="border-2 border-black p-6">
      <div className="flex items-baseline justify-between gap-4">
        <div className="flex items-baseline gap-4">
          <span className="text-3xl font-black tracking-tight">{localHour}</span>
        </div>
        {entry.finalized ? (
          <span className="text-xs font-bold border border-black px-2 py-1">已封存</span>
        ) : (
          <span className="text-xs opacity-50">当天会持续更新</span>
        )}
      </div>
      <p className="text-lg leading-relaxed mt-4">{entry.summary}</p>
      {projects.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {projects.map((p) => (
            <span key={p} className="text-xs font-bold border border-black px-2 py-1">
              {basename(p)}
            </span>
          ))}
        </div>
      )}
      <p className="text-xs text-gray-500 mt-4">Navi 于 {formatTime(entry.generatedAt)} 记下</p>
    </div>
  )
}

function safeParseArray(s: string): string[] {
  try {
    const a = JSON.parse(s)
    return Array.isArray(a) ? a : []
  } catch {
    return []
  }
}

/** YYYY-MM-DD → M月D日（周X） */
function formatDateDisplay(date: string): string {
  try {
    const d = new Date(date + 'T00:00:00')
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    return `${d.getMonth() + 1}月${d.getDate()}日 ${weekdays[d.getDay()]}`
  } catch {
    return date
  }
}
