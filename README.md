# Navi

[![License](https://img.shields.io/badge/license-MIT-black.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-black.svg)](https://github.com/HduSy/navi/pulls)

> Your AI work companion that observes, remembers, and grows with you.

Navi 是一个本地优先的桌面 AI 伙伴。它默默观察你和 Claude Code（及更多本地工具）的每一次协作，自己长出人格、技能、经验、项目认知和社交关系——能聊天、能自我调校、也能回看你自己一段时间的工作轨迹。

- **本地优先**：所有数据存在 `userData/navi.db` + `userData/wiki/`，零云端
- **三层记忆架构**（Karpathy LLM Wiki）：Raw Sources（不可变 jsonl）→ Wiki（LLM 维护的 markdown DAG）→ Schema（`navi.md` 工作流配置）
- **可观察、可干预**：你看到的每一页 markdown 都可以打开编辑；三大脑（理解力 / 聊天力 / 行动力）支持应用内独立配置任意模型供应商

## 界面一览

| 聊天 | 时间线 |
|---|---|
| ![聊天](docs/screenshots/chat.png) | ![时间线](docs/screenshots/timeline.png) |

| 日记 | 项目 |
|---|---|
| ![日记](docs/screenshots/diary.png) | ![项目](docs/screenshots/projects.png) |

| 经验 | 关系 |
|---|---|
| ![经验](docs/screenshots/experiences.png) | ![关系](docs/screenshots/relations.png) |

## 功能说明

### 💬 聊天 —— 有脾气、有记忆的对话

![聊天](docs/screenshots/chat.png)

和 Navi 直接对话。回复由 dialogue brain（LLM + RAG）生成：注入人格维度、自由描述、命中的 wiki 记忆和当前状态。说「幽默点」「话少点」这类指令时，action brain 会先识别意图并自我调校人格——每次调整都进 `personality_history`，可回滚。右侧面板统计你跟 AI 干活的次数、聊过的消息、动手次数和踩过的错误。

### 🕐 时间线 —— 每小时记下你做成了什么

![时间线](docs/screenshots/timeline.png)

Scheduler 每 5 分钟轮询，把每个已结束小时的你和 Claude Code 的对话交给 analysis brain 总结——聚焦「成果」而非「动作」，按项目组织。整点自动封存，支持日期前后翻阅。

### 📖 日记 —— 每晚 21 点自动生成

![日记](docs/screenshots/diary.png)

每天晚上自动把当天的 timeline 聚合成一篇结构化日记（做了什么 / 进行中 / 关键决策 / 待办），也支持「现在就写」手动触发，并自动回填近 7 天缺漏。

### 📁 项目 —— 从会话里识别你的代码库

![项目](docs/screenshots/projects.png)

从 Claude Code 会话路径自动识别项目，统计对话次数、累计耗时、最近活跃。支持按最近 / 次数 / 耗时排序。

### 💡 经验 —— 踩过的坑都是财富

![经验](docs/screenshots/experiences.png)

对近 30 分钟新入库的 session 自动抽取「踩坑经验」，沉淀为 markdown wiki 页（可读可编辑），并通过认知同步回流到各 AI 工具的全局上下文——同一个坑不踩第二次。

### 🧠 人格 —— 直接拖动调整 Navi 的脾气

![人格](docs/screenshots/personality.png)

六个维度（语气 / 幽默感 / 话多不多 / 主动劲 / 懂不懂你 / 敢不敢顶）拖动即调，失焦自动保存。自由文本区可以描述你想要的伙伴形象。

### 🛠 技能 —— 从你的会话里长出的能力

![技能](docs/screenshots/skills.png)

自动发现你用过的 Claude Code skills 和 MCP servers，统计调用次数与最近使用，支持一键启用 / 停用，按最近 / 次数排序。

### 🕸 关系 —— 从会话里识别出的人

![关系](docs/screenshots/relations.png)

从对话中自动识别人物（NER），力导向图展示关系网络。节点大小 = 提及次数，进入页面自动选中提到最多的人。

### ⚙️ 大脑 —— 三颗脑子独立配模型

![大脑](docs/screenshots/brain.png)

Navi 的 LLM 用途分三个 scope，各自独立配置：

| scope | 用途 | 默认档位 |
|---|---|---|
| analysis 理解力 | 时间线 / 日记 / 经验 / 人物抽取 | Haiku 级 |
| dialogue 聊天力 | 对话回复 | Sonnet 级 |
| action 行动力 | 人格调校意图路由 | Haiku 级 |

点击卡片进入配置抽屉：

![大脑配置](docs/screenshots/brain-config.png)

- **供应商预设**：Anthropic / OpenAI / 智谱 GLM / 火山方舟 / DeepSeek / 通义千问 / OpenRouter 一键套用
- **协议切换**：Anthropic Messages / OpenAI Chat Completions
- **自动拉模型**：填好 baseUrl + apiKey 自动拉取模型列表
- **连通性测试**：max_tokens=1 探测请求 + 10s 超时 + 12 种错误分类（Key 无效 / 限流 / 余额不足…）
- **安全存储**：apiKey 走系统钥匙串（safeStorage）加密入库，不落明文
- **零配置可用**：没配过的 scope 自动从 `~/.claude/settings.json` 派生，配过 Claude Code 开箱即用

另外还有**认知同步**：把人格 / 项目 / 技能 / 经验 / 关系导出到各 AI coding 工具的全局上下文（`~/.claude/CLAUDE.md`、`~/.codex/AGENTS.md` 等），分钟级自动同步，内容变化才写入。

### 🎭 颜文字状态机（彩蛋）

顶栏的颜文字会反映 Navi 的真实状态：聊天回复中 `(๑•̀ㅂ•́)و 思考中`、30 秒无操作 `(´-ω-) 发呆`、不同页面各有专属表情和微表情帧动画（眨眼 / 眼珠转 / 偷笑 / 挑眉）。

## 仓库结构

```
navi/
├─ apps/
│  └─ desktop/                 # Electron + Vite + React 19
│     ├─ src/main/             # 主进程：IPC、调度、ingest、对话、人格、认知同步
│     ├─ src/preload/          # contextBridge：把 navi API 安全暴露给 renderer
│     └─ src/renderer/         # 渲染层：9 个页面
└─ packages/
   ├─ core/                    # 零 Electron 依赖：schema、采集器、wiki 文件系统、Claude 配置
   ├─ brain/                   # 模型供应商抽象：双协议 + 连通性测试 + 模型拉取
   └─ scheduler/               # 定时任务引擎
```

## 数据流

```
Claude Code session (.jsonl)            Raw Sources（不可变）
        │
        ▼
   ingest pipeline                       解析 → 入 sessions 表
        │                                → 派生 projects / skills
        ▼
   analysis brain (LLM)                  每小时生成 TimelineEntry
        │                                每晚聚合 Diary
        │                                抽取 Experiences / Persons
        ▼
   Wiki (markdown + frontmatter DAG)     可读、可编辑、可 lint
        │
        ▼
   dialogue brain (LLM + RAG)            对话 = 人格 + 当前状态 + 记忆 → 回复
```

## 快速开始

需要 Node ≥ 22、pnpm ≥ 10.7 < 11。

```bash
pnpm install                 # 首次安装
pnpm dev                     # 启动 desktop 开发模式
pnpm typecheck               # 全仓 typecheck
pnpm build                   # 构建产物到 apps/desktop/out
```

### 配置大脑（模型供应商）

Navi 启动时会自动从 `~/.claude/settings.json` 读取 Anthropic 配置；如果你已经配过 Claude Code，开箱即用。

也可以在应用内「大脑」页点击任意 scope 卡片，配置任意 Anthropic / OpenAI 兼容供应商（含 apiKey 钥匙串加密 + 连通性测试），三个 scope 可以各用各的模型。

### 截图

```bash
node scripts/capture-screenshots.mjs      # 需先 pnpm dev（CDP 驱动自动截图）
```

## 打包 & 发版

```bash
cd apps/desktop && pnpm dist              # 本地打包：产出 dist/Navi-*.dmg 与 mac-arm64/Navi.app
git tag v0.1.0 && git push origin v0.1.0  # 触发 GitHub Actions 自动构建并发 GitHub Release
```

CI（typecheck + build）与发版（tag 触发）见 [.github/workflows](.github/workflows)，
完整打包/发版流程见 [docs/BUILD.md](docs/BUILD.md)。

## 数据位置

- DB：`<userData>/navi.db`（SQLite + WAL）
- Wiki：`<userData>/wiki/`（markdown 文件树 + `navi.md` schema）

开发模式下 `<userData>` 在 macOS 上是 `~/Library/Application Support/Electron`。

## 工作原理

- **Ingest**：扫 `~/.claude/projects/**/*.jsonl`，仅按文件大小做增量；新/变更的 session 入库后由 analysis brain 异步生成衍生条目
- **Query**：用户发消息先过 action brain（识别自我调校意图），否则走 dialogue brain + RAG（关键词命中 wiki）
- **Lint**：定期扫 wiki 找孤儿页、相似经验、矛盾声明，写入 `log.md`

## License

[MIT](LICENSE) © HduSy
