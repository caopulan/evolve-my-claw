# 面向 Agent 的安装与启动说明（Evolve My Claw）

以下步骤面向运行 OpenClaw 的设备，用于安装并启动本项目（外置时间轴与任务分析工具）。

## 前提

- Node.js 版本 >= 22
- 已安装 OpenClaw（默认状态目录 `~/.openclaw`）
- 能在终端执行命令

## 安装

```bash
cd /path/to/workspace
git clone <repo-url> evolve-my-claw
cd evolve-my-claw
pnpm install
pnpm build
```

## 启动 UI

```bash
node dist/cli.js serve
```

默认访问地址：

```
http://127.0.0.1:4797
```

## 启动事件捕获（可选）

用于抓取 gateway 的 agent 事件（工具调用、生命周期等），落盘到：

```
~/.openclaw/evolve-my-claw/agent-events.jsonl
```

启动方式：

```bash
node dist/cli.js capture
```

如果 gateway 需要认证：

```bash
node dist/cli.js capture --token <gateway-token>
```

## 解析任务候选（可选）

将 session 日志解析为“任务候选”，追加写入：

```
~/.openclaw/evolve-my-claw/tasks.jsonl
```

启动方式：

```bash
node dist/cli.js parse
```

可选配置（默认路径）：

```
~/.openclaw/evolve-my-claw/config.json
```

示例：

```json
{
  "excludeAgentIds": ["evolve-my-claw"],
  "excludeTools": ["message/send", "message/thread-reply"],
  "analysisAgentId": "evolve-my-claw",
  "analysisTimeoutSeconds": 120
}
```

## 分析任务（可选）

使用 OpenClaw agent 对任务候选进行 LLM 分析，追加写入：

```
~/.openclaw/evolve-my-claw/tasks.analysis.jsonl
```

启动方式：

```bash
node dist/cli.js analyze --agent evolve-my-claw
```

如果 gateway 需要认证：

```bash
node dist/cli.js analyze --agent evolve-my-claw --token <gateway-token>
```

## 初始化 evolution Agent（建议一次性执行）

```bash
node dist/cli.js evolution
```

该命令会确保 OpenClaw 中存在 `evolve-my-claw` agent，并创建独立的 workspace 文件，
同时启用全量 tools/skills。

## Evolution 分析（UI）

1. 启动 UI（`node dist/cli.js serve`）
2. 在左侧勾选任务
3. 切换到 **Evolution** 标签
4. 选择分析维度 + 修改目标，点击 **Run evolution analysis**

报告会写入：

```
~/.openclaw/evolve-my-claw/evolution.reports.jsonl
```

每条修改建议可在 UI 中点击执行（安全的配置 merge patch + 文件修改）。

## 常见参数

- `--state-dir <dir>`：指定 OpenClaw 状态目录
- `--host <host>`、`--port <port>`：指定 UI 绑定地址与端口
- `--url <ws-url>`：指定 gateway WebSocket 地址（默认 `ws://127.0.0.1:18789`）

## 运行方式建议

- 短期调试：直接在终端运行
- 长期运行：用 `tmux`/`screen`/`nohup` 保持后台进程
