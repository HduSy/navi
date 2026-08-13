#!/usr/bin/env node
/**
 * navi-knowledge —— Navi 认知 MCP server（stdio transport）。
 *
 * 工具：
 *   - search：查询认知（记忆 / 人格 / 技能 / 项目 / 关系）
 *   - update：写一条记忆页到认知库（wiki/<type>/<slug>.md）
 *
 * 环境变量：
 *   - NAVI_USER_DATA：Navi userData 目录（navi.db + wiki/ 所在）。缺省按平台默认。
 *
 * 配置示例（Claude Code ~/.claude/settings.json）：
 *   "mcpServers": {
 *     "navi-knowledge": { "command": "node", "args": ["<repo>/packages/navi-knowledge/dist/index.js"] }
 *   }
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { searchCognition, updateMemory, resolveUserData } from './knowledge.js'

const server = new McpServer({
  name: 'navi-knowledge',
  version: '0.1.0'
})

server.tool(
  'search',
  '查询 Navi 的认知库：记忆（wiki 页面）、人格、技能、项目、关系。返回匹配条目（类型/标题/摘要）。',
  {
    query: z.string().describe('搜索关键词'),
    type: z
      .enum(['all', 'memory', 'personality', 'skill', 'project', 'relation'])
      .optional()
      .describe('限定搜索域，缺省 all'),
    limit: z.number().int().min(1).max(30).optional().describe('返回条数，缺省 8')
  },
  async ({ query, type, limit }) => {
    const results = searchCognition({ query, type, limit })
    if (results.length === 0) {
      return { content: [{ type: 'text' as const, text: '没有匹配的认知条目。' }] }
    }
    const text = results
      .map((r, i) => `${i + 1}. [${r.type}] ${r.title}${r.snippet ? ` — ${r.snippet}` : ''}`)
      .join('\n')
    return { content: [{ type: 'text' as const, text }] }
  }
)

server.tool(
  'update',
  '往 Navi 认知库写一条记忆页（markdown）。type 决定存放目录，写完后 Navi 会通过 ingest/索引感知。',
  {
    title: z.string().describe('记忆页标题（会 slug 化成文件名）'),
    content: z.string().describe('记忆页正文（markdown）'),
    type: z
      .enum(['experience', 'project', 'person', 'habit', 'skill', 'personality'])
      .optional()
      .describe('记忆类型，缺省 experience'),
    tags: z.array(z.string()).optional().describe('标签')
  },
  async ({ title, content, type, tags }) => {
    const r = updateMemory({ title, content, type, tags })
    if (!r.ok) {
      return { content: [{ type: 'text' as const, text: `写入失败：${r.error ?? '未知错误'}` }], isError: true }
    }
    const loc = r.file?.replace(resolveUserData(), '~') ?? ''
    return {
      content: [
        {
          type: 'text' as const,
          text: `${r.existing ? '已更新' : '已创建'}记忆页：${title}（${loc}）`
        }
      ]
    }
  }
)

async function main(): Promise<void> {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  // 静默：错误信息通过 MCP 通道返回，不污染 stdout（MCP 用 stdout 传 JSON-RPC）
  console.error(`[navi-knowledge] started, userData=${resolveUserData()}`)
}

main().catch((e) => {
  console.error('[navi-knowledge] fatal:', e)
  process.exit(1)
})
