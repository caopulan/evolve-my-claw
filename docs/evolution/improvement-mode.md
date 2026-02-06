# 改进模式（Rule-Driven Evolution）

本项目的 evolution 目标不是“让模型自由发挥给建议”，而是把可复用的改进经验沉淀为**规则**:

- 规则负责: 从 task 日志里用确定性信号命中问题, 抽取证据, 生成可落盘的改进候选（changes/userActions/recommendation 的骨架）。
- LLM 负责: 在规则候选集上做排序与补全（impact/risk/testPlan/rollbackPlan）, 以及在需要时生成更完整的文件内容。

这样能显著降低“建议太泛/不稳定/不可执行”的概率，并在 LLM 不可用时仍能返回可操作的 seed report。

## 1. 可以改进的面（Surfaces）

以下改进面来自 OpenClaw 的真实扩展点与配置结构（以及你任务里最常见的失败模式）。

### Tools（工具与配置）

典型目标:

- web 工具: `tools.web.search.*`, `tools.web.fetch.*`
- exec 工具: `tools.exec.*` 的超时/host/security 配置（需要谨慎, 高风险）
- message 工具: 发送策略与跨上下文限制（改动要非常保守）

适用场景:

- 工具返回结构化 error code（例如 `missing_brave_api_key`）
- 工具反复失败导致 token/时间浪费
- 工具参数组合存在已知限制（例如某些 browser snapshot 参数不支持）

### Skills（技能）

典型目标:

- 通过 managed skills（`~/.openclaw/skills/<skillId>/SKILL.md`）把踩坑经验固化为技能
- 用 skills check 的诊断结果做规则触发（例如缺少 bin/env/config）

适用场景:

- 同类任务频繁复用同一套“排查/修复/替代方案”
- 某个工具失败后需要稳定 fallback（browser/web_fetch 等）

### Hooks（内部 hooks）

典型目标:

- 用 hooks 在命令/生命周期事件上做预检与提醒（例如 gateway 启动/`/new` 时提示缺 key）
- 用 hooks 落盘审计日志（command-logger 等）

适用场景:

- 问题需要“尽早提示”而不是等到 tool 失败后才发现
- 需要对行为做可观测性增强（审计/统计/预警）

注意:

- hooks 需要 `hooks.internal.enabled` 打开，并且 hooks 本身要被启用。规则应该先检查配置/诊断, 再建议变更。

### Agent Workspace 文件（AGENTS/TOOLS/SOUL/RULES 等）

典型目标:

- 把团队协作规则、子代理用法、工具参数坑位写进 `TOOLS.md` / `AGENTS.md`
- 降低“用户每次都要提醒 Agent 才能做对”的重复成本

适用场景:

- 某类错误反复出现但不适合通过 config 修（例如提示词/流程缺失）
- 子代理/后台结果的总结方式需要统一口径

## 2. 触发信号（Triggers）

规则触发应尽量依赖**确定性信号**，避免 “模型猜测”。

### 来自 Task 日志（强信号）

- tool result 内含 error code（即使 `isError=false` 也要解析 result payload）
  - 示例: `web_search` 返回 `{ "error": "missing_brave_api_key", ... }`
- tool result 文本/JSON 中出现稳定的错误片段（regex）
  - 示例: browser snapshot 的参数限制提示

### 来自 Runtime 诊断（强信号）

建议逐步接入（先做读取/展示，再用于规则触发）:

- `openclaw skills check --json`
- `openclaw hooks check --json`
- `which openclaw` / `openclaw --version`（用于确认真实运行版本）

### 跨任务模式（弱一些，但价值高）

- 同类错误在多个 task 中重复出现（应提升 severity, 并推荐更强的“永久修复”）
- 同一类 userActions 反复出现（说明应把流程写入技能/Hook/Workspace docs）

## 3. 输出约束（Outputs）

Evolution report item 的目标优先级:

1. `changes`: 可落盘、可回滚（优先 self-evolve）
2. `recommendation`: 给执行策略/替代方案（不涉及落盘）
3. `userActions`: 只有当需要用户提供 secret 或手工操作（安装依赖/配置 key）时才使用

### 有效性约束（必须产生实际作用）

当规则建议“新增/修改工具能力”（例如新增 skill/hook、修改 TOOLS.md/AGENTS.md、调整 tool 配置）时，必须同时回答一个问题:

**这次改动在下一次任务里是否会被适时查看或使用？**

需要显式给出至少一种“触达路径”（否则属于无效改动，不应输出):

- **自动触达**: 通过 hook 在生命周期/命令事件触发时自动运行（例如 `gateway:startup`、`command:new`），或通过规则引擎在下次分析时命中。
- **工作流触达**: 把关键用法写入会被 agent 经常读取的 workspace 文件（如 `TOOLS.md` / `AGENTS.md` / `BOOTSTRAP.md`），并确保该文件在 `WORKSPACE_EXCERPTS` 中可被纳入 prompt。
- **工具链触达**: 配置变更能直接影响下一次工具决策（例如禁用一个反复失败的工具、启用一个更可靠的 fallback）。

如果无法说明触达路径，规则应退化为更直接的 changes（例如修配置、加 fallback），或者只给 recommendation（但必须解释为什么 recommendation 就能在下次生效）。

强制字段:

- `evidence`: 必须引用 TASKS/TOOLS 或 WORKSPACE_EXCERPTS 的片段
- `impact` / `risk` / `testPlan`: 必须非空

## 4. 安全与兼容性（Guardrails）

- 不写入任何 secret（token/password/apiKey 等）到 config patch 或文件内容。
- 修改 openclaw config 只用 JSON merge patch, 且限制 top-level key（由 apply 层强校验）。
- 文件变更必须落在允许目录:
  - 执行 Agent 的 workspace
  - `~/.openclaw/hooks`
  - `~/.openclaw/skills`
- 不修改分析 Agent 自己的 workspace（避免递归污染评估基准）。

## 5. 规则集位置与覆盖策略（Portability）

内置规则（版本化, 随代码发布）:

- `evolve-my-claw/rules/builtin.rules.json5`

本机覆盖（无需改 repo, 方便实验/迁移）:

- `~/.openclaw/evolve-my-claw/rules/*.json5`

覆盖行为:

- 可以新增规则
- 可以用相同 `ruleId` 覆盖内置规则
- 可以设置 `"enabled": false` 来禁用内置规则

## 6. 什么时候需要改规则（Evolution Rule Maintenance）

建议改规则的典型触发:

- 某类失败在短时间内重复出现 2 次以上（应固化为规则, 并生成 changes）
- 一个 userAction 在不同任务里反复出现（说明应转为 changes + 预检/提示）
- OpenClaw 工具/配置结构更新导致旧规则误判（需要更新 trigger 或 action）

不建议立刻规则化的情况:

- 只出现 1 次、且问题高度任务特异（先放 recommendation, 不要引入规则复杂度）
- 需要大量上下文推理才能判断对错（先让 LLM 输出, 再决定是否抽象为规则）
