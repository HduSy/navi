import { useState, useEffect, useRef, useCallback, useLayoutEffect, useMemo } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'

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

/** 按下点是否落在文本节点矩形内（区分「空白可拖窗」与「文字可选择」）：
 *  从事件目标向上走到 drag 根，逐层只测各元素的直接文本节点。 */
function isOverText(x: number, y: number, root: HTMLElement, target: HTMLElement): boolean {
  let el: HTMLElement | null = target
  while (el) {
    for (let n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === Node.TEXT_NODE && n.textContent && n.textContent.trim()) {
        const range = document.createRange()
        range.selectNodeContents(n)
        for (const r of range.getClientRects()) {
          if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true
        }
      }
    }
    if (el === root) break
    el = el.parentElement
  }
  return false
}

/** 窗口拖动：用于非交互区域的根容器，使该区可拖动窗口。
 *  - 事件目标是容器自身时走原生 data-tauri-drag-region（含双击最大化）；
 *  - 目标是子元素时兜底代理：交互元素（按钮/输入/链接等）与文字区
 *    （保留选择行为）不拖，其余空白一律可拖动窗口。 */
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
      data-tauri-drag-region
      onMouseDown={(e) => {
        if (e.button !== 0) return
        const t = e.target as HTMLElement
        const root = e.currentTarget as HTMLElement
        if (t.hasAttribute('data-tauri-drag-region')) return // 交给原生脚本
        if (t.closest('button, input, textarea, select, a, label, [contenteditable], [role="button"], [data-nodrag]')) return
        if (isOverText(e.clientX, e.clientY, root, t)) return // 文字区：保留选择
        getCurrentWindow().startDragging().catch(() => {})
      }}
      style={{ WebkitAppRegion: 'drag', ...style } as React.CSSProperties}
    >
      {children}
    </div>
  )
}

/** 标记某元素为不可拖动（按钮/输入等交互元素需包裹） */
export function NoDrag({
  children,
  className = '',
  style
}: {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <div className={className} style={{ WebkitAppRegion: 'no-drag', ...style } as React.CSSProperties}>
      {children}
    </div>
  )
}

/** 页面 accent 域映射，用于 setAccent 切换 */
export type AccentPage =
  | 'chat'
  | 'timeline'
  | 'diary'
  | 'projects'
  | 'wiki'
  | 'personality'
  | 'skills'
  | 'relations'
  | 'memory'
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
  memory:      { a: 'var(--accent-memory)',       s: 'var(--accent-memory-soft)',       l: 'var(--accent-memory-line)' },
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
  title,
  className = ''
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  variant?: 'filled' | 'outlined'
  size?: 'md' | 'sm'
  title?: string
  className?: string
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
      className={`font-medium rounded-sm border transition-colors duration-150 ease-organic active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed ${pad} ${base} ${className}`}
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

/** 阅读正文渲染（日记定下的规范）：bullet 用 ·（stone-400）、段落 14.5px/1.75，
 *  行内 wikilink/加粗/代码沿用 accent 色系。日记、经验等文字篇幅页统一使用。 */
export function ReadingBody({ body }: { body: string }) {
  const lines = body.split('\n')
  const blocks: React.ReactNode[] = []
  let bullets: string[] = []
  function flush(): void {
    if (bullets.length === 0) return
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="space-y-1.5">
        {bullets.map((l, i) => (
          <li key={i} className="text-[14.5px] leading-[1.7] text-stone-600 flex gap-2">
            <span className="text-stone-400 mt-[2px] shrink-0">·</span>
            <span>{renderInline(l.replace(/^[-*]\s+/, ''))}</span>
          </li>
        ))}
      </ul>
    )
    bullets = []
  }
  for (const line of lines) {
    if (/^[-*]\s+/.test(line)) bullets.push(line)
    else {
      flush()
      if (line.trim()) {
        blocks.push(
          <p key={`p-${blocks.length}`} className="text-[14.5px] leading-[1.75] text-stone-600 whitespace-pre-wrap">
            {renderInline(line)}
          </p>
        )
      }
    }
  }
  flush()
  return <div className="space-y-2">{blocks}</div>
}

