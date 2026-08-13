import { Routes, Route, NavLink, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
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
      { to: '/wiki', label: '记忆', tip: 'LLM 维护的 markdown 知识图谱 · 可读可编辑', Icon: IconWiki, accent: 'wiki' },
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
    const id = setInterval(() => setNow(formatClock(Date.now())), 30000)
    return () => clearInterval(id)
  }, [])
  return <span>{now}</span>
}

/** Navi 颜文字表情：默认就绪，偶尔眨眼/张望，给 header 一点生命感 */
const FACES = {
  ready: { face: '(・ω・)', label: '在听' },
  blink: { face: '(・▽・)', label: '在听' },
  look:  { face: '(´・ω・)', label: '张望' },
  idle:  { face: '(´-ω-)', label: '发呆' }
} as const

type FaceKey = keyof typeof FACES

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

function NaviFace(): React.ReactElement {
  const [key, setKey] = useState<FaceKey>('ready')
  useEffect(() => {
    const id = setInterval(() => {
      const r = Math.random()
      // 大部分时间就绪，偶尔眨眼/张望/发呆
      if (r < 0.5) setKey('ready')
      else if (r < 0.75) setKey('blink')
      else if (r < 0.92) setKey('look')
      else setKey('idle')
    }, 4000)
    return () => clearInterval(id)
  }, [])
  const { face, label } = FACES[key]
  return (
    <span
      className="flex items-center gap-1 text-[12px] text-stone-500 leading-none select-none"
      style={{ fontFamily: '"PingFang SC", -apple-system, system-ui, sans-serif' }}
      title={`Navi ${label}…`}
    >
      <span className="text-[13px] tabular-nums">{face}</span>
      <span className="inline-flex items-baseline">
        {label}
        <Dots />
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
