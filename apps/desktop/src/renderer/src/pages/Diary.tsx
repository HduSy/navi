import { useState, useEffect } from 'react'
import { useAsync, Button, Empty, Label, formatTime, toLocalDateStr, useScrollRestore, ReadingBody } from '../components'
import type { DiaryRow } from '../types'

/** 切 tab 前后记住选中的日记日期 */
const SELECT_KEY = 'navi:diary:selected'

export function Diary() {
  const { data, loading, reload } = useAsync(() => window.navi.getDiaries())
  const diaries = data ?? []
  const [selectedDate, setSelectedDate] = useState<number | null>(() => {
    const raw = sessionStorage.getItem(SELECT_KEY)
    const n = raw === null ? Number.NaN : Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  })
  const listRef = useScrollRestore<HTMLUListElement>('navi:scroll:diary:list')
  const detailRef = useScrollRestore('navi:scroll:diary:detail')

  // 列表加载完：优先保持存档的选中篇；无存档或该篇已不存在时选最新一篇
  useEffect(() => {
    if (diaries.length === 0) return
    if (selectedDate !== null && diaries.some((d) => d.date === selectedDate)) return
    setSelectedDate(diaries[0]!.date)
  }, [diaries, selectedDate])

  // 记住选中篇，切 tab 回来还看同一篇
  useEffect(() => {
    if (selectedDate !== null) sessionStorage.setItem(SELECT_KEY, String(selectedDate))
  }, [selectedDate])

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
            {/* 面板不带背景：透出底层品牌水印（与 Chat/Timeline 页面级容器同规则） */}
            <nav className="border-r border-stone-300 flex flex-col min-h-0">
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
              <ul ref={listRef} className="flex-1 overflow-auto p-3 space-y-0.5">
                {diaries.map((d) => {
                  const active = d.date === selectedDate
                  return (
                    <li key={d.date}>
                      <button
                        onClick={() => setSelectedDate(d.date)}
                        className={
                          'w-full text-left px-3 py-2.5 rounded-sm border cursor-pointer transition-colors duration-150 ' +
                          (active
                            ? 'bg-diary-tint border-stone-300'
                            : 'border-transparent hover:bg-diary-tint')
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

            <div ref={detailRef} className="overflow-auto">
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

/** 一段日记 section：title（tone 着色）+ 阅读正文（规范渲染 ReadingBody） */
function DiarySection({
  title,
  body,
  tone = 'default'
}: {
  title: string
  body: string
  tone?: 'default' | 'accent' | 'ok'
}) {
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
      <ReadingBody body={body} />
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
