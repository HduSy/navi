import { useAsync, PageHeader, Empty, Label, formatTime, basename, looksLikeUUID } from '../components'

export function Projects() {
  const { data, loading } = useAsync(() => window.navi.getProjects())
  const items = (data ?? []).filter((p) => !looksLikeUUID(p.name))
  return (
    <div className="h-full flex flex-col">
      <PageHeader title="项目" subtitle="你最近在和哪些代码库打交道" />
      <div className="flex-1 overflow-auto px-12 py-12">
        {loading ? (
          <p className="text-gray-500">加载中...</p>
        ) : items.length === 0 ? (
          <Empty text="还没看到你的项目，打开 ClaudeCode 干点活吧" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {items.map((p) => (
              <article key={p.path} className="border-2 border-black p-6 hover:bg-black hover:text-white transition-none">
                <h3 className="text-xl font-black">{p.name}</h3>
                <p className="text-xs opacity-50 mt-1 break-all">{p.path}</p>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div>
                    <Label>陪了你</Label>
                    <p className="text-2xl font-black mt-1">{p.sessionCount} 次</p>
                  </div>
                  <div>
                    <Label>耗时</Label>
                    <p className="text-2xl font-black mt-1">{Math.round(p.totalDurationMs / 60000)} 分钟</p>
                  </div>
                </div>
                {p.lastActiveAt && <p className="text-xs opacity-50 mt-4">最近 {formatTime(p.lastActiveAt)}</p>}
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