/** 切 tab / 视图滚动位置记忆：ref 挂到滚动容器，离开时保存、回来时恢复。
 *  数据异步加载的页面会在内容撑起高度后的渲染里完成恢复；
 *  initial：无存档时的初始位置（聊天页 bottom，其余默认 top）；
 *  ready：数据就绪标志（聊天页要等消息加载完再贴底），默认 true。
 *  保存发生在「元素被真正移除」时（卸载/被替换，而非普通 re-render），
 *  因此经验/日记等列表↔详情互切、以及整个页面切走，都能各自记住位置。
 *
 *  位置读取时机是刻意设计的：
 *  - Chromium 里元素被移出文档后 scrollTop 会归零，所以保存必须用「移除前」
 *    捕获的值：scroll 事件实时记 + 每个 commit 的 layout 清理/挂载时再刷一次
 *    （兜底程序化 scrollTop，如聊天流式贴底不产生 scroll 事件）；
 *  - 组件整体卸载时 layout 清理先于子节点移除（ref 仍指向已挂载元素），
 *    能取到真实 scrollTop；列表↔详情互切时子节点先被移除（ref 已为 null），
 *    此时跳过刷新、直接用 scroll 事件积累的 posRef。 */
export function useScrollRestore<T extends HTMLElement = HTMLDivElement>(
  key: string,
  initial: 'top' | 'bottom' = 'top',
  ready = true
) {
  const ref = useRef<T>(null)
  const restoredRef = useRef(false)
  const posRef = useRef<number | null>(null)
  const lastSetRef = useRef<number | null>(null)

  // 恢复：不设 deps，每次渲染都尝试，直到内容高度足够、真正恢复成功为止。
  // 用 useLayoutEffect：在绘制前把 scrollTop 摆好，避免「先看到开头再跳过去」的闪烁。
  // - 内容没撑起（maxScroll<=0，占位/空态）时不动作，等后续渲染；
  // - 能精确够到 target（±1px）才算「已恢复」并停止重试；
  // - 暂时只够到 min(target, maxScroll) 时先夹到那里继续等，后续渲染撑高后再
  //   补足到 target（脑页等占位内容先矮后高的场景）；内容收缩场景则由 scroll
  //   事件里的「用户接管」检测终止重试。
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || restoredRef.current || !ready) return
    const saved = sessionStorage.getItem(key)
    if (saved === null) {
      if (initial === 'bottom') el.scrollTop = el.scrollHeight
      restoredRef.current = true
      posRef.current = el.scrollTop
      return
    }
    const target = Number(saved)
    const maxScroll = el.scrollHeight - el.clientHeight
    if (maxScroll <= 0) return
    const want = Math.min(target, maxScroll)
    el.scrollTop = want
    lastSetRef.current = want
    posRef.current = want
    if (want >= target - 1) restoredRef.current = true
  })

  // 每个 commit 前后刷新 posRef：此时元素一定还挂在文档里（scrollTop 有效）
  useLayoutEffect(() => {
    const refresh = (): void => {
      if (ref.current) posRef.current = ref.current.scrollTop
    }
    refresh()
    return refresh
  })

  // scroll 事件实时记录 + 元素卸载/替换时保存。
  // 保存时机在 passive cleanup：此时 ref 已被 detach（ref.current !== el 成立），
  // 元素已移除，所以保存的是 posRef 而不是 el.scrollTop。
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onScroll = (): void => {
      const st = el.scrollTop
      posRef.current = st
      // 位置与最后一次程序化设置明显不符 → 用户接管，停止后续重试
      if (lastSetRef.current !== null && Math.abs(st - lastSetRef.current) > 2) {
        restoredRef.current = true
        lastSetRef.current = null
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (ref.current !== el) {
        // 只有恢复过的会话才保存，避免加载失败时把好位置覆盖成 0
        if (restoredRef.current && posRef.current !== null) {
          sessionStorage.setItem(key, String(posRef.current))
        }
        restoredRef.current = false
        posRef.current = null
        lastSetRef.current = null
      }
    }
  })

  return ref
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

