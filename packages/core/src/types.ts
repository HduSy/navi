/**
 * Navi core 数据类型
 *
 * 这些类型描述采集器从 ClaudeCode session jsonl 解析出的结构化数据。
 * Raw Sources 层（jsonl 文件）不可变，这里只存索引级元数据供 ingest pipeline 用。
 */

/** 一个 ClaudeCode session 文件的轻量元信息（不读内容，仅 stat） */
export interface SessionFile {
  filePath: string
  fileName: string
  sessionId: string | null  // 从文件名提取的 uuid，可能为 null
  fileSizeBytes: number
  mtime: number  // 修改时间（ms）
}

/** 解析后的 Session 结构化数据，对应 DB sessions 表一行 */
export interface Session {
  id: string                  // sessionId (uuid)
  filePath: string            // jsonl 文件绝对路径
  projectPath: string         // cwd（工作目录）
  gitBranch: string | null
  claudeVersion: string | null
  startedAt: number           // epoch ms
  endedAt: number             // epoch ms
  durationMs: number
  userMessageCount: number
  assistantMessageCount: number
  toolCallCount: number       // tool_use + tool_result 总数
  errorCount: number          // system api_error / level=error
  models: string[]            // 用过的模型
  fileSizeBytes: number
  lineCount: number
  lastParsedLineCount: number // 上次解析时的行数，用于判断是否需要重解析
  ingestedAt: number          // epoch ms
}

/** 采集结果：新增/更新的 session 列表 */
export interface CollectResult {
  scanned: number             // 扫描的文件总数
  upserted: number            // 写入/更新的 session 数
  skipped: number             // 跳过（未变化）的数量
  failed: number              // 解析失败的数量
  sessions: Session[]
}
