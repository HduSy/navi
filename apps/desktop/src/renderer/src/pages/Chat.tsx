import { useEffect, useState, useRef } from 'react'
import type { ChatMessageRow, SessionStats } from '../types'
import { Button, Label, formatClock, formatTime, basename, NoDrag, DragRegion } from '../components'
import { setChatPhase } from '../face-state'

interface DisplayMessage extends ChatMessageRow {
  pending?: boolean
}

// 切 tab 离开后回到 Chat 时，恢复上次的滚动位置
const SCROLL_KEY = 'navi:chat:scrollTop'

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

  // 首次渲染消息后：如果是切 tab 回来（sessionStorage 有位置），恢复位置；
  // 如果是首次进入（无位置），滚到底部。
  useEffect(() => {
    if (!scrollRef.current || messages.length === 0) return
    const saved = sessionStorage.getItem(SCROLL_KEY)
    if (saved !== null) {
      scrollRef.current.scrollTop = Number(saved)
    } else {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  // 离开页面时保存滚动位置
  useEffect(() => {
    return () => {
      if (scrollRef.current) sessionStorage.setItem(SCROLL_KEY, String(scrollRef.current.scrollTop))
    }
  }, [])

  async function send(): Promise<void> {
    if (!input.trim() || sending) return
    const text = input.trim()
    setInput('')
    // /clear：清空聊天上下文（DB 历史 + 界面），不经模型路由
    if (text === '/clear') {
      try {
        await window.navi.clearChat()
        sessionStorage.removeItem(SCROLL_KEY)
        setMessages([])
      } catch (e) {
        const ts = Date.now()
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${ts}`,
            role: 'navi',
            content: `清空失败：${e instanceof Error ? e.message : String(e)}`,
            routedBrain: 'dialogue',
            actionTaken: '',
            createdAt: ts
          }
        ])
      }
      return
    }
    setSending(true)
    setChatPhase('thinking')
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
      setChatPhase('idle')
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 flex min-h-0">
        <section className="flex-1 flex flex-col min-w-0 border-r border-stone-300">
          <div ref={scrollRef} className="flex-1 overflow-auto px-7 py-[22px] hide-scrollbar">
            {messages.length === 0 ? (
              <article className="max-w-[560px]">
                <Label>Navi</Label>
                <h3 className="mt-2.5 text-[24px] font-semibold tracking-[-0.02em] text-stone-700 mb-2.5">嗨，我在这听着。</h3>
                <p className="text-stone-600 leading-[1.65]">
                  我已经看到你 <span className="font-semibold text-stone-700">{stats?.totalSessions ?? '...'}</span> 次和 AI 一起干活了。
                  {stats && stats.totalSessions > 0
                    ? '问我「最近在忙啥」「踩过什么坑」，或者说「幽默点」调调我的脾气。'
                    : '先去「大脑」里让我有个能思考的脑子，我就能开口陪你聊。'}
                </p>
              </article>
            ) : (
              messages.map((m) => <MessageBubble key={m.id} msg={m} />)
            )}
          </div>
          <DragRegion className="shrink-0 border-t border-stone-300 px-7 py-3">
            <NoDrag className="flex gap-2 w-full">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void send()
                  }
                }}
                placeholder={sending ? 'Navi 思考中...' : '和 Navi 说点什么（/clear 清空上下文）'}
                disabled={sending}
                className="flex-1 min-w-0 bg-cream-200 border border-stone-300 rounded px-3 py-2 text-[13.5px] text-stone-700 placeholder-stone-400 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft transition-colors duration-150 disabled:opacity-50"
              />
              <Button onClick={send} disabled={sending || !input.trim()}>
                {sending ? '...' : '发送'}
              </Button>
            </NoDrag>
          </DragRegion>
        </section>

        <aside className="w-[280px] shrink-0 bg-cream-50 p-[18px] overflow-auto">
          {stats ? (
            <>
              <div className="grid grid-cols-2 gap-2 mb-5">
                <Stat label="干活次数" value={stats.totalSessions} />
                <Stat label="聊过" value={stats.totalMessages} />
                <Stat label="动手" value={stats.totalToolCalls} />
                <Stat label="摔跤" value={stats.totalErrors} />
              </div>
              <Label>最近在忙</Label>
              <div className="mt-2 space-y-1.5">
                {stats.recent
                  .filter((s) => s.userMessageCount > 0 || s.toolCallCount > 0)
                  .slice(0, 5)
                  .map((s) => (
                    <div
                      key={s.id}
                      className="border border-stone-300 rounded-sm px-2.5 py-2 bg-cream-200 card-hover"
                    >
                      <p className="mono text-xs text-stone-700 truncate">{basename(s.projectPath)}</p>
                      <p className="mono text-[11px] text-stone-400 mt-1">
                        {formatTime(s.startedAt)} · 问了 {s.userMessageCount} 句 · 动了 {s.toolCallCount} 次手
                      </p>
                    </div>
                  ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-stone-400">加载中...</p>
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
    <article
      className={
        'flex flex-col max-w-[72%] mb-4 ' +
        (isUser ? 'ml-auto items-end' : 'items-start')
      }
    >
      <div
        className={
          'relative px-[13px] py-2.5 rounded border text-[14px] leading-[1.6] break-words transition-colors duration-150 ' +
          (isAction
            ? 'bg-accent-soft border-accent-line text-stone-700'
            : isUser
              ? 'bg-cream-50 border-stone-300 text-stone-700 rounded-tr-sm'
              : 'bg-cream-200 border-stone-300 text-stone-700 rounded-tl-sm')
        }
      >
        {isAction && (
          <span className="absolute -top-[9px] right-3 mono text-[10px] tracking-[0.05em] px-[7px] py-[3px] rounded-sm bg-accent-soft border border-accent-line text-accent z-10">
            行动
          </span>
        )}
        <p className="whitespace-pre-wrap">{msg.content}</p>
        {msg.actionTaken && (
          <p className="text-xs mt-2 border-t border-stone-300 text-stone-400 pt-1.5">已执行：{msg.actionTaken}</p>
        )}
      </div>
      <div
        className={
          'flex items-center gap-1.5 mt-1.5 mono text-[11px] text-stone-400 ' +
          (isUser ? 'justify-end' : 'justify-start')
        }
      >
        {msg.pending && <span>发送中...</span>}
        {!msg.pending && <span>{formatClock(msg.createdAt)}</span>}
      </div>
    </article>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-stone-300 rounded-sm px-3 py-2.5 bg-cream-200">
      <div className="mono text-[11px] tracking-[0.04em] text-stone-400">{label}</div>
      <div className="text-[24px] font-semibold text-stone-700 mt-0.5 tabular-nums">{value.toLocaleString()}</div>
    </div>
  )
}
