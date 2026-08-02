import { useState, useEffect, useRef, useCallback } from 'react'

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
export function DragRegion({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={className} style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
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

export function PageHeader({
  title,
  subtitle,
  action
}: {
  title: string
  subtitle?: string
  action?: React.ReactNode
}) {
  return (
    <DragRegion className="border-b-2 border-black px-5 py-1.5 flex items-center justify-between">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h2 className="text-xl font-black tracking-tight">{title}</h2>
        {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
      </div>
      {action && <NoDrag>{action}</NoDrag>}
    </DragRegion>
  )
}

/**
 * 标准按钮（统一规格：px-5 py-2.5 text-sm）
 */
export function Button({
  children,
  onClick,
  disabled,
  variant = 'filled',
  size = 'md'
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  variant?: 'filled' | 'outlined'
  size?: 'md' | 'sm'
}) {
  const base =
    variant === 'filled'
      ? 'bg-black text-white hover:bg-white hover:text-black'
      : 'bg-white text-black hover:bg-black hover:text-white'
  const pad = size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-5 py-2.5 text-sm'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`font-bold border-2 border-black ${pad} ${base} active:bg-gray-200 transition-none disabled:opacity-50`}
    >
      {children}
    </button>
  )
}

/** 小标签按钮（用于 tab/供应商选择，统一 px-3 py-1.5 text-xs） */
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
      className={`px-3 py-1.5 text-xs font-bold border-2 border-black transition-none ${
        active ? 'bg-black text-white' : 'bg-white text-black hover:bg-black hover:text-white'
      }`}
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
      className={`border-2 border-black p-4 transition-none ${
        onClick ? 'cursor-pointer hover:bg-black hover:text-white' : ''
      } ${active ? 'bg-black text-white' : ''}`}
    >
      {children}
    </div>
  )
}

export function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-bold uppercase tracking-widest opacity-50">{children}</span>
}

export function Empty({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center h-full p-12">
      <div className="border-2 border-black p-12">
        <Label>空</Label>
        <p className="text-xl font-black mt-2">{text}</p>
      </div>
    </div>
  )
}

/** API Key 输入：显示/隐藏切换 + focus 自动全选（统一输入框规格） */
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
        className="flex-1 border-2 border-black px-3 py-2.5 text-sm font-bold focus:outline-none focus:bg-gray-100 transition-none"
      />
      <TagButton onClick={() => setShow((s) => !s)}>{show ? '隐藏' : '显示'}</TagButton>
    </div>
  )
}

/** 标准文本输入框（统一规格） */
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
      className="w-full border-2 border-black px-3 py-2.5 text-sm font-bold focus:outline-none focus:bg-gray-100 transition-none"
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
          ? 'text-2xl font-black mt-4 mb-2'
          : level === 2
            ? 'text-xl font-black mt-3 mb-2'
            : 'text-lg font-black mt-2 mb-1'
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
      <p key={key++} className="leading-relaxed my-1.5">
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
        <span key={i} className="font-bold border-b border-current">
          {p.match(/^\[\[([^\]]+)\]\]$/)?.[1] ?? p}
        </span>
      )
    }
    if (/^\*\*[^*]+\*\*$/.test(p)) {
      return (
        <strong key={i} className="font-black">
          {p.slice(2, -2)}
        </strong>
      )
    }
    if (/^`[^`]+`$/.test(p)) {
      return (
        <code key={i} className="font-mono text-sm border border-current px-1">
          {p.slice(1, -1)}
        </code>
      )
    }
    return <span key={i}>{p}</span>
  })
}

/** Tabs 通用组件（用 TagButton 规格统一） */
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
    <div className="flex flex-wrap border-b-2 border-black">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`px-4 py-2.5 text-sm font-bold border-r border-black transition-none ${
            active === t.id ? 'bg-black text-white' : 'bg-white text-black hover:bg-black hover:text-white'
          }`}
        >
          {t.label}
          {t.count !== undefined && <span className="text-xs opacity-50 ml-2">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}
