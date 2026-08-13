import { useAsync, Tag, Button, Label, formatTime } from '../components'
import { useState } from 'react'

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
      <div className="flex-1 overflow-auto px-7 py-[22px]">
        <div className="max-w-3xl">
          {/* 当前 Claude 配置状态 */}
          <section className="border border-stone-300 rounded p-4 bg-cream-200 mb-5 card-hover">
            <h3 className="text-[13px] font-semibold text-stone-400 uppercase tracking-[0.04em] mb-3.5">当前 Claude 配置</h3>
            <dl className="grid mono text-[13px] leading-[1.6]" style={{ gridTemplateColumns: '96px 1fr', gap: '8px 20px' }}>
              <dt className="text-stone-400">baseUrl</dt>
              <dd className="text-stone-600 break-all">{status?.baseUrl || '(未配置)'}</dd>
              <dt className="text-stone-400">默认模型</dt>
              <dd className="text-stone-600">{status?.model || '(未配置)'}</dd>
              <dt className="text-stone-400">token</dt>
              <dd className="text-stone-600">{status?.hasToken ? '已配置' : <span className="text-danger">缺失</span>}</dd>
              <dt className="text-stone-400">状态</dt>
              <dd className="text-stone-600">
                {status?.available ? (
                  <Tag variant="ok">可用</Tag>
                ) : (
                  <span className="text-danger">配置不完整</span>
                )}
              </dd>
            </dl>
            {!status?.available && (
              <p className="mt-3.5 text-xs text-stone-500 border-t border-stone-300 pt-3.5 leading-[1.6]">
                没找到 <code className="mono bg-accent-soft text-accent px-1.5 py-0.5 rounded-sm">~/.claude/settings.json</code> 或
                缺少 <code className="mono bg-accent-soft text-accent px-1.5 py-0.5 rounded-sm">ANTHROPIC_AUTH_TOKEN</code>。
                请先用 cc-switch 或手动配置 Claude Code。
              </p>
            )}
          </section>

          {/* 三 scope 各自的派生配置 */}
          {SCOPES.map((s) => {
            const cfg = all?.[s.key]
            return (
              <article key={s.key} className="border border-stone-300 rounded p-4 bg-cream-200 mb-3 card-hover">
                <header className="flex items-baseline justify-between mb-1">
                  <h4 className="text-[15px] font-semibold text-stone-700">{s.label}</h4>
                  <span className="mono text-[11px] text-stone-400">{s.key}</span>
                </header>
                <p className="text-[12.5px] text-stone-500 mb-3.5">{s.desc}</p>
                <div className="grid mono text-[13px] leading-[1.5]" style={{ gridTemplateColumns: '96px 1fr', gap: '8px 20px' }}>
                  <span className="text-stone-400">provider</span>
                  <span className="text-stone-600">{cfg?.provider || 'claude'}</span>
                  <span className="text-stone-400">model</span>
                  <span className="text-stone-600">{cfg?.model || '(空)'}</span>
                  <span className="text-stone-400">baseUrl</span>
                  <span className="text-stone-600 break-all">{cfg?.baseUrl || status?.baseUrl || '(空)'}</span>
                </div>
              </article>
            )
          })}

          <p className="text-[12px] text-stone-500 leading-[1.6] mt-4 max-w-[64ch]">
            Navi 不再保存大脑配置到本地数据库——你的 Claude Code 配置就是 Navi 的配置。
            想换供应商、换模型、换 key，都用 cc-switch 改{' '}
            <code className="mono bg-accent-soft text-accent px-1.5 py-0.5 rounded-sm">~/.claude/settings.json</code>，
            然后重启 Navi 即可生效。
          </p>

          {/* 认知同步 */}
          <CognitionSyncPanel />
        </div>
      </div>
    </div>
  )
}

/** 认知同步管理：把人格/项目/技能/记忆/关系导出到各 AI 工具全局上下文 */
function CognitionSyncPanel() {
  const { data, reload } = useAsync(() => window.navi.getCognitionSyncStatus())
  const [syncing, setSyncing] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  async function sync(force: boolean): Promise<void> {
    setSyncing(true)
    setMsg(null)
    try {
      const r = await window.navi.syncCognition(force)
      setMsg({
        type: 'ok',
        text:
          r.written.length > 0
            ? `已写入 ${r.written.length} 个工具${r.skipped.length > 0 ? `，${r.skipped.length} 个无变化跳过` : ''}${r.errors.length > 0 ? `，${r.errors.length} 个失败` : ''}`
            : r.errors.length > 0
              ? `写入失败 ${r.errors.length} 个`
              : '内容无变化，无需写入'
      })
      reload()
    } catch (e) {
      setMsg({ type: 'err', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <section className="border border-stone-300 rounded p-4 bg-cream-200 mt-6">
      <div className="flex items-baseline justify-between mb-1 flex-wrap gap-2">
        <h3 className="text-[13px] font-semibold text-stone-400 uppercase tracking-[0.04em]">认知同步</h3>
        <span className="mono text-[11px] text-stone-400">
          上次 {data?.lastRunAt ? formatTime(data.lastRunAt) : '从未'} · 内容 {data?.contentLength ?? 0} 字符
        </span>
      </div>
      <p className="text-[12px] text-stone-500 leading-[1.6] mb-3.5">
        把人格 / 项目 / 技能 / 记忆 / 关系导出到各 AI coding 工具的全局上下文。分钟级自动同步，内容变化才写入；保留你在标记块外的自定义内容。
      </p>

      <div className="flex gap-2 mb-3.5">
        <Button size="sm" onClick={() => sync(true)} disabled={syncing}>
          {syncing ? '同步中...' : '立即同步'}
        </Button>
        <Button variant="outlined" size="sm" onClick={() => void sync(false)} disabled={syncing}>
          仅检查
        </Button>
      </div>

      {msg && (
        <p className={'mono text-[11px] mb-3 ' + (msg.type === 'ok' ? 'text-ok' : 'text-danger')}>{msg.text}</p>
      )}

      <div className="border border-stone-300 rounded overflow-hidden">
        <div className="grid mono text-[11px] text-stone-400 bg-cream-50 border-b border-stone-300 px-3 py-1.5"
          style={{ gridTemplateColumns: '140px 1fr 90px' }}>
          <span>工具</span>
          <span>文件</span>
          <span className="text-right">状态</span>
        </div>
        {(data?.targets ?? []).map((t) => {
          const base = t.file.replace(/^\/Users\/[^/]+/, '~')
          return (
            <div key={t.id} className="grid px-3 py-1.5 border-b border-stone-300 last:border-0 items-center"
              style={{ gridTemplateColumns: '140px 1fr 90px' }}>
              <span className="text-[12px] text-stone-600">{t.label}</span>
              <span className="mono text-[11px] text-stone-400 truncate" title={t.file}>{base}</span>
              <span className="text-right">
                {t.writtenAt ? (
                  <Tag variant="ok">{formatTime(t.writtenAt)}</Tag>
                ) : t.exists ? (
                  <span className="mono text-[11px] text-stone-400">待同步</span>
                ) : (
                  <span className="mono text-[11px] text-stone-400">未创建</span>
                )}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
