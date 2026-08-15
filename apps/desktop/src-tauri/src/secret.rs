//! 敏感字符串（如 apiKey）的存储标记。
//!
//! Electron 时代用 safeStorage / macOS Keychain；Tauri 迁移后曾沿用 keyring
//! crate 走 Keychain，但未签名 app 的 ad-hoc 签名每次构建都变，Keychain ACL
//! 认不出新构建，用户每次升级都要被弹「允许访问钥匙串」——体验太差，砍掉。
//! 现在直接以 `plain:base64` 标记存进 SQLite（位于用户主目录），与 fallback
//! 来源 ~/.claude/settings.json 里的明文 token 安全水位一致。
//!
//! DB 兼容：旧版写入的 `keychain:<scope>` 标记已无法解密（keyring 依赖已删）
//! → 返回空串，UI 提示用户重新配置，与原版「换设备/钥匙串失效」行为一致。

const PLAIN_PREFIX: &str = "plain:";

/// 存储：明文 → `plain:base64` 标记串（空串原样返回），写入 SQLite 的 api_key 列。
pub fn encrypt_secret(plain: &str) -> String {
    if plain.is_empty() {
        return String::new();
    }
    format!("{}{}", PLAIN_PREFIX, base64_encode(plain.as_bytes()))
}

/// 读取：`plain:` → 明文；`keychain:`（旧版遗留）或无法识别 → 空串（提示重新配置）。
pub fn decrypt_secret(cipher: &str) -> String {
    if cipher.is_empty() {
        return String::new();
    }
    if let Some(rest) = cipher.strip_prefix(PLAIN_PREFIX) {
        return base64_decode(rest);
    }
    String::new()
}

/* 简易 base64（避免额外依赖） */
const B64_CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub fn base64_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | (b[2] as u32);
        out.push(B64_CHARS[(n >> 18) as usize & 63] as char);
        out.push(B64_CHARS[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { B64_CHARS[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { B64_CHARS[n as usize & 63] as char } else { '=' });
    }
    out
}

pub fn base64_decode(s: &str) -> String {
    let mut buf: Vec<u8> = Vec::new();
    let mut acc: u32 = 0;
    let mut bits = 0;
    for c in s.chars() {
        if let Some(idx) = B64_CHARS.iter().position(|&x| x as char == c) {
            acc = (acc << 6) | idx as u32;
            bits += 6;
            if bits >= 8 {
                bits -= 8;
                buf.push((acc >> bits) as u8);
            }
        }
    }
    String::from_utf8_lossy(&buf).to_string()
}