/**
 * Select —— 通用下拉选择器（自实现，适配 Navi 样式风格）
 *
 * 功能：
 *  - 点击触发按钮展开选项面板
 *  - 支持可编辑模式（editable）：允许手动输入自定义值，同时从 options 里筛选
 *  - 支持只读模式：只能从 options 里选
 *  - 点击外部自动收起，Esc 收起，Enter 选中高亮项
 *  - 键盘上下键导航选项
 */
export function Select({
  value,
  onChange,
  options,
  placeholder = '请选择',
  editable = false,
  emptyText = '无选项'
}: {
  value: string
  onChange: (v: string) => void
  options: string[]
  placeholder?: string
  editable?: boolean
  emptyText?: string
}) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState(value)
  const [highlight, setHighlight] = useState(-1)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // 外部 value 变化时同步 input
  useEffect(() => {
    setInput(value)
  }, [value])

  // 点击外部收起
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
        setHighlight(-1)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  // 筛选后的选项
  const filtered = useMemo(() => {
    if (!editable || !input || input === value) return options
    const q = input.toLowerCase()
    return options.filter((o) => o.toLowerCase().includes(q))
  }, [options, editable, input, value])

  function commit(v: string) {
    onChange(v)
    setInput(v)
    setOpen(false)
    setHighlight(-1)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setOpen(false)
      setHighlight(-1)
      return
    }
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      e.preventDefault()
      setOpen(true)
      setHighlight(filtered.findIndex((o) => o === value))
      return
    }
    if (!open) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const idx = highlight >= 0 ? highlight : filtered.findIndex((o) => o === input)
      if (idx >= 0 && idx < filtered.length) commit(filtered[idx]!)
      else if (editable && input) commit(input)
    }
  }

  // 滚动到高亮项
  useEffect(() => {
    if (!open || highlight < 0) return
    const el = listRef.current?.querySelector(`[data-idx="${highlight}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlight, open])

  const triggerCls =
    'w-full bg-cream-200 border border-stone-300 rounded px-3 py-1.5 text-sm text-stone-700 placeholder-stone-400 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft transition-colors duration-150 text-left'

  return (
    <div ref={rootRef} className="relative">
      {editable ? (
        <input
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
            if (!open) setOpen(true)
            // 立即透传输入（允许自定义值实时生效）
            onChange(e.target.value)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className={triggerCls + ' pr-8'}
        />
      ) : (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          onKeyDown={onKeyDown}
          className={triggerCls + ' flex items-center justify-between' + (value ? '' : ' text-stone-400')}
        >
          <span className="truncate">{value || placeholder}</span>
          <span className={'mono text-[10px] text-stone-400 transition-transform ' + (open ? 'rotate-180' : '')}>▼</span>
        </button>
      )}

      {open && (
        <div
          ref={listRef}
          className="absolute z-50 mt-1 left-0 right-0 max-h-[220px] overflow-auto hide-scrollbar bg-cream-50 border border-stone-300 rounded shadow-sm"
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-stone-400">{emptyText}</div>
          ) : (
            filtered.map((o, i) => (
              <div
                key={o}
                data-idx={i}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => commit(o)}
                className={
                  'px-3 py-1.5 text-sm cursor-pointer transition-colors ' +
                  (o === value
                    ? 'bg-accent-soft text-accent'
                    : i === highlight
                      ? 'bg-cream-200 text-stone-700'
                      : 'text-stone-600 hover:bg-cream-200')
                }
              >
                {o}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
