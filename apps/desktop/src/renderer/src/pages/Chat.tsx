import { useEffect, useState, useRef } from 'react'
import type { ChatMessageRow, SessionStats } from '../types'
import { Button, Label, formatClock, formatTime, basename, NoDrag, DragRegion, useScrollRestore } from '../components'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { setChatPhase } from '../face-state'

type DisplayMessage = ChatMessageRow

// 切 tab 离开后回到 Chat 时，恢复上次的滚动位置（/clear 时清除）
const SCROLL_KEY = 'navi:scroll:chat'

// 空状态（首次进入 / /clear 后）的开场气泡建议
const SUGGESTIONS = ['最近在忙啥？', '踩过什么坑？', '幽默点', '今天适合摸鱼吗？']

export function Chat() {
  const [stats, setStats] = useState<SessionStats | null>(null)
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [stopping, setStopping] = useState(false)
  // 当前这轮发送的流式文本（接收侧思考/输出状态），reqId 归属
  const [streamText, setStreamText] = useState('')
  const reqIdRef = useRef('')
  // ready 等消息加载完再贴底：避免首次进入时空内容先贴底、消息到达后不再跟随
  const scrollRef = useScrollRestore(SCROLL_KEY, 'bottom', messages.length > 0)

  // 流式增量：订阅主进程推送，仅接受当前这轮发送的增量
  useEffect(() => {
    return window.navi.onChatDelta((p) => {
      if (p.reqId !== reqIdRef.current) return
      setStreamText((prev) => prev + p.delta)
    })
  }, [])

  async function refresh(): Promise<void> {
    const [s, msgs] = await Promise.all([window.navi.getSessionStats(), window.navi.getRecentMessages()])
    setStats(s)
    setMessages(msgs)
  }

  useEffect(() => {
    void refresh()
  }, [])

  // 切 tab 期间有消息在途（Rust 侧仍在跑 LLM）：恢复等待态并轮询，
  // 完成后从库里拉回完整对话（用户消息在 LLM 前已落库，不会丢）
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null
    void window.navi.isChatBusy().then((busy) => {
      if (!busy) return
      setSending(true)
      setChatPhase('thinking')
      timer = setInterval(() => {
        void window.navi.isChatBusy().then((stillBusy) => {
          if (!stillBusy) {
            if (timer) clearInterval(timer)
            timer = null
            void refresh().then(() => {
              setSending(false)
              setChatPhase('idle')
            })
          }
        })
      }, 1500)
    })
    return () => {
      if (timer) clearInterval(timer)
    }
  }, [])

  // 发送/接收期间始终贴底：发消息即滚到底，流式与收尾持续跟随最新内容
  // （仅本轮对话内强制；平时浏览历史不受影响）
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !sending) return
    el.scrollTop = el.scrollHeight
  }, [messages, streamText, sending])

  // preset：气泡建议直接传入发送（绕过 input state，同步可用）
  async function send(preset?: string): Promise<void> {
    const raw = typeof preset === 'string' ? preset : input
    if (!raw.trim() || sending) return
    const text = raw.trim()
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
    setStreamText('')
    const reqId = `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`
    reqIdRef.current = reqId
    const now = Date.now()
    const tempId = `pending-${now}`
    // 乐观插入用户消息：发送本身是瞬时的，直接以已发送形态展示
    setMessages((prev) => [
      ...prev,
      {
        id: tempId,
        role: 'user',
        content: text,
        routedBrain: 'dialogue',
        actionTaken: '',
        createdAt: now
      }
    ])
    try {
      const res = await window.navi.sendMessage(text, reqId)
      const ts = Date.now()
      setStreamText('')
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
      setStreamText('')
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
      setStopping(false)
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
                    : '先去「脑子」里让我有个能思考的脑子，我就能开口陪你聊。'}
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => void send(s)}
                      disabled={sending}
                      className="rounded-full border border-stone-300 bg-cream-200 px-3.5 py-1.5 text-[13px] text-stone-600 hover:bg-cream-50 hover:border-accent hover:text-stone-700 transition-colors disabled:opacity-50 disabled:cursor-default"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </article>
            ) : (
              <>
                {messages.map((m) => (
                  <MessageBubble key={m.id} msg={m} />
                ))}
                {sending && <ThinkingBubble text={streamText} />}
              </>
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
              {sending ? (
                <Button
                  onClick={() => {
                    if (stopping) return
                    setStopping(true)
                    void window.navi.stopChat()
                  }}
                  disabled={stopping}
                  title="停止生成"
                  className="w-[88px]"
                >
                  {stopping ? '停止中…' : '■ 停止'}
                </Button>
              ) : (
                <Button onClick={() => void send()} disabled={!input.trim()} className="w-[88px]">
                  发送
                </Button>
              )}
            </NoDrag>
          </DragRegion>
        </section>

        {/* 面板不带背景：透出底层品牌水印（与页面级容器同规则） */}
        <aside className="w-[280px] shrink-0 p-[18px] overflow-auto">
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
        {isUser ? (
          <p className="whitespace-pre-wrap">{msg.content}</p>
        ) : (
          <ChatMarkdown text={msg.content} />
        )}
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
        <span>{formatClock(msg.createdAt)}</span>
      </div>
    </article>
  )
}

