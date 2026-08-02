import { useAsync, PageHeader, Button, Empty, Label, Markdown, Tabs, formatTime, basename, NoDrag } from '../components'
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
      <PageHeader
        title="记忆"
        subtitle="Navi 脑子里记下的所有事，你也能看能改"
        action={
          <NoDrag>
            <Button variant="outlined" onClick={() => window.navi.rebuildIndex().then(() => reload())}>
              重新整理
            </Button>
          </NoDrag>
        }
      />

      {!selected ? (
        <>
          <Tabs
            tabs={TYPES.map((t) => ({ id: t.id, label: t.label }))}
            active={type}
            onChange={(id) => setType(id)}
          />
          <div className="flex-1 overflow-auto px-12 py-10">
            {loading ? (
              <p className="text-gray-500">加载中...</p>
            ) : pages.length === 0 ? (
              <Empty text="这一格还空着，Navi 多看看你干活就会填上" />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 max-w-6xl">
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
      className="text-left border-2 border-black p-5 transition-none hover:bg-black hover:text-white flex flex-col h-full"
    >
      <h3 className="font-black text-lg leading-tight mb-2">{page.frontmatter.title}</h3>
      {preview && <p className="text-sm leading-relaxed opacity-70 line-clamp-3 mb-4 flex-1">{preview}</p>}
      <div className="space-y-2 text-xs opacity-60 mt-auto">
        <div className="flex items-center gap-2">
          <span>更新于 {formatTime(page.frontmatter.updatedAt)}</span>
        </div>
        {sources.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            <span>来自</span>
            {sources.slice(0, 2).map((s, i) => (
              <span key={i} className="border border-current px-1 py-0.5 font-mono">
                {basename(s).slice(0, 8)}
              </span>
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
  const sources = page.frontmatter.sourceSessions ?? []
  return (
    <>
      <div className="border-b-2 border-black px-12 py-5 flex items-center justify-between">
        <div className="flex items-center gap-6 min-w-0">
          <button
            onClick={onBack}
            className="font-bold text-sm border-2 border-black px-4 py-2 bg-white text-black hover:bg-black hover:text-white transition-none shrink-0"
          >
            ← 返回
          </button>
          <div className="min-w-0">
            <h3 className="text-xl font-black truncate">{page.frontmatter.title}</h3>
            <p className="text-xs opacity-50 mt-1">
              创建 {formatTime(page.frontmatter.createdAt)} · 更新 {formatTime(page.frontmatter.updatedAt)}
            </p>
          </div>
        </div>
        <NoDrag className="flex gap-2 shrink-0">
          {editing ? (
            <>
              <Button variant="outlined" onClick={onCancelEdit}>取消</Button>
              <Button onClick={onSave}>保存</Button>
            </>
          ) : (
            <Button variant="outlined" onClick={onEdit}>编辑</Button>
          )}
        </NoDrag>
      </div>
      <div className="flex-1 overflow-auto px-12 py-10">
        <div className="max-w-3xl">
          {editing ? (
            <textarea
              value={editText}
              onChange={(e) => onEditText(e.target.value)}
              className="w-full min-h-[500px] border-2 border-black p-4 font-mono text-sm focus:outline-none focus:bg-gray-100"
            />
          ) : (
            <Markdown source={text} />
          )}

          {/* 元信息 */}
          {!editing && (
            <div className="mt-12 pt-8 border-t-2 border-black space-y-6">
              {sources.length > 0 && (
                <section>
                  <Label>出自哪些时刻</Label>
                  <ul className="mt-3 space-y-1 text-sm">
                    {sources.map((s, i) => (
                      <li key={i} className="font-mono text-xs opacity-70 break-all">{basename(s)}</li>
                    ))}
                  </ul>
                </section>
              )}
              {backlinks.length > 0 && (
                <section>
                  <Label>被这些记忆引用（{backlinks.length}）</Label>
                  <ul className="mt-3 space-y-2">
                    {backlinks.map((b) => (
                      <li key={b.path} className="border border-black p-3 text-sm">
                        <p className="font-bold">{b.frontmatter.title}</p>
                        <p className="text-xs opacity-50 mt-1">{formatTime(b.frontmatter.updatedAt)}</p>
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
