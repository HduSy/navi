//! 对应 @navi/brain PROVIDER_PRESETS：供应商预设表（原样平移）

use serde::Serialize;
use super::WireProtocol;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderPreset {
    pub id: String,
    pub label: String,
    pub base_url: String,
    pub default_model: String,
    pub models: Vec<String>,
    pub protocol: WireProtocol,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub docs_url: Option<String>,
}

pub fn provider_presets() -> Vec<ProviderPreset> {
    vec![
        ProviderPreset {
            id: "anthropic".into(),
            label: "Anthropic".into(),
            base_url: "https://api.anthropic.com/v1".into(),
            default_model: "claude-sonnet-4-5".into(),
            models: vec![
                "claude-opus-4-1".into(),
                "claude-sonnet-4-5".into(),
                "claude-haiku-4-5".into(),
            ],
            protocol: WireProtocol::Anthropic,
            docs_url: Some("https://docs.anthropic.com".into()),
        },
        ProviderPreset {
            id: "openai".into(),
            label: "OpenAI".into(),
            base_url: "https://api.openai.com/v1".into(),
            default_model: "gpt-4o".into(),
            models: vec!["gpt-4o".into(), "gpt-4o-mini".into(), "gpt-4-turbo".into(), "o1-mini".into()],
            protocol: WireProtocol::Openai,
            docs_url: Some("https://platform.openai.com".into()),
        },
        ProviderPreset {
            id: "glm".into(),
            label: "智谱 GLM".into(),
            base_url: "https://open.bigmodel.cn/api/anthropic".into(),
            default_model: "glm-5.3".into(),
            models: vec![
                "glm-5.3".into(),
                "glm-5.2".into(),
                "glm-5.1".into(),
                "glm-5".into(),
                "glm-4.6".into(),
                "glm-4.5".into(),
            ],
            protocol: WireProtocol::Anthropic,
            docs_url: Some("https://open.bigmodel.cn/dev/api".into()),
        },
        ProviderPreset {
            id: "doubao".into(),
            label: "火山方舟".into(),
            base_url: "https://ark.cn-beijing.volces.com/api/v3".into(),
            default_model: "doubao-seed-1-6-250615".into(),
            models: vec!["doubao-seed-1-6-250615".into(), "doubao-1-5-pro-32k".into()],
            protocol: WireProtocol::Openai,
            docs_url: Some("https://www.volcengine.com/docs/82379".into()),
        },
        ProviderPreset {
            id: "deepseek".into(),
            label: "DeepSeek".into(),
            base_url: "https://api.deepseek.com/v1".into(),
            default_model: "deepseek-chat".into(),
            models: vec!["deepseek-chat".into(), "deepseek-reasoner".into()],
            protocol: WireProtocol::Openai,
            docs_url: Some("https://platform.deepseek.com".into()),
        },
        ProviderPreset {
            id: "qwen".into(),
            label: "通义千问".into(),
            base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1".into(),
            default_model: "qwen-max".into(),
            models: vec!["qwen-max".into(), "qwen-plus".into(), "qwen-turbo".into()],
            protocol: WireProtocol::Openai,
            docs_url: Some("https://help.aliyun.com/zh/dashscope".into()),
        },
        ProviderPreset {
            id: "openrouter".into(),
            label: "OpenRouter".into(),
            base_url: "https://openrouter.ai/api/v1".into(),
            default_model: "anthropic/claude-sonnet-4.5".into(),
            models: vec![
                "anthropic/claude-sonnet-4.5".into(),
                "openai/gpt-4o".into(),
                "google/gemini-pro-1.5".into(),
            ],
            protocol: WireProtocol::Openai,
            docs_url: Some("https://openrouter.ai/docs".into()),
        },
    ]
}
