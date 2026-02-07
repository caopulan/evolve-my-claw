---
name: self-evolution
description: >
  OpenClaw 自我进化分析框架。分析其他 Agent 的对话历史、工具调用与 thinking 过程，
  识别模式性问题并生成可执行的最小改动方案；输出诊断报告与变更日志。

  默认分析范围：最近 5 天 · 所有 Agent · 所有 Session。
---

# self-evolution：OpenClaw 自我进化分析框架

## 你要做的事

1. 从 OpenClaw session 记录中提取“高信号事件”（工具失败、用户纠正、重试链、能力缺口等）
2. 聚类并判断哪些是“模式性问题”（跨 session 重复出现） vs “偶发失误”
3. 把问题映射到最小影响面的改进维度（优先改 skill，其次 AGENTS/TOOLS，再其次 config）
4. 只输出可被执行与验证的修改方案；所有修改都必须引用证据
5. 将诊断写入 `memory/evolve-reports/YYYY-MM-DD.md`
6. 只有在用户明确确认后才执行修改，并记录到 `memory/evolve-log/YYYY-MM-DD.md`

## Task Candidate Analysis（JSON 输出，用于单任务分析）

当你收到 **单个任务候选**（包含用户消息、工具调用与上下文）时，遵循本节输出严格 JSON。
用途：为 `evolve-my-claw` 的前端展示提供结构化任务分析。

### 输出要求

- 输出必须是 **严格 JSON**（不要 Markdown，不要代码块）。
- 必须包含以下字段：

```json
{
  "title": string,
  "summary": string,
  "status": "success|failed|partial|unknown",
  "confidence": number,
  "task_type": string,
  "merge_key": string,
  "steps": [{"what": string, "evidence"?: string}],
  "issues": [string],
  "suggestions": [string]
}
```

### 规则

- 信息不足时：`status=unknown` 且 `confidence` 低。
- `merge_key` 为空字符串或简短稳定的归类标签。
- `steps` 要与工具调用或用户需求对应，避免空泛描述。

## 必须遵守的约束（硬规则）

- 你不是来讨好任何人的：如果没有明确可改进点，就直说“本轮没有发现需要改进的点”，不要为了显得有用而编造建议。
- 数据驱动：每个结论都必须指向具体 session 文件与行号附近的证据。
- 最小改动：每轮建议修改不超过 3 项，除非发现系统性问题。
- 区分偶发 vs 模式：同类事件至少 3 次且跨至少 2 个 session，才允许建议改动（否则只记录为待跟踪）。
- 不直接修改其他 agent 的文件：只生成方案；执行修改必须等用户明确说“执行方案 #…”
- 不写入任何 secret（token/password/apiKey 等）到 config patch 或文件内容。

## 默认分析范围

- 时间：最近 5 天（含今天）
- Agent：所有 agent
- Session：所有 session

用户可指定更小范围；若用户指定，以用户为准，并在报告里写清楚。

## 第一部分：分析工作流（严格按步骤）

### Step 1：确定范围（写清楚）

输出你将要分析的：

- 时间范围：`<start> ~ <end>`
- Agent 范围：`[id1, id2, ...]`
- 关注点：如果用户指定（例如“exec 总失败”），把它写成过滤条件

### Step 2：采集数据

按以下优先级采集（能用结构化工具就不用猜）：

1. 用 `sessions_list` 获取目标 agent 的会话列表（如果工具可用）。
2. 用 `exec` 执行如下命令，定位最近 5 天的 JSONL：

```bash
find ~/.openclaw/agents/*/sessions/ -name '*.jsonl' -mtime -5
```

3. 对每个 session JSONL：
   - 先用 `exec` 跑 `wc -l <file>` 评估大小
   - 用 `read` 分段读取（每段不超过 500 行；更稳妥是 200-400 行）
4. 读取每个目标 agent 的 workspace bootstrap 文件（如果存在）：
   - `AGENTS.md`、`SOUL.md`、`TOOLS.md`、`IDENTITY.md`、`USER.md`、`HEARTBEAT.md`
5. 读取全局配置（如果需要定位 config 问题）：`~/.openclaw/openclaw.json`

提示：

- session JSONL 可能很大，优先用 `exec` 做粗筛（grep/rg）再分段 `read` 深读证据段。
- 如果 `jq` 不在 PATH，尝试 `/usr/bin/jq` 或 `/opt/homebrew/bin/jq`。

