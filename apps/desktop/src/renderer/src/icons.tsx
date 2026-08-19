/** 内联 SVG icon —— lucide 风格，15x15 stroke-2 currentColor。
 *  与冷调工具型视觉系统配套：线条几何、克制、统一。 */

type IconProps = { className?: string }

const base = (className?: string) => ({
  width: 15,
  height: 15,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className
})

export function IconChat({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

export function IconTimeline({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
    </svg>
  )
}

export function IconDiary({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M12 7v14" />
      <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
    </svg>
  )
}

export function IconProjects({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2z" />
    </svg>
  )
}

export function IconWiki({ className }: IconProps) {
  // lucide lightbulb：经验/教训的「顿悟」隐喻（经验页用）
  return (
    <svg {...base(className)}>
      <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
      <path d="M9 18h6" />
      <path d="M10 22h4" />
    </svg>
  )
}

export function IconPersonality({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <circle cx="18" cy="15" r="3" />
      <circle cx="9" cy="7" r="4" />
      <path d="M10 15a6 6 0 0 0-6.5 4" />
      <path d="m20.2 13.8.5-.5m-5.4 3.9-.5.5m5.9-.5-.5.5m-5.4-3.9-.5.5m5.4 3.4h0m-2.9-2.9h0" />
    </svg>
  )
}

export function IconSkills({ className }: IconProps) {
  // lucide puzzle：可插拔扩展能力的「拼图」隐喻（技能页用）
  return (
    <svg {...base(className)}>
      <path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 1 0 3.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0 1 12 1.998c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z" />
      <path d="M12 12v.01" />
    </svg>
  )
}

export function IconRelations({ className }: IconProps) {
  return (
    <svg {...base(className)}>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  )
}

export function IconMemory({ className }: IconProps) {
  // 单页纸 + 羽毛笔：随手记下的一页（记忆页用）
  return (
    <svg {...base(className)}>
      {/* 页面 + 折角 */}
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      {/* 羽毛笔：斜插右下，笔尖探出页外 */}
      <path d="M21.1 17.1a3 3 0 0 0-4.2-4.2l-3.4 3.4v4.2h4.2z" />
      <path d="m19 15-7 7" />
      <path d="M19.8 18.5h-4.2" />
    </svg>
  )
}

export function IconBrain({ className }: IconProps) {
  // lucide brain：两半球 + 沟回
  return (
    <svg {...base(className)}>
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
      <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
      <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
      <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
      <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
      <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
      <path d="M6 18a4 4 0 0 1-1.967-.516" />
      <path d="M19.967 17.484A4 4 0 0 1 18 18" />
    </svg>
  )
}
