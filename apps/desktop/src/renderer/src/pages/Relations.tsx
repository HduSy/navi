import { useAsync, Empty, Label, formatTime, DragRegion, NoDrag } from '../components'
import { useState, useRef, useEffect } from 'react'
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
      <div className="flex-1 flex overflow-hidden relative">
        <div className="flex-1 relative overflow-hidden">
          {loading ? (
            <p className="p-12 text-stone-400">加载中...</p>
          ) : ps.length === 0 ? (
            <Empty text="还没听到你提起谁" />
          ) : (
            <ForceGraph persons={ps} relationships={rs} onSelect={setSelected} selected={selected} />
          )}
          {!loading && ps.length > 0 && (
            <span className="absolute left-4 top-4 z-10 mono text-[11px] tracking-[0.04em] uppercase text-stone-400 pointer-events-none">
              共 {ps.length} 位
            </span>
          )}
        </div>
        {sel && (
          <aside className="absolute right-4 top-4 w-[240px] z-10 border border-stone-300 rounded bg-cream-200 p-3.5">
            <DragRegion className="shrink-0">
              <NoDrag>
                <button
                  onClick={() => setSelected(null)}
                  className="mono text-[11px] text-stone-400 hover:text-accent transition-colors"
                >
                  ← 关闭
                </button>
              </NoDrag>
              <Label>选中节点</Label>
              <h4 className="text-sm font-semibold text-stone-700 mt-1 mb-1">{sel.displayName}</h4>
              <div className="mono text-xs text-stone-500 mb-2.5">
                {sel.roleDraft || '(暂无角色)'} · 提到 {sel.mentionCount} 次
              </div>
            </DragRegion>
            {sel.note && (
              <p className="text-[12.5px] leading-[1.6] text-stone-600 mb-2.5">{sel.note}</p>
            )}
            <div className="mono text-[11px] text-stone-400 border-t border-stone-300 pt-2">
              最近 {formatTime(sel.lastSeenAt)}
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}

interface SimNode {
  id: string
  label: string
  x: number
  y: number
  vx: number
  vy: number
  r: number
  fixed?: boolean
  mention: number
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
  const containerRef = useRef<HTMLDivElement>(null)
  const nodesRef = useRef<SimNode[]>([])
  const [, force] = useState(0)

  // 初始化节点位置
  useEffect(() => {
    const w = containerRef.current?.clientWidth ?? 800
    const h = containerRef.current?.clientHeight ?? 500
    const cx = w / 2
    const cy = h / 2
    const maxMention = Math.max(...persons.map((p) => p.mentionCount), 1)
    nodesRef.current = persons.map((p, i) => {
      const ang = (i / Math.max(persons.length, 1)) * Math.PI * 2
      const r = 160 + Math.random() * 40
      return {
        id: p.id,
        label: p.displayName,
        x: cx + Math.cos(ang) * r,
        y: cy + Math.sin(ang) * r,
        vx: 0,
        vy: 0,
        r: 10 + (p.mentionCount / maxMention) * 12,
        mention: p.mentionCount
      }
    })
    force((n) => n + 1)
  }, [persons])

  // 力导向动画
  useEffect(() => {
    if (nodesRef.current.length === 0) return
    const w = containerRef.current?.clientWidth ?? 800
    const h = containerRef.current?.clientHeight ?? 500
    const cx = w / 2
    const cy = h / 2
    let alpha = 1
    let raf = 0

    const byId = new Map(nodesRef.current.map((n) => [n.id, n]))

    const step = (): void => {
      alpha *= 0.985
      const nodes = nodesRef.current
      // charge（排斥）
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i]!
          const b = nodes[j]!
          const dx = b.x - a.x
          const dy = b.y - a.y
          const d2 = dx * dx + dy * dy + 0.01
          const d = Math.sqrt(d2)
          const f = -2400 / d2
          const fx = (dx / d) * f
          const fy = (dy / d) * f
          if (!a.fixed) {
            a.vx += fx
            a.vy += fy
          }
          if (!b.fixed) {
            b.vx -= fx
            b.vy -= fy
          }
        }
      }
      // link（弹簧）
      for (const rel of relationships) {
        const a = byId.get(rel.personA)
        const b = byId.get(rel.personB)
        if (!a || !b) continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d = Math.sqrt(dx * dx + dy * dy) + 0.01
        const target = 130
        const f = (d - target) * 0.04
        const fx = (dx / d) * f
        const fy = (dy / d) * f
        if (!a.fixed) {
          a.vx += fx
          a.vy += fy
        }
        if (!b.fixed) {
          b.vx -= fx
          b.vy -= fy
        }
      }
      // center + integrate
      for (const n of nodes) {
        if (n.fixed) {
          n.vx = 0
          n.vy = 0
          continue
        }
        n.vx += (cx - n.x) * 0.005
        n.vy += (cy - n.y) * 0.005
        n.vx *= 0.82
        n.vy *= 0.82
        n.x += n.vx * alpha
        n.y += n.vy * alpha
      }
      force((x) => x + 1)
      if (alpha > 0.02) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [relationships, persons.length])

  // 拖拽
  const dragRef = useRef<{ node: SimNode; dx: number; dy: number } | null>(null)

  function pxy(ev: React.MouseEvent): { x: number; y: number } {
    const svg = ev.currentTarget.closest('svg')
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    const vb = svg.viewBox.baseVal
    return {
      x: ((ev.clientX - rect.left) / rect.width) * vb.width,
      y: ((ev.clientY - rect.top) / rect.height) * vb.height
    }
  }

  function onMouseDown(ev: React.MouseEvent, node: SimNode): void {
    ev.preventDefault()
    const p = pxy(ev)
    dragRef.current = { node, dx: p.x - node.x, dy: p.y - node.y }
    node.fixed = true
  }

  useEffect(() => {
    function onMove(ev: MouseEvent): void {
      if (!dragRef.current || !containerRef.current) return
      const svg = containerRef.current.querySelector('svg')
      if (!svg) return
      const rect = svg.getBoundingClientRect()
      const vb = (svg as SVGSVGElement).viewBox.baseVal
      const x = ((ev.clientX - rect.left) / rect.width) * vb.width
      const y = ((ev.clientY - rect.top) / rect.height) * vb.height
      const n = dragRef.current.node
      n.x = x - dragRef.current.dx
      n.y = y - dragRef.current.dy
      n.vx = 0
      n.vy = 0
      force((v) => v + 1)
    }
    function onUp(): void {
      if (dragRef.current) {
        dragRef.current.node.fixed = false
        dragRef.current = null
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const w = containerRef.current?.clientWidth ?? 800
  const h = containerRef.current?.clientHeight ?? 500
  const nodes = nodesRef.current
  const byId = new Map(nodes.map((n) => [n.id, n]))

  return (
    <div ref={containerRef} className="w-full h-full min-h-[400px]">
      <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet">
        {/* edges */}
        {relationships.map((rel) => {
          const a = byId.get(rel.personA)
          const b = byId.get(rel.personB)
          if (!a || !b) return null
          const sw = Math.min(rel.weight, 4)
          return (
            <line
              key={rel.id}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="var(--border-2)"
              strokeWidth={sw}
              strokeDasharray="3 4"
            />
          )
        })}
        {/* nodes */}
        {nodes.map((n) => {
          const active = selected === n.id
          return (
            <g
              key={n.id}
              style={{ cursor: 'pointer' }}
              onMouseDown={(ev) => onMouseDown(ev, n)}
              onClick={() => onSelect(n.id)}
            >
              <circle
                cx={n.x}
                cy={n.y}
                r={n.r}
                fill={active ? 'var(--accent-soft)' : 'var(--surface)'}
                stroke={active ? 'var(--accent)' : 'var(--border-2)'}
                strokeWidth={active ? 2.5 : 1.5}
              />
              <text
                x={n.x}
                y={n.y + n.r + 14}
                textAnchor="middle"
                fontSize={n.r > 14 ? 13 : 11}
                fontWeight={active ? 600 : 400}
                fill="var(--fg)"
                style={{ fontFamily: '-apple-system, system-ui, sans-serif' }}
              >
                {n.label}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
