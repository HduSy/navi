import { useAsync, Button, Empty, Label, Markdown, Tag, formatTime, basename, NoDrag } from '../components'
import { useState } from 'react'
import type { WikiPage } from '../types'

/** 经验页只展示 experience 类型（其他类型在导航里有独立页面） */
const TYPE = 'experience'

export function Wiki() {
  const { data, loading, reload } = useAsync(() => window.navi.listWiki(TYPE), [TYPE])
  const [selected, setSelected] = useState<WikiPage | null>(null)
  const [detailText, setDetailText] = useState('')
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const [backlinks, setBacklinks] = useState<WikiPage[]>([])
  const pages = data ?? []

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
          <div className="shrink-0 flex items-center gap-3 px-7 pt-3 pb-2 border-b border-stone-300">
            <span className="mono text-[11px] text-stone-400">踩过的坑，Navi 都帮你记着</span>
            <NoDrag className="ml-auto shrink-0">
              <Button variant="outlined" size="sm" onClick={() => window.navi.rebuildIndex().then(() => reload())}>
                重新整理
              </Button>
            </NoDrag>
          </div>
          <div className="flex-1 overflow-auto px-7 py-5">
            {loading ? (
              <p className="text-stone-400">加载中...</p>
            ) : pages.length === 0 ? (
              <Empty text="还没踩过什么坑，多干点活，Navi 会把经验记下来" />
            ) : (
              <div
                className="grid gap-3 w-full"
                style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
              >
                {pages.map((p) => (
                  <CardItem key={p.path} page={p} onOpen={() => openPage(p)} />
                ))}
              </div>
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
  const sources = page.frontmatter.sourceSessions ?? []
  const refs = page.frontmatter.refs ?? []
  return (
    <button
      onClick={onOpen}
      className="text-left border border-stone-300 rounded p-3.5 flex flex-col h-full card-hover bg-cream-200"
    >
      <h3 className="mono text-sm font-medium text-stone-700 mb-1.5">{page.frontmatter.title}</h3>
      {preview && <p className="text-[12.5px] leading-[1.55] text-stone-500 line-clamp-3 mb-4 flex-1">{preview}</p>}
      <div className="mono text-[11px] text-stone-400 mt-auto">
        <div className="flex items-center gap-1.5 flex-wrap">
          {sources.length > 0 && (
            <>
              <span>来自</span>
              {sources.slice(0, 2).map((s, i) => (
                <Tag key={i}>{basename(s).slice(0, 8)}</Tag>
              ))}
              {sources.length > 2 && <span>等 {sources.length} 个</span>}
            </>
          )}
          {refs.length > 0 && <span>{sources.length > 0 ? '·' : ''} 关联 {refs.length} 处</span>}
        </div>
        <div className="text-right mt-1">更新于 {formatTime(page.frontmatter.updatedAt)}</div>
      </div>
    </button>
  )
}

function Detail({
  page,
  text,
  editing,
  editText,
  backlinks,
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
      <div className="flex-1 overflow-auto px-9 py-7">
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

/** 经验详情正文：按「背景 / 教训 / 来源」三段拆开渲染；旧格式（无分段）退化为整篇 markdown */
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
    <div className="space-y-7">
      {sections
        .filter((s) => s.body)
        .map((s) => (
          <section key={s.label}>
            <Label>{s.label}</Label>
            <div className="mt-2.5">
              <Markdown source={s.body} />
            </div>
          </section>
        ))}
    </div>
  )
}
