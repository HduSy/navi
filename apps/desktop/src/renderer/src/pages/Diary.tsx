import { useAsync, PageHeader, Button, Empty, Label, formatTime, toLocalDateStr } from '../components'
import type { DiaryRow } from '../types'

export function Diary() {
  const { data, loading, reload } = useAsync(() => window.navi.getDiaries())
  const diaries = data ?? []

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="日记"
        subtitle="每晚 21 点 Navi 自动给你写一篇"
        action={
          <Button
            onClick={() => {
              const today = toLocalDateStr(Date.now())
              void window.navi.generateDiary(today).then(reload)
            }}
          >
            现在就写
          </Button>
        }
      />
      <div className="flex-1 overflow-auto px-12 py-12">
        {loading ? (
          <p className="text-gray-500">加载中...</p>
        ) : diaries.length === 0 ? (
          <Empty text="还没写过日记，Navi 会在晚上自动给你写一篇" />
        ) : (
          <div className="space-y-8 max-w-3xl">
            {diaries.map((d) => (
              <DiaryItem key={d.date} diary={d} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function DiaryItem({ diary }: { diary: DiaryRow }) {
  return (
    <article className="border-2 border-black p-8">
      <header className="border-b border-black pb-4 mb-4">
        <Label>日记</Label>
        <h3 className="text-3xl font-black mt-1">{toLocalDateStr(diary.date)}</h3>
      </header>
      <section className="mb-4">
        <Label>总览</Label>
        <p className="text-lg leading-relaxed mt-2">{diary.summary || '(无)'}</p>
      </section>
      {diary.output && (
        <section className="mb-4">
          <Label>产出</Label>
          <p className="leading-relaxed mt-2 whitespace-pre-wrap">{diary.output}</p>
        </section>
      )}
      {diary.pitfalls && (
        <section className="mb-4">
          <Label>踩坑</Label>
          <p className="leading-relaxed mt-2 whitespace-pre-wrap">{diary.pitfalls}</p>
        </section>
      )}
      {diary.tone && (
        <section>
          <Label>基调</Label>
          <p className="mt-2">{diary.tone}</p>
        </section>
      )}
      <p className="text-xs text-gray-500 mt-6">生成于 {formatTime(diary.generatedAt)}</p>
    </article>
  )
}
