# Navi

> Your AI work companion that observes, remembers, and grows with you.

Navi 是一个本地优先的桌面 AI 伙伴。它通过观察你与 Claude Code（以及更多本地工具）的互动，长出自己的人格、技能、经验、习惯、项目认知和社会关系，能对话、能自我调校、能给你回看自己一段时间的总结。

- **本地优先**：所有数据存在 `userData/navi.db` + `userData/wiki/`，零云端
- **三层记忆架构**（Karpathy LLM Wiki）：Raw Sources（不可变 jsonl）→ Wiki（LLM 维护的 markdown DAG）→ Schema（`navi.md` 工作流配置）
- **可观察、可干预**：你看到的每一页 markdown 都可以打开编辑；每一次自我调校都进 `personality_history` 可回滚

## 仓库结构

```
navi/
├─ apps/
│  └─ desktop/                 # Electron + Vite + React 19
│     ├─ src/main/             # 主进程：IPC、调度、ingest、对话、人格
│     ├─ src/preload/          # contextBridge：把 navi API 安全暴露给 renderer
│     └─ src/renderer/         # 渲染层：9 个页面（对话 / 时间线 / 日记 / 项目 / 记忆 / 人格 / 技能 / 关系 / 大脑）
└─ packages/
   ├─ core/                    # 零 Electron 依赖：schema、采集器、wiki 文件系统、Claude 配置
   ├─ brain/                   # 模型供应商抽象：Anthropic + OpenAI 兼容双协议
   └─ scheduler/               # 定时任务引擎（当前为 stub，调度逻辑暂在 main/scheduler.ts）
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

也可以在应用内 **09 · 大脑** 页面手动配置：
- 走 Anthropic Messages API（`provider=claude`）
- 走 OpenAI 兼容 chat completions（任意兼容供应商）

三个 scope 各自独立：
- `analysis`：后台分析（时间线、经验抽取等）
- `dialogue`：对话回复
- `action`：自我调校意图路由

## 数据位置

- DB：`<userData>/navi.db`（SQLite + WAL）
- Wiki：`<userData>/wiki/`（markdown 文件树 + `navi.md` schema）

开发模式下 `<userData>` 在 macOS 上是 `~/Library/Application Support/Electron`。

## 工作原理

- **Ingest**：扫 `~/.claude/projects/**/*.jsonl`，仅按文件大小做增量；新/变更的 session 入库后由 analysis brain 异步生成衍生条目
- **Query**：用户发消息先过 action brain（识别自我调校意图），否则走 dialogue brain + RAG（关键词命中 wiki）
- **Lint**：定期扫 wiki 找孤儿页、相似经验、矛盾声明，写入 `log.md`

## License

Private.