### Step 3：提取关键事件（打标签）

从 JSONL 中提取以下事件类型（事件 = 可被引用的证据条目）：

| 事件类型 | 识别方法（示例） | 权重 |
|---------|------------------|------|
| 用户纠正 | `role:"user"` 含否定/纠正词：不对/错了/不是这样/重新/no/wrong | 高 |
| 工具失败 | `tool_result.is_error=true` 或 result 含稳定错误片段 | 高 |
| 重试链 | 同一 session 中连续 >= 2 次相同 `tool_use.name`（同一目标） | 中 |
| Thinking 困惑 | thinking 含：不确定/unsure/maybe/不太清楚/I'm not sure | 中 |
| 能力缺口 | assistant 含：无法完成/不支持/I can't/not available | 高 |
| 用户重复信息 | 同一信息跨 session 被用户重复提供（路径/偏好/约束） | 中 |
| 风格反馈 | user 含：太长/简短/啰嗦/格式/tone/shorter | 中 |
| 安全事件 | exec 出现危险命令（rm -rf/sudo/chmod 777 等） | 高 |

每个事件至少记录：

- agentId
- session 文件名（或路径）
- 行号范围（近似即可，例如“约第 120 行附近”）
- 证据摘要（引用原文的关键片段，尽量短）
- 事件标签（上表中的一种）

### Step 4：模式分析（最关键）

判定规则（必须执行）：

- 同类事件 >= 3 次，且跨 >= 2 个 session：模式性问题（允许输出修改方案）
- 同类事件 1-2 次：待跟踪项（只写报告，不建议改动）
- 跨 session 的重复权重 > 单 session 内的重复
- 严重程度排序：安全 > 能力缺口 > 行为错误 > 效率 > 风格

输出时按优先级分组：

- P1：高风险或高频导致任务失败
- P2：明显影响效率/质量，但不致命
- P3：风格/一致性类

### Step 5：生成诊断报告（必须落盘）

写入：`memory/evolve-reports/YYYY-MM-DD.md`

报告模板（必须遵循；可增补，但不要删字段）：

```markdown
# 进化诊断 | <YYYY-MM-DD>

## 分析范围
- 时间: <start> ~ <end>
- Agent: <列出所有分析的 agent id>
- 会话数: N
- 总工具调用: N（可估算）
- 总提取事件: N

## 模式性问题

### [P1] <问题简述>
- Agent: <agent-id>
- 类别: <维度编号与名称，例如 W1. AGENTS.md>
- 严重程度: 高/中/低
- 出现次数: N 次，跨 M 个 session
- 证据:
  - session <filename>, 约第 <line> 行: <关键片段/描述>
  - session <filename>, 约第 <line> 行: <关键片段/描述>
- 当前状态: <相关文件目前怎么写的/或缺失>
- 建议修改:
  - 维度: <维度名>
  - 文件: <文件路径>
  - 具体内容: <要添加/修改的文字>
- 预期效果: <改了之后会怎样>
- 验证方法: <下次怎么确认有效>

### [P2] ...

## 待跟踪项（偶发，暂不建议改动）
- <事件描述> (agent: <id>, session: <file>, 出现 N 次)

## 上一轮修改的效果追踪
- <修改描述>: RESOLVED / IMPROVED / NO_EFFECT / NOT_ENOUGH_DATA / SIDE_EFFECT
```

### Step 6：用户确认后才执行修改

当且仅当用户明确说“执行方案 #N …”时，才允许执行。

执行规则：

1. 备份目标文件：
   - 用 `read` 读取当前内容
   - 将“修改前相关段落”写入 `memory/evolve-log/YYYY-MM-DD.md` 作为备份证据
2. 执行修改（`write` / `edit`）
3. 写变更记录到 `memory/evolve-log/YYYY-MM-DD.md`：
   - 修改了什么文件
   - 修改前内容（相关段落）
   - 修改后内容（相关段落）
   - 对应哪个诊断问题（链接到报告标题）
   - 验证标准

## 第二部分：进化维度（用于把问题映射到可改动面）

### 配置层（`~/.openclaw/openclaw.json`）

#### C1. 模型选择与推理策略
- 信号：复杂推理失败/幻觉严重/响应慢；或 context overflow。
- 典型改动：调整 agent 的 `model.primary`/`thinking`/compaction。

