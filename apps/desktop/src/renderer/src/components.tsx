import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react'

/** 把 epoch ms 转本地日期 YYYY-MM-DD 字符串（renderer 端便捷方法） */
export function toLocalDateStr(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d
    .getDate()
    .toString()
    .padStart(2, '0')}`
}

/** 从本地日期 YYYY-MM-DD 取当天零点的 epoch ms */
export function fromLocalDateStr(date: string): number {
  const [y, m, d] = date.split('-').map((x) => parseInt(x, 10))
  if (!y || !m || !d) return Number.NaN
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime()
}

/** 窗口拖动：用于非交互区域的根容器，使该区可拖动窗口 */
export function DragRegion({
  children,
  className = '',
  style
}: {
  children?: React.ReactNode
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <div
      className={className}
      style={{ WebkitAppRegion: 'drag', ...style } as React.CSSProperties}
    >
      {children}
    </div>
  )
}

/** 标记某元素为不可拖动（按钮/输入等交互元素需包裹） */
export function NoDrag({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={className} style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      {children}
    </div>
  )
}

/** 页面 accent 9 域映射，用于 setAccent 切换 */
export type AccentPage =
  | 'chat'
  | 'timeline'
  | 'diary'
  | 'projects'
  | 'wiki'
  | 'personality'
  | 'skills'
  | 'relations'
  | 'brain'

const ACCENT_MAP: Record<AccentPage, { a: string; s: string; l: string }> = {
  chat:        { a: 'var(--accent-chat)',         s: 'var(--accent-chat-soft)',         l: 'var(--accent-chat-line)' },
  timeline:    { a: 'var(--accent-timeline)',     s: 'var(--accent-timeline-soft)',     l: 'var(--accent-timeline-line)' },
  diary:       { a: 'var(--accent-diary)',        s: 'var(--accent-diary-soft)',        l: 'var(--accent-diary-line)' },
  projects:    { a: 'var(--accent-projects)',     s: 'var(--accent-projects-soft)',     l: 'var(--accent-projects-line)' },
  wiki:        { a: 'var(--accent-wiki)',         s: 'var(--accent-wiki-soft)',         l: 'var(--accent-wiki-line)' },
  personality: { a: 'var(--accent-personality)',  s: 'var(--accent-personality-soft)',  l: 'var(--accent-personality-line)' },
  skills:      { a: 'var(--accent-skills)',       s: 'var(--accent-skills-soft)',       l: 'var(--accent-skills-line)' },
  relations:   { a: 'var(--accent-relations)',    s: 'var(--accent-relations-soft)',    l: 'var(--accent-relations-line)' },
  brain:       { a: 'var(--accent-brain)',        s: 'var(--accent-brain-soft)',        l: 'var(--accent-brain-line)' }
}

/** 切换当前页 accent：写 :root 上的 --accent / --accent-soft / --accent-line */
export function setAccent(page: AccentPage): void {
  const c = ACCENT_MAP[page]
  if (!c) return
  const root = document.documentElement
  root.style.setProperty('--accent', c.a)
  root.style.setProperty('--accent-soft', c.s)
  root.style.setProperty('--accent-line', c.l)
}

/** 标准按钮：hairline 边框 + 工具感 */
export function Button({
  children,
  onClick,
  disabled,
  variant = 'filled',
  size = 'md',
  title
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  variant?: 'filled' | 'outlined'
  size?: 'md' | 'sm'
  title?: string
}) {
  const base =
    variant === 'filled'
      ? 'bg-stone-700 border-stone-700 text-white hover:bg-stone-600 hover:border-stone-600'
      : 'bg-cream-200 text-stone-600 border-stone-300 hover:bg-cream-50 hover:text-stone-700'
  const pad = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-[7px] text-[13px]'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`font-medium rounded-sm border transition-colors duration-150 ease-organic active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed ${pad} ${base}`}
    >
      {children}
    </button>
  )
}

/** 小标签按钮：用于 tab/类型筛选 */
export function TagButton({
  children,
  onClick,
  active
}: {
  children: React.ReactNode
  onClick?: () => void
  active?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={
        'px-3 py-1.5 text-xs font-medium rounded-sm border transition-all duration-150 ease-organic ' +
        (active
          ? 'bg-accent-soft text-accent border-accent-line'
          : 'bg-cream-200 text-stone-500 border-stone-300 hover:bg-cream-50 hover:text-stone-600 hover:border-stone-300')
      }
    >
      {children}
    </button>
  )
}

export function Card({
  children,
  onClick,
  active
}: {
  children: React.ReactNode
  onClick?: () => void
  active?: boolean
}) {
  return (
    <div
      onClick={onClick}
      className={
        'p-3.5 rounded border transition-all duration-150 ease-organic card-hover ' +
        (active
          ? 'bg-accent-soft border-accent-line'
          : 'bg-cream-200 border-stone-300 ' +
            (onClick ? 'cursor-pointer hover:bg-cream-50' : ''))
      }
    >
      {children}
    </div>
  )
}

/** mono 小标签：UPPERCASE + letter-spacing */
export function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="mono text-[11px] tracking-[0.06em] text-stone-400 uppercase">{children}</span>
  )
}

/** 小标签：用于元信息（来源、计数等） */
export function Tag({
  children,
  variant = 'default'
}: {
  children: React.ReactNode
  variant?: 'default' | 'accent' | 'ok'
}) {
  const cls =
    variant === 'accent'
      ? 'text-accent bg-accent-soft border-accent-line'
      : variant === 'ok'
        ? 'text-ok border-stone-300 bg-cream-50'
        : 'text-stone-500 bg-cream-50 border-stone-300'
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-medium px-[7px] py-0.5 rounded-sm border ${cls}`}
    >
      {children}
    </span>
  )
}

