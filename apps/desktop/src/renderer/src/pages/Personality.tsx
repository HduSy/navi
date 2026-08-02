import { useAsync, PageHeader, Button, Label, formatTime, useDebouncedCallback } from '../components'
import { useState, useEffect } from 'react'
import type { PersonalityState, PersonalityHistoryRow } from '../types'

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
  const { data: history } = useAsync(() => window.navi.getPersonalityHistory())
  const [dims, setDims] = useState<PersonalityState['dimensions'] | null>(null)

  useEffect(() => {
    if (data) setDims(data.dimensions)
  }, [data])

  if (!data || !dims) return <div className="p-12 text-gray-500">加载中...</div>

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="人格" subtitle="Navi 是个什么样的小伙伴" />
      <div className="flex-1 overflow-auto px-12 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 max-w-6xl">
          {/* 维度 */}
          <section>
            <Label>性格滑条（拖完自动记住）</Label>
            <div className="mt-6 space-y-6">
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
          <section>
            <RoleEditor initial={data.coreFreeText} onSave={(t) => window.navi.setPersonalityFreeText(t)} />
            {data.adaptationText && (
              <>
                <Label>Navi 自己摸索出的协作偏好</Label>
                <div className="border-2 border-black p-4 mt-3">
                  <p className="leading-relaxed whitespace-pre-wrap text-sm">{data.adaptationText}</p>
                </div>
              </>
            )}
            <Label>风格示例</Label>
            <div className="mt-3 space-y-3">
              {data.fewShot.length === 0 ? (
                <p className="text-sm text-gray-500">还没攒下示例，多聊几次 Navi 会自动归纳</p>
              ) : (
                data.fewShot.map((f, i) => (
                  <div key={i} className="border-2 border-black p-3 text-sm">
                    <p><span className="opacity-50">你：</span>{f.user}</p>
                    <p className="mt-1"><span className="opacity-50">Navi：</span>{f.navi}</p>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        {/* 成长轨迹 */}
        {history && history.length > 0 && (
          <section className="mt-12 max-w-6xl">
            <Label>Navi 的成长轨迹</Label>
            <div className="mt-3 space-y-2">
              {history.map((h) => (
                <HistoryItem key={h.id} item={h} />
              ))}
            </div>
          </section>
        )}
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
  return (
    <div className="border-2 border-black p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="font-black">{label}</span>
        <span className="font-mono font-black text-accent">{value}</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onMouseUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
        className="w-full accent-black"
      />
      <div className="flex justify-between text-xs opacity-50 mt-1">
        <span>{left}</span>
        <span>{right}</span>
      </div>
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
    <div>
      <div className="flex items-center justify-between mb-3">
        <Label>角色介绍（直接写，自动记住；聊天里说"换个性格"也行）</Label>
        <span className="text-xs opacity-50">{saved ? '已记住' : '记住中…'}</span>
      </div>
      <textarea
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        rows={4}
        className="w-full border-2 border-black p-3 text-sm focus:outline-none focus:bg-gray-100"
        placeholder="描述 Navi 是个什么样的伙伴，比如：像个懂技术的老友，直来直去，偶尔吐槽但靠谱"
      />
    </div>
  )
}

function HistoryItem({ item }: { item: PersonalityHistoryRow }) {
  return (
    <div className="border border-black p-3 text-sm flex items-center justify-between">
      <span>{item.change}</span>
      <span className="text-xs opacity-50">
        {item.trigger} · {formatTime(item.createdAt)}
      </span>
    </div>
  )
}
