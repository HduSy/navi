import { Routes, Route, NavLink } from 'react-router-dom'
import { Chat } from './pages/Chat'
import { Timeline } from './pages/Timeline'
import { Diary } from './pages/Diary'
import { Projects } from './pages/Projects'
import { Wiki } from './pages/Wiki'
import { Personality } from './pages/Personality'
import { Skills } from './pages/Skills'
import { Relations } from './pages/Relations'
import { Brain } from './pages/Brain'
import { DragRegion, NoDrag } from './components'

const navItems = [
  { to: '/', label: '对话', glyph: '01' },
  { to: '/timeline', label: '时间线', glyph: '02' },
  { to: '/diary', label: '日记', glyph: '03' },
  { to: '/projects', label: '项目', glyph: '04' },
  { to: '/wiki', label: '记忆', glyph: '05' },
  { to: '/personality', label: '人格', glyph: '06' },
  { to: '/skills', label: '技能', glyph: '07' },
  { to: '/relations', label: '关系', glyph: '08' },
  { to: '/brain', label: '大脑', glyph: '09' }
]

export function App() {
  return (
    <div className="flex h-screen w-screen bg-white text-black">
      <nav className="w-56 shrink-0 border-r border-black flex flex-col">
        <DragRegion className="px-8 py-8 flex items-baseline gap-3">
          <h1 className="text-3xl font-black tracking-tight leading-none">Navi</h1>
          <span className="text-xs uppercase tracking-widest text-gray-500">你的工作伙伴</span>
        </DragRegion>
        <NoDrag className="flex-1 overflow-auto py-4">
          <ul>
            {navItems.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    `flex items-center gap-4 px-8 py-3 font-bold transition-none ${
                      isActive ? 'bg-black text-white' : 'text-black hover:bg-black hover:text-white'
                    }`
                  }
                >
                  <span className="text-xs font-mono opacity-50">{item.glyph}</span>
                  <span>{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </NoDrag>
        <DragRegion className="px-8 py-6">
          <p className="text-xs uppercase tracking-widest text-gray-500">正在陪你</p>
          <p className="text-sm font-bold mt-2">看着你干活</p>
        </DragRegion>
      </nav>
      <main className="flex-1 overflow-hidden">
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
