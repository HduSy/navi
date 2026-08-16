import { Routes, Route, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { listen } from '@tauri-apps/api/event'
import { Chat } from './pages/Chat'
import { Timeline } from './pages/Timeline'
import { Diary } from './pages/Diary'
import { Projects } from './pages/Projects'
import { Wiki } from './pages/Wiki'
import { Personality } from './pages/Personality'
import { Skills } from './pages/Skills'
import { Relations } from './pages/Relations'
import { Brain } from './pages/Brain'
import { DragRegion, setAccent, formatClock } from './components'
import type { AccentPage } from './components'
import { getChatPhase, subscribeChatPhase } from './face-state'
import {
  IconChat,
  IconTimeline,
  IconDiary,
  IconProjects,
  IconWiki,
  IconPersonality,
  IconSkills,
  IconRelations,
  IconBrain
} from './icons'

interface NavEntry {
  to: string
  label: string
  tip: string
  Icon: (p: { className?: string }) => React.ReactElement
  accent: AccentPage
}

const NAV_SECTIONS: Array<{ label: string; items: NavEntry[] }> = [
  {
    label: '日常',
    items: [
      { to: '/', label: '聊天', tip: '和 Navi 聊聊，或让它调整自己的脾气', Icon: IconChat, accent: 'chat' },
      { to: '/timeline', label: '时间线', tip: '每小时记下你做了什么', Icon: IconTimeline, accent: 'timeline' },
      { to: '/diary', label: '日记', tip: '每晚 21 点 Navi 自动给你写一篇', Icon: IconDiary, accent: 'diary' }
    ]
  },
  {
    label: '认知',
    items: [
      { to: '/projects', label: '项目', tip: '从 Claude Code 会话里识别出的代码库', Icon: IconProjects, accent: 'projects' },
      { to: '/wiki', label: '经验', tip: '踩过的坑都是经验 · Navi 从会话里自动提炼，可读可编辑', Icon: IconWiki, accent: 'wiki' },
      { to: '/personality', label: '人格', tip: 'Navi 的脾气 · 直接拖动调整，失焦自动保存', Icon: IconPersonality, accent: 'personality' },
      { to: '/skills', label: '技能', tip: '从你的会话里抽出的扩展能力', Icon: IconSkills, accent: 'skills' },
      { to: '/relations', label: '关系', tip: '从会话里识别出的人', Icon: IconRelations, accent: 'relations' }
    ]
  },
  {
    label: '配置',
    items: [
      { to: '/brain', label: '脑子', tip: '始终读你的 Claude 配置 · 换号用 cc-switch 改 settings.json 后重启', Icon: IconBrain, accent: 'brain' }
    ]
  }
]

const ALL_ITEMS = NAV_SECTIONS.flatMap((s) => s.items)

/** 根据当前路由派生 accent page */
function useAccentFromRoute(): AccentPage {
  const { pathname } = useLocation()
  const match = ALL_ITEMS.find((i) => (i.to === '/' ? pathname === '/' : pathname.startsWith(i.to)))
  return match?.accent ?? 'chat'
}

function Clock(): React.ReactElement {
  const [now, setNow] = useState(() => formatClock(Date.now()))
  useEffect(() => {
    // 对齐到下一分钟边界再刷新：固定 30s 间隔会让分钟切换后最长滞后约 30s
    let timerId: ReturnType<typeof setTimeout>
    const tick = (): void => {
      setNow(formatClock(Date.now()))
      timerId = setTimeout(tick, 60_000 - (Date.now() % 60_000))
    }
    tick()
    return () => clearTimeout(timerId)
  }, [])
  return <span>{now}</span>
}

/** 各页面的表情帧序列（微表情：靠字符切换，不靠整体位移）。
 *  帧里重复首帧制造停顿感，interval 控制节奏。
 */
const PAGE_FACES: Record<string, { frames: string[]; label: string; interval: number }> = {
  '/':            { frames: ['(・ω・)', '(・ω・)', '(・ー・)', '(・ω・)'], label: '在听', interval: 600 },
  '/timeline':    { frames: ['(◔ω◔)', '(◔ω◔)', '(◡ω◡)', '(◔ω◔)'], label: '记着呢', interval: 650 },
  '/diary':       { frames: ['(˘ω˘)', '(˘ω˘)', '(-ω-)', '(˘ω˘)'], label: '酝酿日记', interval: 700 },
  '/projects':    { frames: ['(◎_◎)', '(◉_◉)', '(◎_◎)', '(⊙_⊙)', '(◎_◎)'], label: '盘项目', interval: 420 },
  '/wiki':        { frames: ['(▼ω▼)', '(▼ω▼)', '(▽ω▽)', '(▼ω▼)'], label: '翻记忆', interval: 650 },
  '/personality': { frames: ['(￣ω￣)', '(￣ω￣)', '(￣∀￣)', '(￣ω￣)'], label: '端详自己', interval: 750 },
  '/skills':      { frames: ['(・∀・)', '(・∀・)', '(ー∀ー)', '(・∀・)'], label: '清点技能', interval: 550 },
  '/relations':   { frames: ['(＾▽＾)', '(＾▽＾)', '(´▽｀)', '(＾▽＾)'], label: '数人头', interval: 600 },
  '/brain':       { frames: ['(◔_◔)', '(◔_◔)', '(◔‿◔)', '(◔_◔)'], label: '换脑子', interval: 500 }
}

const THINKING_FRAMES = ['(๑•̀ㅂ•́)و', '(๑•́ㅂ•̀)و']
const IDLE_FRAMES = ['(´-ω-)', '(´-ω-)', '(-ω-)', '(´-ω-)']

/** 帧动画 hook：循环播放字符帧 */
function useFaceFrames(frames: string[], interval: number): string {
  const [i, setI] = useState(0)
  useEffect(() => {
    setI(0)
    const id = setInterval(() => setI((v) => (v + 1) % frames.length), interval)
    return () => clearInterval(id)
  }, [frames, interval])
  return frames[Math.min(i, frames.length - 1)]!
}

/** 路由前缀匹配页面表情（'/' 需精确匹配） */
function faceForPath(pathname: string): { frames: string[]; label: string; interval: number } {
  if (pathname !== '/') {
    const hit = Object.keys(PAGE_FACES).find((p) => p !== '/' && pathname.startsWith(p))
    if (hit) return PAGE_FACES[hit]!
  }
  return PAGE_FACES['/']!
}

/** 三点循环动画：用 keyframes 让三个点依次升降，表示「正在…」 */
function Dots(): React.ReactElement {
  return (
    <span className="inline-flex gap-[1px] ml-0.5" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block w-[3px] h-[3px] rounded-full bg-current"
          style={{
            animation: `navi-dot 1.2s ${i * 0.18}s ease-in-out infinite`,
            opacity: 0.4
          }}
        />
      ))}
    </span>
  )
}

