import { useAsync, Button, Empty, Label, Markdown, Tabs, Tag, formatTime, basename, NoDrag } from '../components'
import { useState } from 'react'
import type { WikiPage } from '../types'

const TYPES: Array<{ id: string; label: string }> = [
  { id: 'experience', label: '经验' },
  { id: 'project', label: '项目' },
  { id: 'person', label: '人物' },
  { id: 'timeline', label: '时间线' },
  { id: 'diary', label: '日记' },
  { id: 'habit', label: '习惯' },
  { id: 'personality', label: '人格' },
  { id: 'skill', label: '技能' }
]

export function Wiki() {
  const [type, setType] = useState('experience')
  const { data, loading, reload } = useAsync(() => window.navi.listWiki(type), [type])
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
          <div className="shrink-0 flex items-center gap-3 px-7 pt-4 pb-2">
            <div className="flex-1 overflow-x-auto hide-scrollbar min-w-0">
              <Tabs
                tabs={TYPES.map((t) => ({ id: t.id, label: t.label }))}
                active={type}
                onChange={(id) => setType(id)}
              />
            </div>
            <NoDrag className="shrink-0">
              <Button variant="outlined" size="sm" onClick={() => window.navi.rebuildIndex().then(() => reload())}>
                重新整理
              </Button>
            </NoDrag>
          </div>
          <div className="flex-1 overflow-auto px-7 py-5">
            {loading ? (
              <p className="text-stone-400">加载中...</p>
            ) : pages.length === 0 ? (
              <Empty text="这一格还空着，Navi 多看看你干活就会填上" />
            ) : (
              <div
                className="grid gap-3 max-w-6xl"
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
  const preview = stripMarkdown(page.body).slice(0, 80)
  const sources = page.frontmatter.sourceSessions ?? []
  const refs = page.frontmatter.refs ?? []
  return (
    <button
      onClick={onOpen}
      className="text-left border border-stone-300 rounded p-3.5 flex flex-col h-full card-hover bg-cream-200"
    >
      <h3 className="mono text-sm font-medium text-stone-700 mb-1.5">{page.frontmatter.title}</h3>
      {preview && <p className="text-[12.5px] leading-[1.55] text-stone-500 line-clamp-3 mb-4 flex-1">{preview}</p>}
      <div className="space-y-1.5 mono text-[11px] text-stone-400 mt-auto">
        <div>更新于 {formatTime(page.frontmatter.updatedAt)}</div>
        {sources.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            <span>来自</span>
            {sources.slice(0, 2).map((s, i) => (
              <Tag key={i}>{basename(s).slice(0, 8)}</Tag>
            ))}
            {sources.length > 2 && <span>等 {sources.length} 个</span>}
          </div>
        )}
        {refs.length > 0 && <div>关联 {refs.length} 处</div>}
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
      <div className="shrink-0 bg-cream-50 border-b border-stone-300 px-7 py-3 flex items-center justify-between">
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
              <Markdown source={text} />
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
