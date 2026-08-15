//! 对应 main/secret.ts：系统钥匙串加密敏感字符串（如 apiKey）
//!
//! Electron safeStorage 在 macOS 走 Keychain；这里用 keyring crate 同样走 Keychain。
//! 旧 Electron 版写入的密文（safeStorage v10 格式）这里解不开：
//! 与原版「换设备/钥匙串失效 → 返回空串，提示用户重新配置」的行为一致。

const SERVICE: &str = "com.hbusy.navi.brain";
const PLAIN_PREFIX: &str = "plain:";

fn entry(scope: &str) -> Option<keyring::Entry> {
    keyring::Entry::new(SERVICE, &format!("api-key-{}", scope)).ok()
}

/// 加密：明文 → 存入钥匙串，返回标记串（空串原样返回）。
/// 返回值存入 SQLite 的 api_key 列：
/// - `keychain:<scope>`：密文在钥匙串里
/// - `plain:<base64>`：钥匙串不可用时的降级（对齐原版降级行为）
/// - 空：空
pub fn encrypt_secret(scope: &str, plain: &str) -> String {
    if plain.is_empty() {
        return String::new();
    }
    if let Some(e) = entry(scope) {
        if e.set_password(plain).is_ok() {
            return format!("keychain:{}", scope);
        }
    }
    // 不可用降级：明文 base64，加前缀标记（对齐原版）
    format!("{}{}", PLAIN_PREFIX, base64_encode(plain.as_bytes()))
}

/// 解密：密文标记 → 明文。空串原样返回；解密失败返回空（调用方提示重新配置）。
pub fn decrypt_secret(scope: &str, cipher: &str) -> String {
    if cipher.is_empty() {
        return String::new();
    }
    if let Some(rest) = cipher.strip_prefix("keychain:") {
        let scope = if rest.is_empty() { scope } else { rest };
        if let Some(e) = entry(scope) {
            if let Ok(pw) = e.get_password() {
                return pw;
            }
        }
        return String::new();
    }
    if let Some(rest) = cipher.strip_prefix(PLAIN_PREFIX) {
        return base64_decode(rest);
    }
    // 旧 Electron safeStorage 密文（base64，无前缀）：无法用钥匙串还原 → 返回空
    String::new()
}

/// 当前钥匙串是否可用（供 UI 提示）
pub fn is_secret_protection_available() -> bool {
    match entry("__probe__") {
        Some(e) => {
            // set + delete 一次探测
            let probe = format!("probe-{}", crate::paths::now_ms());
            if e.set_password(&probe).is_ok() {
                let _ = e.delete_credential();
                true
            } else {
                false
            }
        }
        None => false,
    }
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