/** Navi 颜文字表情：反映真实状态。
 *  优先级：聊天回复中（thinking）> 空闲发呆（30s 无操作）> 页面对应表情（偶尔眨眼）。
 */
function NaviFace(): React.ReactElement {
  const { pathname } = useLocation()
  const [idle, setIdle] = useState(false)
  const [chatPhase, setLocalPhase] = useState(getChatPhase())
  const lastActivityRef = useRef(Date.now())

  // 全局操作监听：只记时间戳到 ref，不触发渲染
  useEffect(() => {
    const on = () => {
      lastActivityRef.current = Date.now()
    }
    const evs = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart']
    evs.forEach((e) => window.addEventListener(e, on, { passive: true }))
    return () => evs.forEach((e) => window.removeEventListener(e, on))
  }, [])

  // 每 2s 检查一次：超过 30s 无操作 → 发呆
  useEffect(() => {
    const id = setInterval(() => {
      setIdle(Date.now() - lastActivityRef.current > 30_000)
    }, 2000)
    return () => clearInterval(id)
  }, [])

  // 订阅 Chat 页上报的阶段（发送消息 → thinking）
  useEffect(() => subscribeChatPhase(setLocalPhase), [])

  const thinking = chatPhase === 'thinking'
  const base = faceForPath(pathname)
  const cfg = thinking
    ? { frames: THINKING_FRAMES, interval: 280, label: '思考中', dots: true }
    : idle
      ? { frames: IDLE_FRAMES, interval: 900, label: '发呆', dots: false }
      : { frames: base.frames, interval: base.interval, label: base.label, dots: false }

  const face = useFaceFrames(cfg.frames, cfg.interval)

  return (
    <span
      className="flex items-center gap-1 text-[12px] text-stone-500 leading-none select-none"
      style={{ fontFamily: '"PingFang SC", -apple-system, system-ui, sans-serif' }}
      title={`Navi ${cfg.label}…`}
    >
      {/* min-width 兜底防帧切换时宽度抖动 */}
      <span className="text-[13px] inline-block text-center" style={{ minWidth: '5.2em' }}>{face}</span>
      <span className="inline-flex items-baseline">
        {cfg.label}
        {cfg.dots && <Dots />}
      </span>
    </span>
  )
}

