import { useState, useMemo, useEffect, useRef } from 'react'
import { useAsync, Empty, NoDrag, formatTime, formatHourLocal, toLocalDateStr } from '../components'
import type { TimelineEntryRow } from '../types'

export function Timeline() {
  const [now, setNow] = useState(() => Date.now())
  // today 跟随 now，跨天时自动更新
  const today = useMemo(() => toLocalDateStr(now), [now])
  const [date, setDate] = useState(today)
  const { data, loading } = useAsync(() => window.navi.getTimeline(date), [date])

  useEffect(() => {
    // 每 60s 检查一次，跨整点/跨天时刷新时间轴
    const id = setInterval(() => setNow(Date.now()), 60_000)
    function onVis(): void {
      if (document.visibilityState === 'visible') setNow(Date.now())
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  const { items, hasSessions } = useMemo(() => {
    const list = Array.isArray(data) ? data : data?.entries ?? []
    const real = list
      .filter((e) => e.summary && e.summary.trim().length > 0)
      .sort((a, b) => a.hourStart - b.hourStart)
    const has = Array.isArray(data) ? true : data?.hasSessions ?? false
    return { items: real, hasSessions: has }
  }, [data])

  // 跨天检测：若 today 变成了新的一天，且用户当前仍停在旧 today，自动跟到新 today
  const prevTodayRef = useRef(today)
  const isToday = date === today
  useEffect(() => {
    if (prevTodayRef.current !== today) {
      // 跨天了：仅当用户当前就停在旧 today 时才跟随，避免打扰浏览历史
      setDate((prev) => (prev === prevTodayRef.current ? today : prev))
      prevTodayRef.current = today
    }
  }, [today])
  const isFuture = date > today

  function shift(days: number): void {
    const d = new Date(date + 'T00:00:00')
    d.setDate(d.getDate() + days)
    const next = toLocalDateStr(d.getTime())
    if (next > today) return
    setDate(next)
  }

  // 当前小时零点的 epoch ms（依赖 now，跨整点时自动更新）
  const nowHourStart = useMemo(() => {
    const d = new Date(now)
    d.setMinutes(0, 0, 0)
    return d.getTime()
  }, [now])

  // 展示规则：
  // - 真正有 entry 的小时全部列出
  // - 今天：若当前小时之后还没有任何 entry，追加一个「下一整点」收集中占位
  // - 历史日：不加占位
  const timeline = useMemo(() => {
    const entryItems = items.map((entry) => ({ kind: 'entry' as const, entry, hourStart: entry.hourStart }))
    const out: Array<{ kind: 'entry'; entry: TimelineEntryRow; hourStart: number } | { kind: 'pending'; hourStart: number }> = [...entryItems]
    if (isToday) {
      const nextHour = nowHourStart + 3_600_000
      const hasFuture = items.some((e) => e.hourStart >= nextHour)
      // 当前小时还没有 entry，且后续也没有任何 entry：补一个下一整点的收集中占位
      if (!items.some((e) => e.hourStart === nowHourStart) && !hasFuture) {
        out.push({ kind: 'pending', hourStart: nextHour })
      }
    }
    // 倒序：最新在上
    return out.sort((a, b) => b.hourStart - a.hourStart)
  }, [items, isToday, nowHourStart])

  return (
    <div className="h-full flex flex-col">
      <NoDrag className="shrink-0 flex items-center gap-2 px-7 pt-3 pb-2 border-b border-stone-300">
        <div className="flex items-center gap-2">
          <button
            onClick={() => shift(-1)}
            className="w-[30px] h-[30px] grid place-items-center rounded-sm border border-stone-300 bg-cream-200 text-stone-500 hover:bg-cream-50 hover:text-stone-600 transition-colors"
            aria-label="前一天"
          >
            ‹
          </button>
          <button
            onClick={() => shift(1)}
            disabled={isToday}
            className="w-[30px] h-[30px] grid place-items-center rounded-sm border border-stone-300 bg-cream-200 text-stone-500 hover:bg-cream-50 hover:text-stone-600 transition-colors disabled:opacity-35 disabled:cursor-default"
            aria-label="后一天"
          >
            ›
          </button>
          <span className="text-[15px] font-semibold text-stone-700 px-1">{formatDateDisplay(date)}</span>
          {!isToday && (
            <button
              onClick={() => setDate(today)}
              className="h-[30px] px-3 text-xs font-medium rounded-sm border border-stone-300 bg-cream-200 text-stone-500 hover:bg-cream-50 hover:text-stone-600 transition-colors"
            >
              回到今天
            </button>
          )}
        </div>
      </NoDrag>

      <div className="flex-1 overflow-auto px-7 py-[22px]">
        {loading ? (
          <p className="text-stone-400">加载中...</p>
        ) : isFuture ? (
          <Empty text="这一天还没到呢" />
        ) : timeline.length === 0 ? (
          <Empty text={hasSessions ? '今天干活了么？过会儿再来看吧，整点更新哦' : '这一天 Navi 没看到你活动'} />
        ) : (
          <ol className="relative">
            {timeline.map((item, i) => (
              <TimelineRow
                key={item.hourStart}
                item={item}
                isLast={i === timeline.length - 1}
                nowHourStart={nowHourStart}
                // 倒序首行（当天最晚一条 entry）：显示为结束时刻 24:00
                showAsDayEnd={i === 0}
              />
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}

type TimelineItem =
  | { kind: 'entry'; entry: TimelineEntryRow; hourStart: number }
  | { kind: 'pending'; hourStart: number }

/** entry 气泡内容：仅 summary（记下时间由 TimelineRow 渲染到卡片右下角） */
function EntryBody({ entry }: { entry: TimelineEntryRow }) {
  return <p className="text-[13.5px] leading-[1.6] text-stone-600">{entry.summary}</p>
}

function TimelineRow({ item, isLast, nowHourStart, showAsDayEnd }: { item: TimelineItem; isLast: boolean; nowHourStart: number; showAsDayEnd?: boolean }) {
  const localHour = showAsDayEnd && item.kind === 'entry' ? formatHourEnd(item.hourStart) : formatHourLocal(item.hourStart)
  const isCurrentHour = item.hourStart === nowHourStart
  const isPast = item.hourStart < nowHourStart

  // 状态判定：
  // - 已封存 OR 过去小时：完成态，圆点实心（填充色 = 边框色）
  // - 当前小时 entry：收集中，空心
  // - pending 占位（下一整点）：收集中，空心
  let dotStyle: React.CSSProperties
  let body: React.ReactNode
  let cardCls: string

  if (item.kind === 'entry') {
    const done = item.entry.finalized === 1 || isPast
    if (done) {
      dotStyle = { background: 'var(--accent)', borderColor: 'var(--accent)' }
    } else {
      // 当前小时：收集中
      dotStyle = { background: 'transparent', borderColor: 'var(--accent)' }
    }
    body = <EntryBody entry={item.entry} />
    cardCls = 'border-stone-300 bg-cream-200 card-hover'
  } else {
    // pending 占位：下一整点收集中
    dotStyle = { background: 'transparent', borderColor: 'var(--accent)' }
    body = <p className="text-[13.5px] leading-[1.6] text-stone-400 italic">Navi 正在观察这一小时，整点会生成总结</p>
    cardCls = 'border-stone-300 border-dashed bg-cream-50'
  }

  return (
    <li
      className="relative grid items-start pb-[18px]"
      style={{ gridTemplateColumns: '64px 16px 1fr', gap: '16px' }}
    >
      {/* 连接线：非末行画 */}
      {!isLast && (
        <span
          className="absolute w-px bg-stone-300"
          style={{ left: '87px', top: '9px', bottom: 0 }}
          aria-hidden
        />
      )}
      <div className="mono text-[13px] text-stone-400 text-right pt-0.5 tracking-[0.02em]">{localHour}</div>
      <div className="flex justify-center pt-1 relative z-10">
        <span
          className="w-[9px] h-[9px] rounded-full border-[1.5px] transition-colors"
          style={dotStyle}
          aria-hidden
        />
      </div>
      <div className={'border rounded px-3.5 py-3 transition-colors ' + cardCls}>
        {body}
        {item.kind === 'entry' && (
          <div className="mt-2 mono text-[11px] text-stone-400 text-right">
            Navi 于 {formatTime(item.entry.generatedAt)} 记下
          </div>
        )}
      </div>
    </li>
  )
}

/** YYYY-MM-DD -> M月D日（周X） */
function formatDateDisplay(date: string): string {
  try {
    const d = new Date(date + 'T00:00:00')
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    return `${d.getMonth() + 1}月${d.getDate()}日 ${weekdays[d.getDay()]}`
  } catch {
    return date
  }
}

/** 时段结束时刻：hourStart 的本地小时 +1（23 时段 → 24:00） */
function formatHourEnd(hourStartMs: number): string {
  try {
    const d = new Date(hourStartMs)
    const endHour = d.getHours() + 1
    // 跨日只可能发生在 23:00 时段，固定显示 24:00
    const hh = endHour > 23 ? '24' : endHour.toString().padStart(2, '0')
    return `${hh}:00`
  } catch {
    return String(hourStartMs)
  }
}
