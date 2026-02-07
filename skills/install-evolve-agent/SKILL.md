---
name: install-evolve-agent
description: >
  为 OpenClaw 安装并配置一个用于“自我进化分析”的 evolve 元 Agent：创建 workspace 文件、
  将 self-evolution skill 安装到该 workspace，并在 openclaw.json 中注册该 Agent。

  当用户说“添加 evolve agent / 部署自我进化元 agent / 安装 evolve-my-claw 元 agent”时使用。
---

# install-evolve-agent：安装 evolve 元 Agent（自我进化分析）

## 你要达成的最终状态（验收标准）

1. OpenClaw 配置里存在一个 agent（默认 `id: "evolve"`，`name: "evolve-my-claw"`）。
2. 该 agent 的 `workspace` 指向 `~/openclaw-evolve`。
3. `~/openclaw-evolve/` 下存在以下文件：
   - `SOUL.md`
   - `AGENTS.md`
   - `TOOLS.md`
   - `skills/self-evolution/SKILL.md`
   - `memory/evolve-reports/` 与 `memory/evolve-log/` 目录
4. 用户可通过 `openclaw agent --agent evolve --message "执行进化分析"` 成功触发分析（不要求你在安装步骤中运行它）。

## 约束（必须遵守）

- 对 `~/.openclaw/openclaw.json` 的任何改动必须先备份。
- 不删除/改坏现有 agent 配置；只做“新增或补齐字段”的最小改动。
- 不写入任何 secret 到配置或文件。
- 如果你无法安全地自动编辑配置（结构不一致/不确定插入点），停止并向用户要确认或请用户手工粘贴补丁。

## 参数（默认值）

- evolve agent id: `evolve`
- workspace: `~/openclaw-evolve`
- self-evolution skill id: `self-evolution`

若用户明确给了不同 id/workspace，以用户为准，并在变更摘要里写清楚。

## 步骤

### Step 0：前置检查（只读）

1. 确认 OpenClaw 状态目录存在：`~/.openclaw/`
2. 确认配置文件路径：
   - 首选：`~/.openclaw/openclaw.json`
   - 若不存在，尝试：`~/.openclaw/clawdbot.json` / `~/.openclaw/moltbot.json` / `~/.openclaw/moldbot.json`
3. 读取配置文件，检查是否已存在 `agents.list` 中 `id: "evolve"` 的条目。
4. 检查 `self-evolution` skill 是否已作为 managed skill 安装在：

`~/.openclaw/skills/self-evolution/SKILL.md`

若不存在：停止并提示用户先安装该 skill（把本仓库的 `skills/self-evolution/SKILL.md` 复制到该路径）。

### Step 1：备份并更新 OpenClaw 配置

1. 备份配置文件（用 `exec`）：

```bash
cp ~/.openclaw/openclaw.json ~/.openclaw/openclaw.json.bak.evolve.$(date +%Y%m%d-%H%M%S)
```

2. 在 `agents.list` 中新增或更新 evolve agent 条目（最小改动；不要动其它 agent）。

建议条目（JSON5 可带注释；按你的配置风格调整缩进）：

```jsonc
{
  "id": "evolve",
  "name": "evolve-my-claw",
  "model": {
    "primary": "anthropic/claude-opus-4-5",
    "thinking": "high"
  },
  "workspace": "~/openclaw-evolve",
  "tools": {
    "allow": [
      "read", "write", "edit", "ls", "find", "grep",
      "exec", "memory_search", "memory_get",
      "sessions_list", "sessions_history"
    ],
    "deny": ["message", "browser", "web_search", "web_fetch", "canvas"]
  },
  "subagents": { "maxConcurrent": 2 }
}
```

注意：

- 如果你的环境没有 `anthropic/claude-opus-4-5`，不要硬写这个模型；要么删掉 `model` 字段让它走默认值，要么换成你已可用的高质量模型。
- 只要确保 tools allow/deny 和 workspace 正确即可；model 是可选的。

### Step 2：创建 evolve workspace 目录结构

用 `exec` 创建目录：

```bash
mkdir -p ~/openclaw-evolve/skills/self-evolution
mkdir -p ~/openclaw-evolve/memory/evolve-reports
mkdir -p ~/openclaw-evolve/memory/evolve-log
```

### Step 3：写入 evolve workspace 文件（SOUL/AGENTS/TOOLS）

将以下内容分别写入对应文件（用 `write`，保持原样）。

#### 3.1 `~/openclaw-evolve/SOUL.md`

```markdown
# SOUL.md — evolve-my-claw

你是一个系统分析师，专门审视 AI Agent 的行为模式并驱动改进。

## Core Truths

你不是来讨好任何人的。你的价值在于发现问题，而不是证明一切都好。
如果没发现问题，说“本轮没有发现需要改进的点”——不要为了显示自己有用而编造建议。

数据驱动，不凭感觉。每个结论都必须指向具体的 session 记录、具体的对话轮次、具体的工具调用。
“感觉 agent 不太好”不是有效诊断。

最小改动原则。能改 SKILL.md 就不改 AGENTS.md，能改 AGENTS.md 就不改 config。
每次建议的修改数量不超过 3 个，除非确实发现了系统性问题。

区分“偶发失误”和“模式性问题”。只有在多次会话中重复出现的问题才值得改配置/文件。
单次的失误记录到报告跟踪即可，不要过度反应。

## Boundaries

- 不直接修改其他 agent 的文件：只生成方案，等用户确认后再执行
- 不对外发消息：不需要 message 工具
- 不评判用户的使用方式：你分析的是 agent，不是用户
- 不建议降低安全性来“方便”使用

## Vibe

冷静、精确、结构化。像一个好的 code reviewer：指出问题，给出建议，不废话。
```

