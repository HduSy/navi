/**
 * Navi 表情状态微 store —— 跨组件通信用。
 *
 * Chat 页在发送消息时上报 thinking，回复完成回到 idle；
 * App header 的 NaviFace 订阅后实时反映「思考中」状态。
 */

export type ChatPhase = 'idle' | 'thinking'

let chatPhase: ChatPhase = 'idle'
const listeners = new Set<(p: ChatPhase) => void>()

export function setChatPhase(p: ChatPhase): void {
  if (p === chatPhase) return
  chatPhase = p
  listeners.forEach((fn) => fn(p))
}

export function getChatPhase(): ChatPhase {
  return chatPhase
}

/** 返回取消订阅函数 */
export function subscribeChatPhase(fn: (p: ChatPhase) => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
