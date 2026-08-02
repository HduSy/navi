import { useAsync, PageHeader, Button, Label, SecretInput, TextInput, TagButton } from '../components'
import { useState, useEffect } from 'react'
import type { BrainProviderConfig, ProviderPreset } from '../types'

const SCOPES: Array<{ key: string; label: string; desc: string }> = [
  { key: 'analysis', label: '理解力', desc: 'Navi 理解你活动、写时间线和日记用的脑子，用便宜快的就行' },
  { key: 'dialogue', label: '聊天力', desc: '和你说话用的脑子，用聪明点的' },
  { key: 'action', label: '行动力', desc: '听懂你"幽默点"这类指令并自我调整的脑子' }
]

export function Brain() {
  const { data: all, reload } = useAsync(() => window.navi.getAllBrain())
  const { data: presets } = useAsync(() => window.navi.getProviderPresets())

  if (!all) return <div className="p-12 text-gray-500">加载中...</div>

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="大脑"
        subtitle="默认走你的 Claude 配置，想换兼容协议的模型可在这改"
      />
      <div className="flex-1 overflow-auto px-12 py-12">
        <div className="space-y-8 max-w-4xl">
          {SCOPES.map((s) => (
            <BrainScopeEditor
              key={s.key}
              scope={s.key}
              label={s.label}
              desc={s.desc}
              cfg={all[s.key] ?? { scope: s.key, provider: '', model: '', baseUrl: '', apiKey: '', temperature: 0 }}
              presets={presets ?? []}
              onSave={() => reload()}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function BrainScopeEditor({
  scope,
  label,
  desc,
  cfg,
  presets,
  onSave
}: {
  scope: string
  label: string
  desc: string
  cfg: BrainProviderConfig
  presets: ProviderPreset[]
  onSave: () => void
}) {
  const [provider, setProvider] = useState(cfg.provider)
  const [model, setModel] = useState(cfg.model)
  const [baseUrl, setBaseUrl] = useState(cfg.baseUrl)
  const [apiKey, setApiKey] = useState(cfg.apiKey)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setProvider(cfg.provider)
    setModel(cfg.model)
    setBaseUrl(cfg.baseUrl)
    setApiKey(cfg.apiKey)
  }, [cfg])

  const isClaude = provider === 'claude'

  function applyPreset(p: ProviderPreset): void {
    if (p.id === 'claude') {
      // claude 走配置文件，清空手动字段
      setProvider('claude')
      setModel('')
      setBaseUrl('')
      setApiKey('')
    } else {
      setProvider(p.id)
      setBaseUrl(p.baseUrl)
      if (p.defaultModel) setModel(p.defaultModel)
    }
  }

  async function save(): Promise<void> {
    setSaving(true)
    try {
      await window.navi.setBrain(scope, { provider, model, baseUrl, apiKey, temperature: 0 })
      onSave()
    } finally {
      setSaving(false)
    }
  }

  return (
    <article className="border-2 border-black p-6">
      <header className="border-b border-black pb-3 mb-4">
        <h3 className="text-xl font-black">{label}</h3>
        <p className="text-xs opacity-50 mt-1">{desc}</p>
      </header>

      <div className="space-y-4">
        <div>
          <Label>从哪借脑子</Label>
          <div className="flex flex-wrap gap-2 mt-2">
            <TagButton onClick={() => applyPreset({ id: 'claude', label: 'Claude 配置', baseUrl: '', defaultModel: '', models: [] })} active={provider === 'claude'}>
              复用 Claude
            </TagButton>
            {presets.map((p) => (
              <TagButton key={p.id} onClick={() => applyPreset(p)} active={provider === p.id}>
                {p.label}
              </TagButton>
            ))}
          </div>
          {!isClaude && (
            <p className="text-xs opacity-50 mt-2">
              自己填接口地址、密钥和模型名（智谱、DeepSeek、Kimi 等国内厂商都支持）。
            </p>
          )}
        </div>

        {isClaude ? (
          <div className="border border-black p-3 text-sm">
            <p className="font-bold">直接用你 ClaudeCode 的配置</p>
            <p className="opacity-60 mt-1 text-xs">
              Navi 会自动读取，你不用再填一遍。在 ClaudeCode 里换号了，重启 Navi 就跟着换。
            </p>
          </div>
        ) : (
          <>
            <Field label="模型名">
              <TextInput value={model} onChange={setModel} list={`models-${scope}`} />
              <datalist id={`models-${scope}`}>
                {(presets.find((p) => p.id === provider)?.models ?? []).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </Field>

            <Field label="接口地址">
              <TextInput value={baseUrl} onChange={setBaseUrl} placeholder="https://api.example.com/v1" />
            </Field>

            <Field label="密钥（只存在你这台电脑）">
              <SecretInput value={apiKey} onChange={setApiKey} placeholder="sk-..." />
            </Field>
          </>
        )}

        <Button onClick={save} disabled={saving || isClaude}>
          {saving ? '保存中...' : '保存'}
        </Button>
      </div>
    </article>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  )
}
