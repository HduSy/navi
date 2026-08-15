import { useAsync, Tag, Button, Label, formatTime, TextInput, SecretInput, NoDrag, Select, useScrollRestore } from '../components'
import { useState, useEffect, useRef } from 'react'
import type { BrainProviderConfig, BrainTestResult, BrainTestErrorCode, ProviderPreset, WireProtocol } from '../types'

type Scope = 'analysis' | 'dialogue' | 'action'

const SCOPES: Array<{ key: Scope; label: string; desc: string }> = [
  { key: 'analysis', label: '理解力', desc: 'Navi 理解你活动、写时间线和日记用的脑子' },
  { key: 'dialogue', label: '聊天力', desc: '和你说话用的脑子' },
  { key: 'action', label: '行动力', desc: '听懂你"幽默点"这类指令并自我调整的脑子' }
]

/** 测试连接错误码 → 中文文案 */
const TEST_ERROR_LABEL: Record<BrainTestErrorCode, string> = {
  AUTH_INVALID: 'API Key 无效',
  AUTH_FORBIDDEN: '无权访问该模型',
  RATE_LIMITED: '被限流，稍后再试',
  QUOTA_EXCEEDED: '余额不足或配额用尽',
  MODEL_NOT_FOUND: '模型不存在或无权访问',
  ENDPOINT_NOT_FOUND: '端点路径不存在（检查 baseUrl）',
  CONTEXT_TOO_LONG: '上下文超长',
  WIRE_INCOMPATIBLE: '协议不兼容（试试切换协议）',
  UPSTREAM_ERROR: '上游服务异常',
  UPSTREAM_UNREACHABLE: '无法连接到上游（网络或 URL 错误）',
  TIMEOUT: '请求超时（>10s）',
  UNKNOWN: '未知错误'
}

export function Brain() {
  const { data: all, reload } = useAsync(() => window.navi.getAllBrain())
  const scrollRef = useScrollRestore('navi:scroll:brain')
  const { data: status } = useAsync(() => window.navi.getClaudeConfigStatus())
  const { data: secretOk } = useAsync(() => window.navi.getSecretProtectionStatus())
  const { data: syncStatus, reload: reloadSync } = useAsync(() => window.navi.getCognitionSyncStatus())
  const [editing, setEditing] = useState<Scope | null>(null)

  // 全部数据都到了才渲染内容：首帧就是完整内容 + 记忆位置，避免先画占位内容
  // 在错误滚动位置、再跳回记忆位置的闪烁。data 不清空，后台 reload 不会闪。
  // 认知同步状态也提升到这里：它内部异步到达会改变页面高度，若在子组件里加载，
  // 内容变高时不会触发本页 re-render，滚动恢复会卡在中间位置。
  const ready = all !== null && status !== null && secretOk !== null && syncStatus !== null

  return (
    <div className="h-full flex flex-col">
      <div ref={scrollRef} className="flex-1 overflow-auto px-7 py-[22px]">
        {ready && (
          <div className="w-full">
            {/* Claude settings.json 状态（只读 fallback 来源） */}
            <section className="border border-stone-300 rounded p-4 bg-cream-200 mb-5">
              <div className="flex items-baseline justify-between mb-3.5">
                <h3 className="text-[13px] font-semibold text-stone-400 uppercase tracking-[0.04em]">Claude 配置（默认来源）</h3>
                <span className="mono text-[11px] text-stone-400">
                  apiKey 加密保护 {secretOk ? '✓' : '✗'}
                </span>
              </div>
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
                  未自定义的 scope 会从这里派生配置。可以点击下方任意大脑卡片自定义，或先用 cc-switch 配置 Claude Code。
                </p>
              )}
            </section>
  
            {/* 三 scope 卡片：点击进入编辑 */}
            {SCOPES.map((s) => {
              const cfg = all?.[s.key]
              return (
                <article
                  key={s.key}
                  onClick={() => setEditing(s.key)}
                  className="border border-stone-300 rounded p-4 bg-cream-200 mb-3 card-hover cursor-pointer"
                >
                  <header className="flex items-baseline justify-between mb-1">
                    <h4 className="text-[15px] font-semibold text-stone-700">{s.label}</h4>
                    <span className="mono text-[11px] text-stone-400">{s.key} · 点击配置 →</span>
                  </header>
                  <p className="text-[12.5px] text-stone-500 mb-3.5">{s.desc}</p>
                  <div className="grid mono text-[13px] leading-[1.5]" style={{ gridTemplateColumns: '96px 1fr', gap: '8px 20px' }}>
                    <span className="text-stone-400">协议</span>
                    <span className="text-stone-600">{cfg?.protocol ?? (cfg?.baseUrl && /\/anthropic/i.test(cfg.baseUrl) ? 'anthropic' : 'openai')}</span>
                    <span className="text-stone-400">模型</span>
                    <span className="text-stone-600">{cfg?.model || '(空)'}</span>
                    <span className="text-stone-400">baseUrl</span>
                    <span className="text-stone-600 break-all">{cfg?.baseUrl || '(空)'}</span>
                  </div>
                </article>
              )
            })}
  
            <p className="text-[12px] text-stone-500 leading-[1.6] mt-4 max-w-[64ch]">
              点击大脑卡片可自定义配置（协议 / baseUrl / apiKey / 模型），覆盖默认的 Claude Code 设置。apiKey 走系统钥匙串加密存储，不通文本文件。
            </p>

          <CognitionSyncPanel data={syncStatus} reload={reloadSync} />
        </div>
        )}
      </div>

      {editing && (
        <BrainConfigSheet
          scope={editing}
          current={all?.[editing]}
          onClose={() => {
            setEditing(null)
            reload()
          }}
        />
      )}
    </div>
  )
}