/** 聊天气泡 markdown 渲染：LLM 输出直接映射为 React 元素（不经 innerHTML，天然防注入）。
 *  样式对齐应用 cream/stone 色系；流式期间每帧重解析对 micromark 无压力 */
function ChatMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
        pre: ({ children }) => (
          <pre className="mono text-[12.5px] leading-[1.5] bg-cream-50 border border-stone-200 rounded-sm px-2.5 py-2 my-1.5 overflow-x-auto">
            {children}
          </pre>
        ),
        code: ({ className, children }) => {
          const isBlock = (className ?? '').includes('language-') || String(children).includes('\n')
          return isBlock ? (
            <code className="mono">{children}</code>
          ) : (
            <code className="mono text-[12.5px] bg-cream-50 border border-stone-200 rounded-sm px-1 py-[1px]">{children}</code>
          )
        },
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">
            {children}
          </a>
        ),
        ul: ({ children }) => <ul className="list-disc pl-5 my-1.5 space-y-0.5">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-5 my-1.5 space-y-0.5">{children}</ol>,
        h1: ({ children }) => <h3 className="text-[15px] font-semibold mt-2.5 mb-1">{children}</h3>,
        h2: ({ children }) => <h3 className="text-[15px] font-semibold mt-2.5 mb-1">{children}</h3>,
        h3: ({ children }) => <h4 className="text-[14px] font-semibold mt-2 mb-1">{children}</h4>,
        h4: ({ children }) => <h4 className="text-[14px] font-semibold mt-2 mb-1">{children}</h4>,
        blockquote: ({ children }) => <blockquote className="border-l-2 border-stone-300 pl-3 my-1.5 text-stone-500">{children}</blockquote>,
        table: ({ children }) => (
          <table className="my-1.5 border-collapse text-[13px]">{children}</table>
        ),
        th: ({ children }) => <th className="border border-stone-300 bg-cream-50 px-2 py-1 text-left">{children}</th>,
        td: ({ children }) => <td className="border border-stone-300 px-2 py-1">{children}</td>,
      }}
    >
      {text}
    </ReactMarkdown>
  )
}

/** 等待/流式中的 Navi 侧气泡：首个增量前弹跳点（思考中），之后流式文本 + 光标 */
function ThinkingBubble({ text }: { text: string }) {
  return (
    <article className="flex flex-col max-w-[72%] mb-4 items-start">
      <div className="px-[13px] py-2.5 rounded border text-[14px] leading-[1.6] break-words bg-cream-200 border-stone-300 text-stone-700 rounded-tl-sm">
        {text ? (
          <ChatMarkdown text={`${text}▍`} />
        ) : (
          <span className="inline-flex items-center gap-1 py-[3px]" aria-label="Navi 正在思考">
            {[0, 150, 300].map((d) => (
              <span
                key={d}
                className="w-[6px] h-[6px] rounded-full bg-stone-400 animate-bounce"
                style={{ animationDelay: `${d}ms` }}
              />
            ))}
          </span>
        )}
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
