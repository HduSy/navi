/** 判断字符串是否像 uuid/随机串（非人命名），用于过滤无效项目名 */
export function looksLikeUUID(name: string): boolean {
  // 标准 uuid
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name)) return true
  // 32 位以上纯 hex
  if (/^[0-9a-f]{32,}$/i.test(name)) return true
  // 长度 >= 24 的纯字母数字+连字符，且元音少于 2 个连续（随机串特征）
  if (name.length >= 24 && /^[a-z0-9-]+$/i.test(name) && !/[aeiou]{2,}/i.test(name)) {
    const letters = name.replace(/[^a-z]/gi, '')
    if (letters.length >= 16 && name.replace(/-/g, '').length >= 24) return true
  }
  return false
}

/* ───────────── 时间工具：本地时区对齐 ───────────── */

/** 把任意 epoch ms 对齐到所在「本地整点」的 epoch ms */
export function toLocalHourStart(ms: number): number {
  const d = new Date(ms)
  d.setMinutes(0, 0, 0)
  return d.getTime()
}

/** 把任意 epoch ms 对齐到所在「本地零点」的 epoch ms */
export function toLocalDayStart(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 从 epoch ms 取本地日期 YYYY-MM-DD */
export function toLocalDateStr(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d
    .getDate()
    .toString()
    .padStart(2, '0')}`
}

/** 从本地日期 YYYY-MM-DD 取当天零点的 epoch ms */
export function fromLocalDateStr(date: string): number {
  const [y, m, d] = date.split('-').map((x) => parseInt(x, 10))
  if (!y || !m || !d) return Number.NaN
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime()
}
