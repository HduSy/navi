# navi-knowledge

Navi 的认知 MCP server —— 让 Claude Code / Codex / OpenCode / Cursor 等 AI coding 工具通过 [MCP](https://modelcontextprotocol.io) 查询、更新 Navi 的认知库（记忆 / 人格 / 技能 / 项目 / 关系）。

- `search`：查询认知，跨琐事记忆（`memories` 表）、记忆页（wiki）、人格、技能、项目、关系做关键词匹配
- `remember`：往「记忆」记一条琐事（写 `navi.db` 的 `memories` 表，`source='mcp'`），在 Navi「记忆」页可见；用户说「记住xxx」时由 agent 调用
- `update`：写一条记忆页到认知库（`wiki/<type>/<slug>.md`），Navi 会通过 ingest / 索引感知

## 构建

```bash
cd packages/navi-knowledge
pnpm install
pnpm build   # 产出 dist/
```

产物为纯 Node 进程（stdio transport），使用 Node 22 内置 `node:sqlite` 访问 `navi.db`（search 只读、remember 读写），无 native 模块冲突。

## 配置到各工具

MCP server 以 stdio 独立进程运行。**随 Navi 安装包分发**（`dist/index.js` 是 esbuild 打出的无外部依赖单文件，位于应用 Resources 内），推荐直接在 Navi「脑子 → MCP 接入」面板复制配置——里面已自动填好本机的 server 绝对路径和 node 绝对路径。

手动配置（npx 拉起 [navi-knowledge](https://www.npmjs.com/package/navi-knowledge) 最新版，需 Node ≥ 22.13）：

```json
{
  "mcpServers": {
    "navi-knowledge": {
      "command": "npx",
      "args": ["-y", "navi-knowledge"]
    }
  }
}
```

装了 Navi 桌面端的可用安装包内单文件（离线可用，不依赖 npm）：

```json
{
  "mcpServers": {
    "navi-knowledge": {
      "command": "/opt/homebrew/bin/node",
      "args": ["/Applications/Navi.app/Contents/Resources/navi-knowledge/index.js"]
    }
  }
}
```

（Windows 的 server 路径在 NSIS 安装目录的 `resources` 下；开发仓库跑则是 `<repo>/packages/navi-knowledge/dist/index.js`。）

各工具配置位置：

| 工具 | 位置 |
|------|------|
| Claude Code | `~/.claude.json` 的 `mcpServers` 字段 |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Cursor | `~/.cursor/mcp.json` |
| OpenCode | `~/.config/opencode/opencode.json`（`mcp` 字段，条目加 `"type": "stdio"`） |
| Codex | `~/.codex/config.toml`（TOML 等价改写：`[mcp_servers.navi-knowledge]` 下写 command/args） |

数据目录自动按平台解析（macOS `~/Library/Application Support/@navi/desktop`），桌面端装在默认位置无需配 `NAVI_USER_DATA`。

## 工具说明

### search

```
search(query, type?, limit?)
```

- `query`：搜索关键词
- `type`：`all`（默认）| `memory` | `personality` | `skill` | `project` | `relation`
- `limit`：返回条数，默认 8，最大 30

返回匹配条目：`类型 / 标题 / 摘要`。`memory` 域同时覆盖琐事记忆（显示分类/时间/完成状态）和 wiki 记忆页。

### remember

```
remember(content, category?, dueAt?)
```

- `content`：记忆内容本身（去掉「记住」这类指令措辞）
- `category`：`schedule`（日程/定点要做，如抢票）| `todo` | `plan` | `note`（默认）
- `dueAt`：目标时间，`YYYY-MM-DD` 或 `YYYY-MM-DD HH:mm`；相对表述请先换算成绝对时间

写入 `navi.db` 的 `memories` 表（WAL 模式下与桌面端并发安全），Navi「记忆」页与聊天上下文随即可见。

### update

```
update(title, content, type?, tags?)
```

- `title`：记忆页标题（slug 化为文件名）
- `content`：markdown 正文
- `type`：`experience`（默认）| `project` | `person` | `habit` | `skill` | `personality`
- `tags`：可选标签

写入 `wiki/<type>/<slug>.md`（frontmatter 兼容 Navi 的 `WikiFS`），并追加到 `log.md`。

## 环境变量

| 变量 | 说明 |
|------|------|
| `NAVI_USER_DATA` | Navi userData 目录（含 `navi.db` 和 `wiki/`）。缺省按平台默认：macOS `~/Library/Application Support/@navi/desktop` |
