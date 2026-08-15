import { Routes, Route, NavLink, useLocation } from 'react-router-dom'
import { useEffect, useState, useRef } from 'react'
import { Chat } from './pages/Chat'
import { Timeline } from './pages/Timeline'
import { Diary } from './pages/Diary'
import { Projects } from './pages/Projects'
import { Wiki } from './pages/Wiki'
import { Personality } from './pages/Personality'
import { Skills } from './pages/Skills'
import { Relations } from './pages/Relations'
import { Brain } from './pages/Brain'
import { DragRegion, NoDrag, setAccent, formatClock } from './components'
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
    label: '系统',
    items: [
      { to: '/brain', label: '大脑', tip: '始终读你的 Claude 配置 · 换号用 cc-switch 改 settings.json 后重启', Icon: IconBrain, accent: 'brain' }
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

export function App() {
  const accent = useAccentFromRoute()

  // 切路由时同步 accent CSS 变量
  useEffect(() => {
    setAccent(accent)
  }, [accent])

  return (
    <div className="grid h-screen w-screen overflow-hidden bg-cream text-stone-600"
      style={{ gridTemplateColumns: '224px 1fr', gridTemplateRows: '40px 1fr', gridTemplateAreas: '"header header" "nav main"' }}>
      {/* 顶部 header：drag region，红绿灯左侧留 76px */}
      <DragRegion
        className="flex items-center pl-[76px] pr-4 border-b border-stone-300 bg-cream-50"
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
      <nav className="border-r border-stone-300 bg-cream-50 flex flex-col min-h-0" style={{ gridArea: 'nav' }}>
        <DragRegion className="h-2 shrink-0" />
        <NoDrag className="flex-1 overflow-auto px-2 py-2.5">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label}>
              <div className="mono text-[11px] tracking-[0.06em] text-stone-400 px-2 pt-2.5 pb-1.5">{section.label}</div>
              <ul className="space-y-0">
                {section.items.map((item) => (
                  <li key={item.to} className="group relative">
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
                    {/* hover tooltip：nav 项右侧浮出，类似图片 alt 交互 */}
                    <span
                      role="tooltip"
                      className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 z-50 max-w-[220px] px-2.5 py-1.5 rounded-sm border border-stone-300 bg-cream-200 text-stone-600 text-[11px] leading-[1.5] whitespace-normal opacity-0 group-hover:opacity-100 transition-opacity duration-150 shadow-[0_4px_12px_rgba(0,0,0,0.08)]"
                    >
                      {item.tip}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </NoDrag>
      </nav>

      {/* 右 main */}
      <main className="flex flex-col overflow-hidden min-h-0" style={{ gridArea: 'main' }}>
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
      </main>
    </div>
  )
}