/** pill：圆角小药丸，用于次级元信息 */
export function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="mono text-[11px] px-[7px] py-0.5 rounded-full bg-stone-100 text-stone-400">
      {children}
    </span>
  )
}

export function Empty({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center h-full p-8">
      <div className="max-w-sm text-center border border-stone-300 bg-cream-200 rounded p-6">
        <p className="text-base text-stone-600">{text}</p>
      </div>
    </div>
  )
}

/** API Key 输入：显示/隐藏切换 + focus 自动全选 */
export function SecretInput({
  value,
  onChange,
  placeholder
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="flex gap-2">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => e.target.select()}
        placeholder={placeholder}
        className="flex-1 bg-cream-200 border border-stone-300 rounded px-3 py-1.5 text-sm text-stone-700 placeholder-stone-400 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft transition-colors duration-150"
      />
      <TagButton onClick={() => setShow((s) => !s)}>{show ? '隐藏' : '显示'}</TagButton>
    </div>
  )
}

/** 标准文本输入框 */
export function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  list
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  list?: string
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={(e) => e.target.select()}
      placeholder={placeholder}
      list={list}
      className="w-full bg-cream-200 border border-stone-300 rounded px-3 py-1.5 text-sm text-stone-700 placeholder-stone-400 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft transition-colors duration-150"
    />
  )
}