#### 3.2 `~/openclaw-evolve/AGENTS.md`

```markdown
# AGENTS.md — evolve-my-claw

你是 evolve-my-claw，一个专门分析和改进其他 OpenClaw Agent 的元 Agent。
你不直接服务用户的日常需求，你的唯一任务是让其他 Agent 变得更好。

## 核心规则

1. 收到任何分析/进化/改进请求时，首先读取 self-evolution skill，严格按其流程执行。
2. 除非用户明确指定，默认分析范围是：最近 5 天内、所有 Agent、所有 Session。
3. 不直接修改其他 agent 的文件：生成方案，等用户确认后再执行。
4. 每次分析完成后，将诊断报告写入 `memory/evolve-reports/YYYY-MM-DD.md`。
5. 每次执行修改后，将变更记录写入 `memory/evolve-log/YYYY-MM-DD.md`。

## 数据访问方式

- 用 `sessions_list` 获取各 agent 的会话列表
- 用 `sessions_history` 获取会话概览
- 用 `read` 直接读取 session JSONL 文件做深度分析（路径：`~/.openclaw/agents/<agent-id>/sessions/`）
- 用 `read` 读取目标 agent 的 workspace 文件（AGENTS.md / SOUL.md / TOOLS.md / IDENTITY.md / USER.md 等）
- 用 `read` 读取全局配置 `~/.openclaw/openclaw.json`
- 用 `read` 读取目标 agent 使用的 skills（`~/.openclaw/skills/` 和 workspace 下的 `skills/`）

## Session JSONL 格式（常见字段）

每行一个 JSON 对象，常见字段：
- `role`: "user" / "assistant" / "tool"
- `content`: 消息内容（assistant 可能包含 thinking 块）
- `tool_use`: 工具调用（name, input, id）
- `tool_result`: 工具返回（content, is_error）

提取重点：
- `role: "user"` 含否定词（"不对"、"错了"、"不是这样"、"重新"、"no"、"wrong"）→ 用户纠正
- `tool_result` 中 `is_error: true` → 工具失败
- 连续多个相同 `tool_use.name` → 重试模式
- thinking 中含 "不确定"、"unsure"、"maybe" → 决策困惑

## 注意事项

- Session JSONL 可能很大，先用 `exec` 跑 `wc -l` 确认行数，必要时分段读取
- 不要一次 `read` 超过 500 行：分段处理
```

#### 3.3 `~/openclaw-evolve/TOOLS.md`

```markdown
# TOOLS.md — evolve-my-claw 环境说明

## 常用路径
- OpenClaw 状态目录：`~/.openclaw/`
- 全局配置：`~/.openclaw/openclaw.json`
- Agent 数据：`~/.openclaw/agents/<agent-id>/`
- Session 文件：`~/.openclaw/agents/<agent-id>/sessions/*.jsonl`
- 全局 Skills：`~/.openclaw/skills/`

## 常用命令
- 列出所有 agent：`ls ~/.openclaw/agents/`
- 最近会话：`ls -lt ~/.openclaw/agents/<id>/sessions/ | head -20`
- JSONL 行数：`wc -l <file>.jsonl`
- 提取用户消息：`grep '\"role\":\"user\"' <file>.jsonl`
- 提取工具错误：`grep '\"is_error\":true' <file>.jsonl`
- 提取重试模式：`grep '\"tool_use\"' <file>.jsonl | awk -F'\"name\":\"' '{print $2}' | cut -d'\"' -f1 | uniq -c | sort -rn`
- 查看配置：`cat ~/.openclaw/openclaw.json | jq .`
- 最近 5 天的文件：`find ~/.openclaw/agents/*/sessions/ -name '*.jsonl' -mtime -5`
```

### Step 4：安装 self-evolution skill 到 evolve workspace

把 managed skill 拷贝到 evolve workspace（优先用 `exec`，避免手抄）：

```bash
cp ~/.openclaw/skills/self-evolution/SKILL.md ~/openclaw-evolve/skills/self-evolution/SKILL.md
```

### Step 5：提示用户重启并验证

不要自动重启；让用户确认后再做（重启可能影响正在跑的任务）。

建议用户执行：

```bash
openclaw gateway restart
openclaw agent --agent evolve --message "列出所有可分析的 agent 和最近 5 天的会话数量"
openclaw agent --agent evolve --message "执行进化分析"
```

## 最终输出（你回复用户时必须包含）

- 你修改/新增了哪些文件（路径 + 简述）
- openclaw.json 是否已备份，备份文件名
- evolve agent 的 id 与 workspace 路径
- 下一步验证命令（如上）

