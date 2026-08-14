import { useState, useEffect } from 'react'
import { useAsync, Button, Empty, Label, formatTime, toLocalDateStr } from '../components'
import type { DiaryRow } from '../types'

export function Diary() {
  const { data, loading, reload } = useAsync(() => window.navi.getDiaries())
  const diaries = data ?? []
  const [selectedDate, setSelectedDate] = useState<number | null>(null)

  // 列表加载完默认选中最新一篇
  useEffect(() => {
    if (diaries.length > 0 && !selectedDate) setSelectedDate(diaries[0]!.date)
  }, [diaries, selectedDate])

  const selected = diaries.find((d) => d.date === selectedDate) ?? null

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 grid min-h-0" style={{ gridTemplateColumns: '248px 1fr' }}>
        {loading ? (
          <p className="text-stone-400 p-7">加载中...</p>
        ) : diaries.length === 0 ? (
          <Empty text="还没写过日记，Navi 会在晚上自动给你写一篇" />
        ) : (
          <>
            <nav className="border-r border-stone-300 bg-cream-50 flex flex-col min-h-0">
              <div className="shrink-0 flex items-center px-3 py-2.5 border-b border-stone-300">
                <Button
                  variant="outlined"
                  size="sm"
                  onClick={() => {
                    const today = toLocalDateStr(Date.now())
                    void window.navi.generateDiary(today).then(reload)
                  }}
                >
                  现在就写
                </Button>
              </div>
              <ul className="flex-1 overflow-auto p-3 space-y-0.5">
                {diaries.map((d) => {
                  const active = d.date === selectedDate
                  return (
                    <li key={d.date}>
                      <button
                        onClick={() => setSelectedDate(d.date)}
                        className={
                          'w-full text-left px-3 py-2.5 rounded-sm border cursor-pointer transition-colors duration-150 ' +
                          (active
                            ? 'bg-cream-200 border-stone-300'
                            : 'border-transparent hover:bg-cream-200')
                        }
                      >
                        <div className="mono text-[13px] text-stone-700">{toLocalDateStr(d.date)}</div>
                        {d.summary && (
                          <div className={'mono text-[11px] mt-0.5 truncate text-stone-400'}>{d.summary}</div>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </nav>

            <div className="overflow-auto">
              {selected ? <DiaryDetail diary={selected} /> : <Empty text="选一篇看看吧" />}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function DiaryDetail({ diary }: { diary: DiaryRow }) {
  // 判断是否为新版结构化日记（done/ongoing/decisions/todo 至少有一个非空）
  const hasNewFields = Boolean(diary.done || diary.ongoing || diary.decisions || diary.todo)
  return (
    <article className="px-9 py-7 max-w-3xl">
      <Label>{toLocalDateStr(diary.date)}</Label>
      <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-stone-700 mt-2 mb-1">
        {formatDateShort(diary.date)}
      </h1>
      <div className="mono text-xs text-stone-400 mb-[22px]">Navi 于 {formatTime(diary.generatedAt)} 写下</div>

      {diary.summary && (
        <p className="text-[15px] leading-[1.75] text-stone-700 mb-6 pl-3 border-l-2 border-accent-line">
          {diary.summary}
        </p>
      )}

      {hasNewFields ? (
        <>
          {diary.done && (
            <DiarySection title="今天完成" body={diary.done} tone="ok" />
          )}
          {diary.ongoing && (
            <DiarySection title="进行中" body={diary.ongoing} tone="accent" />
          )}
          {diary.decisions && (
            <DiarySection title="待决策" body={diary.decisions} tone="accent" />
          )}
          {diary.todo && (
            <DiarySection title="还没做" body={diary.todo} />
          )}
        </>
      ) : (
        // 旧日记 fallback：渲染 output / pitfalls（无 tone）
        <>
          {diary.output && (
            <DiarySection title="今天" body={diary.output} />
          )}
          {diary.pitfalls && (
            <DiarySection title="踩的坑" body={diary.pitfalls} />
          )}
        </>
      )}
    </article>
  )
}

/** 一段日记 section：title + 多行 bullet / 段落 */
function DiarySection({
  title,
  body,
  tone = 'default'
}: {
  title: string
  body: string
  tone?: 'default' | 'accent' | 'ok'
}) {
  // 如果每行都以 - 开头，当作 bullet 列表渲染；否则当段落
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean)
  const isBullets = lines.length > 0 && lines.every((l) => /^[-*]\s+/.test(l))
  const titleColor =
    tone === 'ok' ? 'var(--ok)' : tone === 'accent' ? 'var(--accent)' : 'var(--muted)'
  return (
    <section className="mb-5">
      <div
        className="text-[13px] font-semibold mt-[22px] mb-2.5 tracking-[0.02em]"
        style={{ color: titleColor }}
      >
        {title}
      </div>
      {isBullets ? (
        <ul className="space-y-1.5">
          {lines.map((l, i) => (
            <li
              key={i}
              className="text-[14.5px] leading-[1.7] text-stone-600 flex gap-2"
            >
              <span className="text-stone-400 mt-[2px] shrink-0">·</span>
              <span>{l.replace(/^[-*]\s+/, '')}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-stone-600 leading-[1.75] text-[14.5px] whitespace-pre-wrap">{body}</p>
      )}
    </section>
  )
}

/** epoch ms → M月D日（周X）—— 用于 h1 短标题 */
function formatDateShort(ms: number): string {
  try {
    const d = new Date(ms)
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
    return `${d.getMonth() + 1}月${d.getDate()}日 ${weekdays[d.getDay()]}`
  } catch {
    return '今天'
  }
}
