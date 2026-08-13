# navi-knowledge

Navi 的认知 MCP server —— 让 Claude Code / Codex / OpenCode / Cursor 等 AI coding 工具通过 [MCP](https://modelcontextprotocol.io) 查询、更新 Navi 的认知库（记忆 / 人格 / 技能 / 项目 / 关系）。

- `search`：查询认知，跨记忆（wiki 页面）、人格、技能、项目、关系 5 个域做关键词匹配
- `update`：写一条记忆页到认知库（`wiki/<type>/<slug>.md`），Navi 会通过 ingest / 索引感知

## 构建

```bash
cd packages/navi-knowledge
pnpm install
pnpm build   # 产出 dist/
```

产物为纯 Node 进程（stdio transport），使用 Node 22 内置 `node:sqlite` 只读访问 `navi.db`，无 native 模块冲突。

## 配置到各工具

MCP server 以 stdio 独立进程运行。先 `pnpm build`，然后把下面配置里的 `<repo>` 换成 Navi 仓库绝对路径。

### Claude Code（`~/.claude/settings.json`）

```json
{
  "mcpServers": {
    "navi-knowledge": {
      "command": "node",
      "args": ["<repo>/packages/navi-knowledge/dist/index.js"],
      "env": { "NAVI_USER_DATA": "~/Library/Application Support/@navi/desktop" }
    }
  }
}
```

### OpenCode（`~/.config/opencode/opencode.json`）

```json
{
  "mcp": {
    "navi-knowledge": {
      "type": "stdio",
      "command": "node",
      "args": ["<repo>/packages/navi-knowledge/dist/index.js"],
      "env": { "NAVI_USER_DATA": "~/Library/Application Support/@navi/desktop" }
    }
  }
}
```

### Codex（`~/.codex/config.toml`）

```toml
[mcp_servers.navi-knowledge]
command = "node"
args = ["<repo>/packages/navi-knowledge/dist/index.js"]

[mcp_servers.navi-knowledge.env]
NAVI_USER_DATA = "~/Library/Application Support/@navi/desktop"
```

## 工具说明

### search

```
search(query, type?, limit?)
```

- `query`：搜索关键词
- `type`：`all`（默认）| `memory` | `personality` | `skill` | `project` | `relation`
- `limit`：返回条数，默认 8，最大 30

返回匹配条目：`类型 / 标题 / 摘要`。

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