/** Navi 品牌水印：logo 的圆环印记居中铺在整窗背景，低透明度、不挡交互、不随页面滚动 */
function NaviWatermark(): React.ReactElement {
  return (
    <div aria-hidden className="pointer-events-none select-none fixed inset-0 z-0 flex items-center justify-center">
      <svg viewBox="96 120 800 800" width="70vmin" height="70vmin" fill="none" style={{ opacity: 0.06 }}>
        {/* 内圈细刻度环 */}
        <circle cx="488" cy="512" r="246" stroke="#94A3B8" strokeOpacity="0.35" strokeWidth="2" strokeDasharray="1.5 10" strokeLinecap="round" />
        {/* 主圆环：被右上圆球咬开缺口 */}
        <path d="M 674 239 A 330 330 0 1 0 778 355" stroke="#334155" strokeWidth="52" strokeLinecap="round" />
        {/* 右上圆球 + 高光 */}
        <circle cx="778" cy="250" r="52" fill="#1E293B" />
        <circle cx="766" cy="238" r="16" fill="#FFFFFF" opacity="0.92" />
        {/* Navi 文字嵌环中 */}
        <text
          x="488"
          y="578"
          textAnchor="middle"
          fontFamily="'Smiley Sans','PingFang SC',system-ui,sans-serif"
          fontSize="168"
          fontWeight="700"
          fill="#334155"
          letterSpacing="3"
        >
          Navi
        </text>
        {/* 底部发丝线 */}
        <line x1="372" y1="688" x2="604" y2="688" stroke="#CBD5E1" strokeWidth="2" />
      </svg>
    </div>
  )
}

/** 侧边导航项。tooltip 用 fixed + portal 渲染：
 *  绝对定位的 tooltip 会向右伸出 224px 的 nav，在 overflow 容器里
 *  制造横向滚动；portal 到 body 后不参与容器溢出计算，视觉不变。 */