export function useAsync<T>(
  fn: () => Promise<T>,
  deps: unknown[] = []
): { data: T | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    let alive = true
    setLoading(true)
    fn()
      .then((d) => alive && setData(d))
      .catch((e) => console.error(e))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  // 后台到前台自动 reload：切回窗口时数据可能过期
  useEffect(() => {
    function onVis(): void {
      if (document.visibilityState === 'visible') {
        setNonce((n) => n + 1)
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  return { data, loading, reload: () => setNonce((n) => n + 1) }
}

/** 防抖：值变化后延迟 ms 触发，用于自动保存 */
export function useDebouncedCallback<T extends unknown[]>(
  callback: (...args: T) => void,
  delay: number
): (...args: T) => void {
  const ref = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saved = useRef(callback)
  useEffect(() => {
    saved.current = callback
  }, [callback])
  return useCallback(
    (...args: T) => {
      if (ref.current) clearTimeout(ref.current)
      ref.current = setTimeout(() => saved.current(...args), delay)
    },
    [delay]
  )
}

export function basename(p: string): string {
  const parts = p.split('/')
  return parts[parts.length - 1] || p
}

/** 是否像 uuid/随机串（非人命名） */
export function looksLikeUUID(name: string): boolean {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name)) return true
  if (/^[0-9a-f]{32,}$/i.test(name)) return true
  if (name.length >= 24 && /^[a-z0-9-]+$/i.test(name) && !/[aeiou]{2,}/i.test(name)) {
    const letters = name.replace(/[^a-z]/gi, '')
    if (letters.length >= 16 && name.replace(/-/g, '').length >= 24) return true
  }
  return false
}

export function formatTime(ms: number | string): string {
  try {
    const t = typeof ms === 'string' ? new Date(ms).getTime() : ms
    return new Date(t).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch {
    return String(ms)
  }
}

/** 紧凑时间：只取 HH:mm */
export function formatClock(ms: number | string): string {
  try {
    const t = typeof ms === 'string' ? new Date(ms).getTime() : ms
    const d = new Date(t)
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  } catch {
    return String(ms)
  }
}

export function formatHourLocal(hourStartMs: number | string): string {
  try {
    const t = typeof hourStartMs === 'string' ? new Date(hourStartMs).getTime() : hourStartMs
    const d = new Date(t)
    const hh = d.getHours().toString().padStart(2, '0')
    return `${hh}:00`
  } catch {
    return String(hourStartMs)
  }
}

export function formatDateLocal(ms: number | string): string {
  try {
    const t = typeof ms === 'string' ? new Date(ms).getTime() : ms
    const d = new Date(t)
    return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d
      .getDate()
      .toString()
      .padStart(2, '0')}`
  } catch {
    return String(ms)
  }
}

/** 极简 markdown 渲染 */
export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/^---[\s\S]*?---\n?/, '').split('\n')
  const blocks: React.ReactNode[] = []
  let list: string[] = []
  let key = 0

  const flushList = (): void => {
    if (list.length > 0) {
      blocks.push(
        <ul key={key++} className="list-disc pl-6 space-y-1 my-2">
          {list.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ul>
      )
      list = []
    }
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      flushList()
      continue
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) {
      flushList()
      const level = (h[1] ?? '').length
      const text = h[2] ?? ''
      const cls =
        level === 1
          ? 'text-[24px] font-semibold tracking-[-0.02em] text-stone-700 mt-6 mb-3'
          : level === 2
            ? 'text-[18px] font-semibold tracking-[-0.01em] text-stone-700 mt-5 mb-2'
            : 'text-[15px] font-semibold text-stone-600 mt-4 mb-1'
      blocks.push(
        <div key={key++} className={cls}>
          {renderInline(text)}
        </div>
      )
      continue
    }
    if (/^[-*]\s+/.test(line)) {
      list.push(line.replace(/^[-*]\s+/, ''))
      continue
    }
    flushList()
    blocks.push(
      <p key={key++} className="leading-[1.75] my-3 text-stone-600 max-w-[64ch]">
        {renderInline(line)}
      </p>
    )
  }
  flushList()
  return <div className="markdown-body">{blocks}</div>
}

function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\[\[[^\]]+\]\]|\*\*[^*]+\*\*|`[^`]+`)/g)
  return parts.map((p, i) => {
    if (/^\[\[([^\]]+)\]\]$/.test(p)) {
      return (
        <span key={i} className="text-accent border-b border-accent-line">
          {p.match(/^\[\[([^\]]+)\]\]$/)?.[1] ?? p}
        </span>
      )
    }
    if (/^\*\*[^*]+\*\*$/.test(p)) {
      return (
        <strong key={i} className="font-semibold text-stone-700">
          {p.slice(2, -2)}
        </strong>
      )
    }
    if (/^`[^`]+`$/.test(p)) {
      return (
        <code key={i} className="mono text-[13px] bg-accent-soft text-accent px-1.5 py-0.5 rounded-sm">
          {p.slice(1, -1)}
        </code>
      )
    }
    return <span key={i}>{p}</span>
  })
}

/** Tabs 通用组件 */
export function Tabs({
  tabs,
  active,
  onChange
}: {
  tabs: Array<{ id: string; label: string; count?: number }>
  active: string
  onChange: (id: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={
            'px-3 py-1.5 text-xs font-medium rounded-sm border transition-all duration-150 ease-organic ' +
            (active === t.id
              ? 'bg-accent-soft text-accent border-accent-line'
              : 'bg-cream-200 text-stone-500 border-stone-300 hover:bg-cream-50 hover:text-stone-600')
          }
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1 opacity-70">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

/**
 * FitText —— 自适应字号，保证内容始终单行展示。
 * 测量真实渲染宽度，超出容器时按比例缩小字号（不小于 min）。
 */
export function FitText({
  children,
  max = 22,
  min = 12,
  className = ''
}: {
  children: string
  max?: number
  min?: number
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState(max)

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const parent = container.parentElement
    if (!parent) return

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    function recompute(): void {
      const el = containerRef.current
      if (!el) return
      const p = el.parentElement
      if (!p) return
      // 父级 clientWidth 是 grid cell 的实际可用宽度
      const avail = p.clientWidth
      if (avail <= 0) return

      const style = getComputedStyle(el)
      // 用 canvas 测 max 字号下文本宽度，避免 DOM 闪烁
      ctx!.font = `${style.fontWeight} ${max}px ${style.fontFamily}`
      const textWidth = ctx!.measureText(children).width
      if (textWidth <= avail) {
        setSize(max)
        return
      }
      // 按比例缩放：avail / textWidth * max，floor 到 0.5px，clamp 到 [min, max]
      const scaled = Math.floor(((avail / textWidth) * max) * 2) / 2
      setSize(Math.max(min, Math.min(max, scaled)))
    }

    recompute()
    const ro = new ResizeObserver(recompute)
    ro.observe(parent)
    return () => ro.disconnect()
  }, [children, max, min])

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        fontSize: `${size}px`,
        lineHeight: 1.2,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis'
      }}
    >
      {children}
    </div>
  )
}
