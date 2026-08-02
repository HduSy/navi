import { useAsync, PageHeader, Empty, Label, formatTime } from '../components'
import { useState } from 'react'
import type { PersonRow, RelationshipRow } from '../types'

export function Relations() {
  const { data: persons, loading: lp } = useAsync(() => window.navi.getPersons())
  const { data: rels, loading: lr } = useAsync(() => window.navi.getRelationships())
  const [selected, setSelected] = useState<string | null>(null)
  const ps = persons ?? []
  const rs = rels ?? []
  const loading = lp || lr

  const sel = ps.find((p) => p.id === selected)

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="关系" subtitle="你聊天里提到的那些人" />
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 relative">
          {loading ? (
            <p className="p-12 text-gray-500">加载中...</p>
          ) : ps.length === 0 ? (
            <Empty text="还没听到你提起谁" />
          ) : (
            <ForceGraph persons={ps} relationships={rs} onSelect={setSelected} selected={selected} />
          )}
        </div>
        {sel && (
          <aside className="w-80 border-l border-black p-8 overflow-auto">
            <button onClick={() => setSelected(null)} className="text-xs font-bold uppercase tracking-widest opacity-50 mb-4 hover:text-accent">
              ← 关闭
            </button>
            <h3 className="text-2xl font-black">{sel.displayName}</h3>
            <Label>角色草稿</Label>
            <p className="mt-2 leading-relaxed">{sel.roleDraft || '(暂无)'}</p>
            <Label>提及</Label>
            <p className="mt-2 font-black">{sel.mentionCount} 次</p>
            {sel.note && (
              <>
                <Label>备注</Label>
                <p className="mt-2">{sel.note}</p>
              </>
            )}
            <Label>最近</Label>
            <p className="mt-2 text-xs opacity-50">{formatTime(sel.lastSeenAt)}</p>
          </aside>
        )}
      </div>
    </div>
  )
}

function ForceGraph({
  persons,
  relationships,
  onSelect,
  selected
}: {
  persons: PersonRow[]
  relationships: RelationshipRow[]
  onSelect: (id: string) => void
  selected: string | null
}) {
  // 简化布局：圆形排列
  const cx = 400
  const cy = 300
  const r = 180
  const maxMention = Math.max(...persons.map((p) => p.mentionCount), 1)
  const positions = new Map<string, { x: number; y: number }>()
  persons.forEach((p, i) => {
    const angle = (i / persons.length) * Math.PI * 2
    positions.set(p.id, { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r })
  })

  return (
    <svg width="100%" height="100%" viewBox="0 0 800 600" preserveAspectRatio="xMidYMid meet">
      {/* edges */}
      {relationships.map((rel) => {
        const a = positions.get(rel.personA)
        const b = positions.get(rel.personB)
        if (!a || !b) return null
        const w = Math.min(rel.weight, 6)
        return (
          <line
            key={rel.id}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="black"
            strokeWidth={w}
            opacity={0.3}
          />
        )
      })}
      {/* nodes */}
      {persons.map((p) => {
        const pos = positions.get(p.id)
        if (!pos) return null
        const size = 8 + (p.mentionCount / maxMention) * 24
        const active = selected === p.id
        return (
          <g key={p.id} onClick={() => onSelect(p.id)} style={{ cursor: 'pointer' }}>
            <circle
              cx={pos.x}
              cy={pos.y}
              r={size}
              fill={active ? '#ff3366' : 'black'}
              stroke="black"
              strokeWidth={2}
            />
            <text
              x={pos.x}
              y={pos.y + size + 14}
              textAnchor="middle"
              className="font-bold"
              fill="black"
              fontSize={12}
            >
              {p.displayName}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