function SideNavItems() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null)
  const tipTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelTip = () => {
    if (tipTimer.current) {
      clearTimeout(tipTimer.current)
      tipTimer.current = null
    }
    setTip(null)
  }
  useEffect(() => cancelTip, [])

  return (
    <>
      <DragRegion className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-2.5">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label}>
            <div className="mono text-[11px] tracking-[0.06em] text-stone-400 px-2 pt-2.5 pb-1.5">{section.label}</div>
            <ul className="space-y-0">
              {section.items.map((item) => (
                <li
                  key={item.to}
                  onMouseEnter={(e) => {
                    // 悬停 1s 才出现：快速划过导航时不打扰
                    cancelTip()
                    const r = e.currentTarget.getBoundingClientRect()
                    // 锚定 tab 右上角：左移压到 tab 右端，视觉上挂在 tab 上而非浮在内容区
                    const x = r.right - 80
                    const y = r.top - 6
                    tipTimer.current = setTimeout(() => setTip({ text: item.tip, x, y }), 1000)
                  }}
                  onMouseLeave={cancelTip}
                >
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) =>
                      'flex items-center gap-[9px] px-2 py-[7px] rounded-sm border transition-colors duration-150 ease-organic text-[13px] font-medium ' +
                      (isActive
                        ? 'bg-accent-soft text-stone-700 border-accent-line'
                        : 'text-stone-500 border-transparent hover:bg-stone-100 hover:text-stone-600')
                    }
                  >
                    <item.Icon className="shrink-0 opacity-80" />
                    <span>{item.label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </DragRegion>
      {tip &&
        createPortal(
          <div
            role="tooltip"
            style={{ position: 'fixed', left: tip.x, top: tip.y, maxWidth: 220 }}
            className="pointer-events-none z-50 px-2.5 py-1.5 rounded-sm border border-stone-300 bg-cream-200 text-stone-600 text-[11px] leading-[1.5] whitespace-normal shadow-[0_4px_12px_rgba(0,0,0,0.08)]"
          >
            {tip.text}
          </div>,
          document.body
        )}
    </>
  )
}

/** LLM 调用失败的全局 toast（Rust 侧 emit_llm_error → llm-error 事件） */
function LlmErrorToaster() {
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([])
  useEffect(() => {
    let unlisten: (() => void) | undefined
    listen<{ reason?: string }>('llm-error', (e) => {
      const text = e.payload?.reason || 'LLM 调用失败'
      const id = Date.now() + Math.random()
      // 最多同时挂 3 条，防极端情况下刷屏
      setToasts((ts) => (ts.length >= 3 ? ts.slice(1) : ts).concat({ id, text }))
      setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 6000)
    }).then((fn) => (unlisten = fn))
    return () => unlisten?.()
  }, [])
  if (toasts.length === 0) return null
  return createPortal(
    <div className="fixed top-2.5 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2 w-max max-w-[70vw]">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="llm-toast-in px-3.5 py-2.5 rounded-sm border border-red-300 bg-cream-50 shadow-[0_4px_12px_rgba(0,0,0,0.12)] text-[12px] leading-[1.5] text-stone-700"
        >
          <span className="mono text-[11px] text-red-500 mr-1.5">LLM</span>
          {t.text}
        </div>
      ))}
    </div>,
    document.body
  )
}

export function App() {
  const accent = useAccentFromRoute()
  const navigate = useNavigate()

  // 未配置有效大脑（DB 无可用 key 且 claude settings.json 不可用）时，
  // 首开直接引导到「脑子」页完成配置
  useEffect(() => {
    window.navi
      .getBrain('analysis')
      .then((b) => {
        if (!b.apiKey) navigate('/brain', { replace: true })
      })
      .catch(() => {})
  }, [navigate])

  // 切路由时同步 accent CSS 变量
  useEffect(() => {
    setAccent(accent)
  }, [accent])

  return (
    <div className="grid h-screen w-screen overflow-hidden bg-cream text-stone-600"
      style={{ gridTemplateColumns: '224px 1fr', gridTemplateRows: '40px 1fr', gridTemplateAreas: '"header header" "nav main"' }}>
      {/* 品牌水印：垫在所有内容之下 */}
      <NaviWatermark />
      {/* 顶部 header：drag region，红绿灯左侧留 76px */}
      <DragRegion
        className="relative z-10 flex items-center pl-[76px] pr-4 border-b border-stone-300 bg-cream-50"
        style={{ gridArea: 'header' }}
      >
        <span className="font-brand text-base font-bold tracking-[-0.01em] text-stone-700 leading-none">Navi</span>
        <div className="ml-auto flex items-center gap-2.5 mono text-[11px] text-stone-400 tracking-[0.02em]">
          <NaviFace />
          <span className="opacity-50">|</span>
          <Clock />
        </div>
      </DragRegion>

      {/* 左 nav */}
      <nav className="relative z-10 border-r border-stone-300 bg-cream-50 flex flex-col min-h-0" style={{ gridArea: 'nav' }}>
        <DragRegion className="h-2 shrink-0" />
        <SideNavItems />
      </nav>

      {/* 右 main：整块纳入拖拽代理（文字区/交互元素自动豁免） */}
      <DragRegion className="relative z-10 flex flex-col overflow-hidden min-h-0" style={{ gridArea: 'main' }}>
        <Routes>
          <Route path="/" element={<Chat />} />
          <Route path="/timeline" element={<Timeline />} />
          <Route path="/diary" element={<Diary />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/wiki" element={<Wiki />} />
          <Route path="/personality" element={<Personality />} />
          <Route path="/skills" element={<Skills />} />
          <Route path="/relations" element={<Relations />} />
          <Route path="/brain" element={<Brain />} />
        </Routes>
      </DragRegion>

      {/* LLM 失败全局 toast */}
      <LlmErrorToaster />
    </div>
  )
}