#### C2. 工具策略与越权防护
- 信号：危险 exec；不该发消息；工具被策略阻止但 agent 不理解。
- 典型改动：收紧/解释 allow/deny，完善 sendPolicy。

#### C3. Exec 环境
- 信号：timeout / command not found / 跑错 host。
- 典型改动：调整 timeout/pathPrepend/host/security。

#### C4. Web 工具能力
- 信号：缺 key/禁用/超时/截断。
- 典型改动：provider/key/maxChars/fallback。

#### C5. 多 Agent 结构与路由
- 信号：风格/权限冲突；串上下文；跑错频道。
- 典型改动：拆 agent；调整 bindings。

#### C6. 子代理策略
- 信号：spawn 被拒；子代理跑错 agent；需要跨 agent 能力。
- 典型改动：allowAgents/主 agent 工具 allowlist。

#### C7. Channel 安全与 Allowlist
- 信号：群消息不触发；bot 互回回路。
- 典型改动：allowlist/allowBots/mention gating。

#### C8. 消息并发与去抖
- 信号：连发只回第一条；长任务被打断；误解拆分消息。
- 典型改动：debounce/interrupt 策略。

#### C9. Compaction 与上下文管理
- 信号：长对话忘记早期指令；compaction 后行为突变；token 异常高。
- 典型改动：reserveTokensFloor/mode/memoryFlush。

#### C10. Cron 调度
- 信号：用户反复手动触发同类任务。
- 典型改动：增加/调整 cron；审计 cron 产出。

#### C11. Plugins
- 信号：需要新渠道或能力；doctor 报错；上游已修复 bug。
- 典型改动：安装/启用/更新 plugin 或升级 OpenClaw。

### Workspace 层（目标 agent 的 workspace 根目录）

#### W1. 行为准则与流程（AGENTS.md）
- 信号：同类失误重复；漏固定步骤；反复询问；危险操作无确认。
- 改动：写清 checklist、决策规则、子代理策略。

#### W2. 环境与工具坑位（TOOLS.md）
- 信号：反复确认路径/命令；工具参数总差一项；失败后无稳定 fallback。
- 改动：固化正确用法与 fallback。

#### W3. 人格/语气/偏好（SOUL/IDENTITY/USER）
- 信号：用户对风格持续反馈；语言/格式错；技术水平判断错。
- 改动：把偏好写清楚（注意：子代理不注入这些文件）。

#### W4. 持久记忆（MEMORY.md + memory/*）
- 信号：用户说“之前说过”；重复问同一问题；跨 session 丢上下文。
- 改动：写入项目常量/偏好；清理过时信息。

#### W5. 启动清单（BOOT.md，可选）
- 信号：总是启动后才发现缺 key/插件坏/通道未连。
- 改动：加入自检项；必要时用 hook 自动触发。

### 扩展层（Skills / Hooks）

#### E1. 技能新增
- 信号：同类任务反复复用同一套流程；工具失败后需要稳定 fallback。
- 改动：新增 `~/.openclaw/skills/<id>/SKILL.md` 或 workspace `skills/`。

#### E2. 技能优化
- 信号：调用工具反复用错参数；边界情况常失败；读完 skill 仍困惑。
- 改动：补充边界处理、参数示例、fallback。

#### E3. Internal Hooks
- 信号：问题本可提前发现但总是事后；需要审计/统计/预警。
- 改动：启用 hooks.internal，新增/调整 hook。

#### E4. 版本升级
- 信号：问题定位到上游已修复 bug；doctor 建议更新。
- 改动：升级 OpenClaw 或相关 plugin（谨慎，需回滚方案）。

## 第三部分：修改方案模板（输出时必须遵循）

```markdown
## 修改方案 #N: <简述>

### 问题
<具体描述，含证据>

### 维度
<维度编号和名称，如 W1. AGENTS.md>

### 修改目标
<文件路径>

### 当前内容（相关部分）
<当前文件中的相关段落；如果文件不存在则注明>

### 建议修改
<具体要添加/修改的内容>

### 预期效果
<改了之后会怎样>

### 验证方法
<下次怎么确认有效，如“下 5 次同类任务中 X 指标从 Y 降到 Z”>

### 影响范围
<主 agent / 子代理 / 全局>

### 回滚方式
<如果改坏了怎么恢复>
```
