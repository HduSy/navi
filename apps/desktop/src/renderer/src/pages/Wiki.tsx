import { useAsync, Button, Empty, Label, Markdown, formatTime, NoDrag, useScrollRestore, ReadingBody } from '../components'
import { useState, useEffect } from 'react'
import type { WikiPage } from '../types'

/** 经验页只展示 experience 类型（其他类型在导航里有独立页面） */
const TYPE = 'experience'

/** 列表分页：首屏只渲染一批，接近底部/点按钮再加载更多。
 *  536 张卡片一次性渲染首屏要 ~180ms（空白感来源），分批后首屏 ~30ms。 */
const PAGE_SIZE = 60

export function Wiki() {
  const { data, loading, reload } = useAsync(() => window.navi.listWiki(TYPE), [TYPE])
  const listRef = useScrollRestore('navi:scroll:wiki:list')
  const detailRef = useScrollRestore('navi:scroll:wiki:detail')
  const [selected, setSelected] = useState<WikiPage | null>(null)
  const [detailText, setDetailText] = useState('')
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const [backlinks, setBacklinks] = useState<WikiPage[]>([])
  const [visible, setVisible] = useState(PAGE_SIZE)
  const pages = data ?? []
  const shown = pages.slice(0, visible)
  const hasMore = visible < pages.length

  function loadMore(): void {
    setVisible((v) => Math.min(pages.length, v + PAGE_SIZE))
  }

  // 滚动接近底部时自动加载下一批。
  // 切回 tab 恢复记忆位置时也会触发：恢复逻辑逐批撑高内容，直到记忆位置可达。
  useEffect(() => {
    const root = listRef.current
    if (!root || !hasMore) return
    const onScroll = (): void => {
      if (root.scrollHeight - root.scrollTop - root.clientHeight < 600) loadMore()
    }
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => root.removeEventListener('scroll', onScroll)
  }, [listRef, pages.length, hasMore])

  async function openPage(p: WikiPage): Promise<void> {
    const rel = p.path.replace(/^.*\/wiki\//, '')
    const [text, bls] = await Promise.all([
      window.navi.readWiki(rel),
      window.navi.getBacklinks(p.frontmatter.id)
    ])
    setSelected(p)
    setDetailText(text ?? '')
    setEditing(false)
    setBacklinks(bls)
  }

  function closeDetail(): void {
    setSelected(null)
    setEditing(false)
  }

  async function saveEdit(): Promise<void> {
    if (!selected) return
    const rel = selected.path.replace(/^.*\/wiki\//, '')
    await window.navi.writeWiki(rel, editText)
    setDetailText(editText)
    setEditing(false)
    reload()
  }

  return (
    <div className="h-full flex flex-col">
      {!selected ? (
        <>
          <div className="shrink-0 flex items-center gap-2.5 px-7 pt-3 pb-2 border-b border-stone-300">
            <span className="flex items-center gap-1.5 mono text-[11px] text-stone-400">
              <span>踩过的坑，Navi 都帮你记着</span>
              {pages.length > 0 && (
                <>
                  <span className="text-stone-500 font-bold select-none leading-none">•</span>
                  <span>共 {pages.length} 条经验</span>
                </>
              )}
            </span>
            <NoDrag className="ml-auto shrink-0">
              <Button variant="outlined" size="sm" onClick={() => window.navi.rebuildIndex().then(() => reload())}>
                重新整理
              </Button>
            </NoDrag>
          </div>
          <div ref={listRef} className="flex-1 overflow-auto px-7 py-5">
            {/* 数据未到时留白（不闪加载文案）；从未有过经验才显示空态 */}
            {!loading && pages.length === 0 ? (
              <Empty text="还没踩过什么坑，多干点活，Navi 会把经验记下来" />
            ) : (
              <>
                <div
                  className="grid gap-3 w-full"
                  style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
                >
                  {shown.map((p) => (
                    <CardItem key={p.path} page={p} onOpen={() => openPage(p)} />
                  ))}
                </div>
                {/* 底部：滚动接近时自动加载；也可手动点（总数已在顶部展示） */}
                {pages.length > 0 && hasMore && (
                  <div className="mt-5 mb-2 flex items-center justify-center">
                    <button
                      onClick={loadMore}
                      className="text-xs font-medium px-3 py-1.5 rounded-sm border border-stone-300 bg-cream-200 text-stone-500 hover:bg-cream-50 hover:text-stone-600 transition-colors"
                    >
                      加载更多（已显示 {visible} / {pages.length}）
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      ) : (
        <Detail
          page={selected}
          text={detailText}
          editing={editing}
          editText={editText}
          backlinks={backlinks}
          scrollRef={detailRef}
          onBack={closeDetail}
          onEdit={() => {
            setEditText(detailText)
            setEditing(true)
          }}
          onCancelEdit={() => setEditing(false)}
          onSave={saveEdit}
          onEditText={setEditText}
        />
      )}
    </div>
  )
}

function CardItem({ page, onOpen }: { page: WikiPage; onOpen: () => void }) {
  // 卡片描述只展示「教训」段（旧格式无分段时退化为整篇纯文本）
  const lesson = sectionOf(page.body, '教训')
  const preview = (lesson || stripMarkdown(page.body)).slice(0, 80)
  return (
    <button
      onClick={onOpen}
      className="text-left border border-stone-300 rounded p-3.5 flex flex-col h-full card-hover bg-cream-200"
    >
      <h3 className="mono text-sm font-medium text-stone-700 mb-1.5">{page.frontmatter.title}</h3>
      {preview && <p className="text-[12.5px] leading-[1.55] text-stone-500 line-clamp-3 mb-4 flex-1">{preview}</p>}
      <div className="mono text-[11px] text-stone-400 mt-auto text-right">更新于 {formatTime(page.frontmatter.updatedAt)}</div>
    </button>
  )
}

function Detail({
  page,
  text,
  editing,
  editText,
  backlinks,
  scrollRef,
  onBack,
  onEdit,
  onCancelEdit,
  onSave,
  onEditText
}: {
  page: WikiPage
  text: string
  editing: boolean
  editText: string
  backlinks: WikiPage[]
  scrollRef: React.RefObject<HTMLDivElement | null>
  onBack: () => void
  onEdit: () => void
  onCancelEdit: () => void
  onSave: () => void
  onEditText: (t: string) => void
}) {
  return (
    <>
      <div className="shrink-0 bg-cream-50 border-b border-stone-300 px-7 pt-3 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <NoDrag className="shrink-0">
            <Button variant="outlined" size="sm" onClick={onBack}>← 返回</Button>
          </NoDrag>
          <div className="min-w-0">
            <h3 className="mono text-base font-medium text-stone-700 truncate">{page.frontmatter.title}</h3>
          </div>
        </div>
        <NoDrag className="flex gap-2 shrink-0">
          {editing ? (
            <>
              <Button variant="outlined" size="sm" onClick={onCancelEdit}>取消</Button>
              <Button size="sm" onClick={onSave}>保存</Button>
            </>
          ) : (
            <Button variant="outlined" size="sm" onClick={onEdit}>编辑</Button>
          )}
        </NoDrag>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-auto px-9 py-7">
        <div className="max-w-3xl">
          {editing ? (
            <textarea
              value={editText}
              onChange={(e) => onEditText(e.target.value)}
              className="w-full min-h-[500px] bg-cream-200 border border-stone-300 rounded p-4 mono text-[13px] text-stone-600 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft transition-colors"
            />
          ) : (
            <>
              <p className="mono text-[11px] text-stone-400 mb-5">
                创建 {formatTime(page.frontmatter.createdAt)} · 更新 {formatTime(page.frontmatter.updatedAt)}
              </p>
              <ExperienceBody text={text} />
            </>
          )}

          {/* 元信息 */}
          {!editing && (
            <div className="mt-8 pt-8 border-t border-stone-300 space-y-3">
              {backlinks.length > 0 && (
                <section>
                  <Label>被这些记忆引用（{backlinks.length}）</Label>
                  <ul className="mt-3 space-y-1.5">
                    {backlinks.map((b) => (
                      <li key={b.path} className="border border-stone-300 rounded-sm p-3 bg-cream-200">
                        <p className="mono text-[13px] font-medium text-stone-700">{b.frontmatter.title}</p>
                        <p className="mono text-[11px] text-stone-400 mt-1">{formatTime(b.frontmatter.updatedAt)}</p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

/** 把 markdown 文本剥成纯文本预览 */
function stripMarkdown(md: string): string {
  return md
    .replace(/^---[\s\S]*?---\n?/, '') // 去 frontmatter
    .replace(/^#{1,4}\s+/gm, '') // 去标题标记
    .replace(/\[\[([^\]]+)\]\]/g, '$1') // wikilink 保留文字
    .replace(/\*\*([^*]+)\*\*/g, '$1') // 去加粗
    .replace(/`([^`]+)`/g, '$1') // 去行内代码
    .replace(/^[-*]\s+/gm, '') // 去列表标记
    .replace(/\n{2,}/g, '\n')
    .trim()
}

/** 取 markdown 正文中「## 标题」段的纯内容（到下一个 ## 为止），没有该段返回 '' */
function sectionOf(md: string, name: string): string {
  const lines = md.split('\n')
  let buf: string[] | null = null
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      if (buf !== null) break
      if (line.replace(/^##\s+/, '').trim() === name) buf = []
    } else if (buf !== null) {
      buf.push(line)
    }
  }
  return buf ? buf.join('\n').trim() : ''
}

/** 经验详情正文：按「背景 / 教训 / 来源」三段拆开，小节标题与正文沿用日记的
 *  阅读规范（13px semibold 标题着 accent 色 + ReadingBody）；旧格式退化整篇 markdown */
function ExperienceBody({ text }: { text: string }) {
  const bg = sectionOf(text, '背景')
  const lesson = sectionOf(text, '教训')
  const src = sectionOf(text, '来源')
  if (!bg && !lesson && !src) return <Markdown source={text} />
  const sections: Array<{ label: string; body: string }> = [
    { label: '背景', body: bg },
    { label: '教训', body: lesson },
    { label: '来源', body: src }
  ]
  return (
    <div>
      {sections
        .filter((s) => s.body)
        .map((s) => (
          <section key={s.label} className="mb-5">
            <div
              className="text-[13px] font-semibold mt-[22px] mb-2.5 tracking-[0.02em]"
              style={{ color: 'var(--accent)' }}
            >
              {s.label}
            </div>
            <ReadingBody body={s.body} />
          </section>
        ))}
    </div>
  )
}
