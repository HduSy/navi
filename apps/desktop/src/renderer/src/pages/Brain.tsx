import { useAsync, PageHeader, Label } from '../components'

const SCOPES: Array<{ key: 'analysis' | 'dialogue' | 'action'; label: string; desc: string }> = [
  { key: 'analysis', label: '理解力', desc: 'Navi 理解你活动、写时间线和日记用的脑子' },
  { key: 'dialogue', label: '聊天力', desc: '和你说话用的脑子' },
  { key: 'action', label: '行动力', desc: '听懂你"幽默点"这类指令并自我调整的脑子' }
]

export function Brain() {
  const { data: all } = useAsync(() => window.navi.getAllBrain())
  const { data: status } = useAsync(() => window.navi.getClaudeConfigStatus())

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="大脑"
        subtitle="始终读你的 Claude 配置，换号用 cc-switch 改 settings.json 后重启 Navi"
      />
      <div className="flex-1 overflow-auto px-12 py-12">
        <div className="max-w-3xl space-y-8">
          {/* 当前 Claude 配置状态 */}
          <section className="border-2 border-black p-6">
            <Label>当前 Claude 配置</Label>
            <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm font-mono">
              <dt className="opacity-50">baseUrl</dt>
              <dd className="break-all">{status?.baseUrl || '(未配置)'}</dd>
              <dt className="opacity-50">默认模型</dt>
              <dd>{status?.model || '(未配置)'}</dd>
              <dt className="opacity-50">token</dt>
              <dd>{status?.hasToken ? '已配置 ✓' : <span className="text-red-600">缺失 ✗</span>}</dd>
              <dt className="opacity-50">状态</dt>
              <dd>{status?.available ? '可用' : <span className="text-red-600">配置不完整</span>}</dd>
            </dl>
            {!status?.available && (
              <p className="mt-4 text-xs opacity-70 border-t border-black pt-3">
                没找到 <code className="border border-current px-1">~/.claude/settings.json</code> 或
                缺少 <code className="border border-current px-1">ANTHROPIC_AUTH_TOKEN</code>。
                请先用 cc-switch 或手动配置 Claude Code。
              </p>
            )}
          </section>

          {/* 三 scope 各自的派生配置 */}
          <div className="space-y-4">
            {SCOPES.map((s) => {
              const cfg = all?.[s.key]
              return (
                <article key={s.key} className="border-2 border-black p-5">
                  <header className="flex items-baseline justify-between">
                    <h3 className="text-lg font-black">{s.label}</h3>
                    <code className="text-xs opacity-50">{s.key}</code>
                  </header>
                  <p className="text-xs opacity-50 mt-1">{s.desc}</p>
                  <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-sm font-mono">
                    <dt className="opacity-50">模型</dt>
                    <dd>{cfg?.model || '(空)'}</dd>
                    <dt className="opacity-50">温度</dt>
                    <dd>{cfg?.temperature ?? 0}</dd>
                  </dl>
                </article>
              )
            })}
          </div>

          <p className="text-xs opacity-50 leading-relaxed">
            Navi 不再保存大脑配置到本地数据库——你的 Claude Code 配置就是 Navi 的配置。
            想换供应商、换模型、换 key，都用 cc-switch 改 <code className="border border-current px-1">~/.claude/settings.json</code>，
            然后重启 Navi 即可生效。
          </p>
        </div>
      </div>
    </div>
  )
}
