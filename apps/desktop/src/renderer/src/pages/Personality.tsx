import { useAsync, Label, useDebouncedCallback, useScrollRestore } from '../components'
import { useState, useEffect } from 'react'
import type { PersonalityState } from '../types'

const DIMS: Array<{ key: keyof PersonalityState['dimensions']; label: string; left: string; right: string }> = [
  { key: 'tone', label: '语气', left: '正经', right: '随意' },
  { key: 'humor', label: '幽默感', left: '严肃', right: '爱开玩笑' },
  { key: 'detail', label: '话多不多', left: '惜字如金', right: '事无巨细' },
  { key: 'proactivity', label: '主动劲', left: '问才说', right: '主动搭话' },
  { key: 'empathy', label: '懂不懂你', left: '就事论事', right: '共情陪伴' },
  { key: 'challenge', label: '敢不敢顶', left: '你说啥都对', right: '会反驳你' }
]

export function Personality() {
  const { data, reload } = useAsync(() => window.navi.getPersonality())
  const scrollRef = useScrollRestore('navi:scroll:personality')
  const [dims, setDims] = useState<PersonalityState['dimensions'] | null>(null)

  useEffect(() => {
    if (data) setDims(data.dimensions)
  }, [data])

  if (!data || !dims) return <div className="p-12 text-stone-400">加载中...</div>

  return (
    <div className="h-full flex flex-col">
      <div ref={scrollRef} className="flex-1 overflow-auto px-7 py-[22px]">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 w-full">
          {/* 维度 */}
          <section className="border border-stone-300 rounded p-4 bg-cream-200">
            <h3 className="text-[13px] font-semibold text-stone-400 uppercase tracking-[0.04em] mb-3">当前脾气</h3>
            <div className="space-y-1">
              {DIMS.map((d) => (
                <DimSlider
                  key={d.key}
                  label={d.label}
                  left={d.left}
                  right={d.right}
                  value={dims[d.key]}
                  onChange={(v) => setDims({ ...dims, [d.key]: v })}
                  onCommit={(v) => {
                    void window.navi.setPersonalityDimensions({ [d.key]: v }).then(() => reload())
                  }}
                />
              ))}
            </div>
          </section>

          {/* 角色介绍 + 历史 */}
          <section className="flex flex-col">
            <div className="border border-stone-300 rounded p-4 bg-cream-200">
              <h3 className="text-[13px] font-semibold text-stone-400 uppercase tracking-[0.04em] mb-3">当前语气</h3>
              <RoleEditor initial={data.coreFreeText} onSave={(t) => window.navi.setPersonalityFreeText(t)} />
            </div>
            {data.adaptationText && (
              <div className="border border-stone-300 rounded p-4 bg-cream-200 mt-3.5">
                <Label>Navi 自己摸索出的协作偏好</Label>
                <p className="leading-[1.65] text-[13px] text-stone-600 mt-2.5 whitespace-pre-wrap">{data.adaptationText}</p>
              </div>
            )}
            <div className="border border-stone-300 rounded p-4 bg-cream-200 mt-3.5">
              <Label>风格示例</Label>
              <div className="mt-2.5 space-y-2">
                {data.fewShot.length === 0 ? (
                  <p className="text-[13px] text-stone-400">还没攒下示例，多聊几次 Navi 会自动归纳</p>
                ) : (
                  data.fewShot.map((f, i) => (
                    <div key={i} className="text-[13px] border-b border-stone-300 last:border-0 pb-2 last:pb-0">
                      <p className="text-stone-600"><span className="text-stone-400">你：</span>{f.user}</p>
                      <p className="mt-1 text-stone-600"><span className="text-stone-400">Navi：</span>{f.navi}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function DimSlider({
  label,
  left,
  right,
  value,
  onChange,
  onCommit
}: {
  label: string
  left: string
  right: string
  value: number
  onChange: (v: number) => void
  onCommit: (v: number) => void
}) {
  const pct = `${value}%`
  return (
    <div className="flex items-center gap-3 py-2 border-b border-stone-300 last:border-0">
      <span className="w-[88px] text-[13px] text-stone-600 shrink-0">{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onMouseUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        className="trait-range flex-1 h-1.5 rounded-full appearance-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, var(--accent) ${pct}, var(--surface-2) ${pct})`
        }}
      />
      <span className="w-[34px] text-right mono text-xs text-stone-500 shrink-0 tabular-nums">{value}</span>
    </div>
  )
}

function RoleEditor({ initial, onSave }: { initial: string; onSave: (t: string) => Promise<unknown> }) {
  const [text, setText] = useState(initial)
  const [saved, setSaved] = useState(true)

  useEffect(() => {
    setText(initial)
  }, [initial])

  const debouncedSave = useDebouncedCallback((v: string) => {
    if (v !== initial) {
      void onSave(v).then(() => setSaved(true))
    }
  }, 800)

  function handleChange(v: string): void {
    setText(v)
    setSaved(false)
    debouncedSave(v)
  }

  return (
    <>
      <div className="flex items-center justify-between mb-2">
        <span className="mono text-[11px] text-stone-400">直接写，自动记住；聊天里说「换个性格」也行</span>
        <span className="mono text-[11px] text-ok">{saved ? '已保存' : '保存中…'}</span>
      </div>
      <textarea
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        rows={4}
        className="w-full border border-transparent rounded-sm p-2.5 text-[13.5px] leading-[1.7] text-stone-600 bg-transparent hover:bg-cream-50 focus:bg-cream-200 focus:border-accent-line focus:outline-none transition-colors resize-none"
        placeholder="描述 Navi 是个什么样的伙伴，比如：像个懂技术的老友，直来直去，偶尔吐槽但靠谱"
      />
    </>
  )
}
