/**
 * safeStorage 封装：用系统钥匙串加密敏感字符串（如 apiKey）。
 *
 * - safeStorage 可用时：encryptString → 密文（base64），decryptString → 明文
 * - safeStorage 不可用时（如 Linux 缺 libsecret）：降级为明文 base64，仍可用但安全性低
 *
 * 调用方约定：密文直接存入 SQLite 的 api_key 列。读出后调 decryptSecret 还原明文。
 */

import { safeStorage } from 'electron'

/** 加密：明文 → 密文（base64 字符串）。空串原样返回。 */
export function encryptSecret(plain: string): string {
  if (!plain) return ''
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(plain).toString('base64')
  }
  // 不可用降级：明文 base64，加前缀标记便于读出时识别
  return 'plain:' + Buffer.from(plain, 'utf8').toString('base64')
}

/** 解密：密文 → 明文。空串原样返回。 */
export function decryptSecret(cipher: string): string {
  if (!cipher) return ''
  if (cipher.startsWith('plain:')) {
    return Buffer.from(cipher.slice(6), 'base64').toString('utf8')
  }
  try {
    return safeStorage.decryptString(Buffer.from(cipher, 'base64'))
  } catch {
    // 解密失败（如换设备/换系统导致钥匙串失效）：返回空，调用方会提示用户重新配置
    return ''
  }
}

/** 当前 safeStorage 是否可用（用于 UI 提示） */
export function isSecretProtectionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}
