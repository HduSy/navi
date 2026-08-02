import { useEffect, useState, useRef } from 'react'
import type { ChatMessageRow, SessionStats } from '../types'
import { PageHeader, Button, Label, formatTime, basename } from '../components'

interface DisplayMessage extends ChatMessageRow {
  pending?: boolean
}

export function Chat() {
  const [stats, setStats] = useState<SessionStats | null>(null)
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  async function refresh(): Promise<void> {
    const [s, msgs] = await Promise.all([window.navi.getSessionStats(), window.navi.getRecentMessages()])
    setStats(s)
    setMessages(msgs)
  }

  useEffect(() => {
    void refresh()
  }, [])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  async function send(): Promise<void> {
    if (!input.trim() || sending) return
    const text = input.trim()
    setInput('')
    setSending(true)
    const now = Date.now()
    const tempId = `pending-${now}`
    setMessages((prev) => [
      ...prev,
      {
        id: tempId,
        role: 'user',
        content: text,
        routedBrain: 'dialogue',
        actionTaken: '',
        createdAt: now,
        pending: true
      }
    ])
    try {
      const res = await window.navi.sendMessage(text)
      const ts = Date.now()
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== tempId),
        {
          id: `user-${ts}`,
          role: 'user',
          content: text,
          routedBrain: res.routedBrain,
          actionTaken: res.actionTaken ?? '',
          createdAt: ts
        },
        {
          id: `navi-${ts + 1}`,
          role: 'navi',
          content: res.reply,
          routedBrain: res.routedBrain,
          actionTaken: res.actionTaken ?? '',
          createdAt: ts
        }
      ])
    } catch (e) {
      const ts = Date.now()
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== tempId),
        {
          id: `err-${ts}`,
          role: 'navi',
          content: `出错：${e instanceof Error ? e.message : String(e)}`,
          routedBrain: 'dialogue',
          actionTaken: '',
          createdAt: ts
        }
      ])
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="h-full flex flex-col">
      <PageHeader title="对话" subtitle="和 Navi 聊聊，或让它调整自己的脾气" />
      <div className="flex-1 flex overflow-hidden">
        <section className="flex-1 flex flex-col">
          <div ref={scrollRef} className="flex-1 overflow-auto px-12 py-12 space-y-8">
            {messages.length === 0 ? (
              <article className="max-w-2xl">
                <Label>Navi</Label>
                <div className="mt-3 border-2 border-black p-6">
                  <p className="text-lg leading-relaxed">
                    嗨，我是 Navi。我已经看到你{' '}
                    <span className="font-black">{stats?.totalSessions ?? '...'}</span>{' '}
                    次和 AI 一起干活了。
                    {stats && stats.totalSessions > 0
                      ? '问我"最近在忙啥""踩过什么坑"，或者说"幽默点"调调我的脾气。'
                      : '先去「大脑」里让我有个能思考的脑子，我就能开口陪你聊。'}
                  </p>
                </div>
              </article>
            ) : (
              messages.map((m) => <MessageBubble key={m.id} msg={m} />)
            )}
          </div>
          <div className="border-t border-black px-12 py-6">
            <div className="flex gap-4 w-full">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void send()
                  }
                }}
                placeholder={sending ? 'Navi 思考中...' : '和 Navi 说点什么（回车发送）'}
                disabled={sending}
                className="flex-1 min-w-0 px-6 py-4 border-2 border-black bg-white text-black font-bold focus:outline-none focus:bg-gray-100 transition-none disabled:opacity-50"
              />
              <Button onClick={send} disabled={sending || !input.trim()}>
                {sending ? '...' : '发送'}
              </Button>
            </div>
          </div>
        </section>

        <aside className="w-80 border-l border-black p-8 overflow-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <Label>采集状态</Label>
              <h3 className="text-lg font-black mt-1">Navi 看到了</h3>
            </div>
            <Button variant="outlined" onClick={refresh}>
              刷新
            </Button>
          </div>
          {stats ? (
            <>
              <div className="grid grid-cols-2 gap-3 mb-8">
                <Stat label="干活次数" value={stats.totalSessions} />
                <Stat label="聊过" value={stats.totalMessages} />
                <Stat label="动手" value={stats.totalToolCalls} />
                <Stat label="摔跤" value={stats.totalErrors} />
              </div>
              <Label>最近在忙</Label>
              <div className="space-y-3 mt-3">
                {stats.recent
                  .filter((s) => s.userMessageCount > 0 || s.toolCallCount > 0)
                  .slice(0, 5)
                  .map((s) => (
                    <div key={s.id} className="border-2 border-black p-3 hover:bg-black hover:text-white transition-none">
                      <p className="font-bold text-sm truncate">{basename(s.projectPath)}</p>
                      <p className="text-xs opacity-50 mt-1">{formatTime(s.startedAt)}</p>
                      <p className="text-xs mt-1">
                        问了 {s.userMessageCount} 句 · 动了 {s.toolCallCount} 次手
                      </p>
                    </div>
                  ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-500">加载中...</p>
          )}
        </aside>
      </div>
    </div>
  )
}

function MessageBubble({ msg }: { msg: DisplayMessage }) {
  const isUser = msg.role === 'user'
  const isAction = msg.routedBrain === 'action'
  return (
    <article className={`max-w-2xl ${isUser ? 'ml-auto' : ''}`}>
      <div className="flex items-center gap-3">
        <Label>{isUser ? '你' : 'Navi'}</Label>
        {isAction && (
          <span className="text-xs font-bold border border-accent text-accent px-2 py-0.5">行动</span>
        )}
        {msg.pending && <span className="text-xs opacity-50">发送中...</span>}
      </div>
      <div
        className={`mt-2 border-2 p-4 ${
          isAction ? 'border-accent' : 'border-black'
        } ${isUser ? '' : 'hover:bg-black hover:text-white transition-none'}`}
      >
        <p className="leading-relaxed whitespace-pre-wrap">{msg.content}</p>
        {msg.actionTaken && (
          <p className="text-xs mt-3 border-t border-current opacity-60 pt-2">已执行：{msg.actionTaken}</p>
        )}
      </div>
      {!msg.pending && <p className="text-xs opacity-40 mt-1">{formatTime(msg.createdAt)}</p>}
    </article>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-2 border-black p-3">
      <p className="text-xs uppercase tracking-widest opacity-50">{label}</p>
      <p className="text-2xl font-black mt-1">{value}</p>
    </div>
  )
}