/* ───────────── 配置抽屉 ───────────── */

function BrainConfigSheet({
  scope,
  current,
  onClose
}: {
  scope: Scope
  current: BrainProviderConfig | undefined
  onClose: () => void
}) {
  const scopeInfo = SCOPES.find((s) => s.key === scope)!
  const { data: presets } = useAsync(() => window.navi.getProviderPresets())
  const { data: isCustom } = useAsync(() => window.navi.isBrainCustomized(scope))

  // 表单 state
  const [protocol, setProtocol] = useState<WireProtocol>(
    current?.protocol ?? (current && /\/anthropic/i.test(current.baseUrl) ? 'anthropic' : 'openai')
  )
  const [baseUrl, setBaseUrl] = useState(current?.baseUrl ?? '')
  const [apiKey, setApiKey] = useState(current?.apiKey ?? '')
  const [model, setModel] = useState(current?.model ?? '')
  const [temperature, setTemperature] = useState(current?.temperature ?? (scope === 'dialogue' ? 70 : 0))
  const [modelOptions, setModelOptions] = useState<string[]>([])
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<BrainTestResult | null>(null)
  const [fetchingModels, setFetchingModels] = useState(false)
  const [fetchErr, setFetchErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // baseUrl + apiKey 都填好才算"可拉取"
  const canFetch = Boolean(baseUrl && apiKey)

  // 记录已自动拉取过的签名（baseUrl + apiKey + protocol），避免重复拉取
  const autoFetchedRef = useRef<string>('')

  // 表单变更后清旧测试结果
  useEffect(() => {
    setTestResult(null)
  }, [protocol, baseUrl, apiKey, model])

  // 自动拉取模型：进入 drawer 时若 baseUrl+apiKey 已配则拉一次；
  // 配置过程中 baseUrl/apiKey/protocol 变化后，只要凑齐就自动拉一次（同一签名只拉一次）
  useEffect(() => {
    if (!baseUrl || !apiKey) return
    const sig = `${protocol}|${baseUrl}|${apiKey}`
    if (sig === autoFetchedRef.current) return
    autoFetchedRef.current = sig
    void (async () => {
      setFetchingModels(true)
      setFetchErr(null)
      try {
        const list = await window.navi.fetchBrainModels({
          scope, provider: protocol, model, baseUrl, apiKey, temperature, protocol
        } as BrainProviderConfig)
        setModelOptions(list)
        if (list.length === 0) setFetchErr('返回的模型列表为空')
      } catch (e) {
        setFetchErr(e instanceof Error ? e.message : String(e))
      } finally {
        setFetchingModels(false)
      }
    })()
  }, [protocol, baseUrl, apiKey, scope, model, temperature])

  /** 应用预设 */
  function applyPreset(p: ProviderPreset) {
    setProtocol(p.protocol)
    setBaseUrl(p.baseUrl)
    if (!model || !p.models.includes(model)) setModel(p.defaultModel)
    setModelOptions(p.models)
    setTestResult(null)
  }

  /** 测试连接 */
  async function handleTest() {
    if (!baseUrl || !apiKey || !model) {
      setTestResult({ ok: false, code: 'UNKNOWN', message: 'baseUrl / apiKey / 模型 不能为空' })
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const r = await window.navi.testBrain({
        scope, provider: protocol, model, baseUrl, apiKey, temperature, protocol
      } as BrainProviderConfig)
      setTestResult(r)
    } catch (e) {
      setTestResult({ ok: false, code: 'UNKNOWN', message: e instanceof Error ? e.message : String(e) })
    } finally {
      setTesting(false)
    }
  }

  /** 手动拉取模型列表（强制刷新，绕过签名缓存） */
  async function handleFetchModels() {
    if (!baseUrl || !apiKey) {
      setFetchErr('baseUrl 和 apiKey 不能为空')
      return
    }
    autoFetchedRef.current = `${protocol}|${baseUrl}|${apiKey}` // 标记已拉，防 effect 紧接着重复拉
    setFetchingModels(true)
    setFetchErr(null)
    try {
      const list = await window.navi.fetchBrainModels({
        scope, provider: protocol, model, baseUrl, apiKey, temperature, protocol
      } as BrainProviderConfig)
      setModelOptions(list)
      if (list.length === 0) setFetchErr('返回的模型列表为空')
    } catch (e) {
      setFetchErr(e instanceof Error ? e.message : String(e))
    } finally {
      setFetchingModels(false)
    }
  }

  /** 保存 */
  async function handleSave() {
    setSaving(true)
    try {
      await window.navi.saveBrain(scope, {
        scope, provider: protocol, model, baseUrl, apiKey, temperature, protocol
      } as BrainProviderConfig)
      onClose()
    } catch (e) {
      setFetchErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  /** 清除自定义，回退默认 */
  async function handleClear() {
    await window.navi.clearBrain(scope)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex pointer-events-none">
      {/* 遮罩：延迟 100ms 淡入，与抽屉同时（240ms）结束 */}
      <div
        onClick={onClose}
        className="flex-1 bg-black/20 pointer-events-auto"
        style={{ animation: 'navi-drawer-fade 140ms ease-out 100ms both' }}
      />
      {/* 抽屉：从右滑入，will-change 预分配合成层，挂载帧即从屏外开始 */}
      <NoDrag
        className="w-[420px] shrink-0 bg-cream-50 border-l border-stone-300 flex flex-col pointer-events-auto"
        style={{
          animation: 'navi-drawer-in 240ms cubic-bezier(0.2, 0, 0, 1) both',
          willChange: 'transform'
        }}
      >
        <header className="shrink-0 flex items-center justify-between px-5 pt-3 pb-2 border-b border-stone-300">
          <div className="flex items-baseline gap-2">
            <h3 className="text-[15px] font-semibold text-stone-700">{scopeInfo.label} 配置</h3>
            <span className="mono text-[11px] text-stone-400">{scope}</span>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600 text-xl leading-none">×</button>
        </header>

        <div className="flex-1 overflow-auto px-5 py-4 space-y-4">
          {/* 供应商预设 */}
          <div>
            <Label>供应商预设</Label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {(presets ?? []).map((p) => (
                <button
                  key={p.id}
                  onClick={() => applyPreset(p)}
                  className={
                    'text-xs font-medium py-1 px-2.5 rounded-sm border transition-colors ' +
                    (baseUrl === p.baseUrl
                      ? 'bg-accent-soft text-accent border-accent-line'
                      : 'bg-cream-200 text-stone-500 border-stone-300 hover:bg-cream-50 hover:text-stone-600')
                  }
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* 协议切换 */}
          <div>
            <Label>协议</Label>
            <div className="mt-1.5 flex gap-1.5">
              {(['anthropic', 'openai'] as const).map((wp) => (
                <button
                  key={wp}
                  onClick={() => setProtocol(wp)}
                  className={
                    'text-xs font-medium py-1.5 px-3 rounded-sm border transition-colors ' +
                    (protocol === wp
                      ? 'bg-accent-soft text-accent border-accent-line'
                      : 'bg-cream-200 text-stone-500 border-stone-300 hover:bg-cream-50 hover:text-stone-600')
                  }
                >
                  {wp === 'anthropic' ? 'Anthropic Messages' : 'OpenAI Chat'}
                </button>
              ))}
            </div>
          </div>

          {/* baseUrl */}
          <div>
            <Label>Base URL</Label>
            <div className="mt-1">
              <TextInput value={baseUrl} onChange={setBaseUrl} placeholder="https://api.example.com/v1" />
            </div>
          </div>

          {/* apiKey */}
          <div>
            <Label>API Key</Label>
            <div className="mt-1">
              <SecretInput value={apiKey} onChange={setApiKey} placeholder="sk-..." />
            </div>
          </div>

          {/* 模型 */}
          <div>
            <Label>模型</Label>
            <div className="mt-1 flex items-center gap-2">
              <div className="flex-1">
                <Select
                  value={canFetch ? model : ''}
                  onChange={setModel}
                  options={modelOptions}
                  editable
                  placeholder={canFetch ? '模型 ID' : '先配好 Base URL 和 API Key，模型会自动拉取'}
                  emptyText={canFetch ? '（空）' : '先配好 Base URL 和 API Key'}
                />
              </div>
              <Button variant="outlined" size="sm" onClick={() => void handleFetchModels()} disabled={fetchingModels || !canFetch}>
                {fetchingModels ? '拉取中...' : '拉取模型'}
              </Button>
            </div>
            {fetchErr && (
              <p className="mono text-[11px] text-danger mt-1">{fetchErr}</p>
            )}
          </div>

          {/* 温度 */}
          <div>
            <Label>温度（temperature: 0-100）</Label>
            <div className="mt-1 flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={100}
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
                className="flex-1 accent-stone-700"
              />
              <span className="mono text-[13px] text-stone-600 w-8 text-right">{temperature}</span>
            </div>
          </div>

          {/* 测试连接 */}
          <div className="border-t border-stone-300 pt-4">
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => void handleTest()} disabled={testing}>
                {testing ? '测试中...' : '测试连接'}
              </Button>
              {testResult && (
                <span className={
                  'mono text-[11px] ' + (testResult.ok ? 'text-ok' : 'text-danger')
                }>
                  {testResult.ok
                    ? `✓ 连通 ${testResult.latencyMs}ms`
                    : `✗ ${TEST_ERROR_LABEL[testResult.code]}`
                  }
                </span>
              )}
            </div>
            {testResult && !testResult.ok && (
              <p className="mono text-[11px] text-stone-400 mt-1.5 break-all">{testResult.message}</p>
            )}
          </div>
        </div>

        {/* 底部操作 */}
        <footer className="shrink-0 flex items-center gap-2 px-5 pt-3 pb-4 border-t border-stone-300">
          {isCustom && (
            <Button variant="outlined" size="sm" onClick={() => void handleClear()}>恢复默认</Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outlined" size="sm" onClick={onClose}>取消</Button>
            <Button size="sm" onClick={() => void handleSave()} disabled={saving || !baseUrl || !apiKey || !model}>
              {saving ? '保存中...' : '保存'}
            </Button>
          </div>
        </footer>
      </NoDrag>
    </div>
  )
}

/* ───────────── 认知同步面板（保持不变） ───────────── */

/** 认知同步管理：把人格/项目/技能/记忆/关系导出到各 AI 工具全局上下文。
 *  状态数据由 Brain 提升进来（data/reload），保证数据到达会触发整页 re-render，
 *  滚动恢复才能等到内容变高后继续补足到记忆位置。 */
function CognitionSyncPanel({
  data,
  reload
}: {
  data: Awaited<ReturnType<typeof window.navi.getCognitionSyncStatus>> | null
  reload: () => void
}) {
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

      <div className="flex items-center gap-2 mb-3.5">
        <Button size="sm" onClick={() => sync(true)} disabled={syncing}>
          {syncing ? '同步中...' : '立即同步'}
        </Button>
        <Button variant="outlined" size="sm" onClick={() => void sync(false)} disabled={syncing}>
          仅检查
        </Button>
        {msg && (
          <span className={'mono text-[11px] ' + (msg.type === 'ok' ? 'text-ok' : 'text-danger')}>{msg.text}</span>
        )}
      </div>

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
