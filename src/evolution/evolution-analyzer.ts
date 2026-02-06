import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { GatewayCaptureClient } from "../gateway/client.js";
import type { TaskRecord } from "../tasks/task-store.js";
import type {
  EvolutionChangeTarget,
  EvolutionDimension,
  EvolutionReportRecord,
} from "./types.js";
import { loadOpenClawConfig, type OpenClawConfigRecord } from "./openclaw-config.js";

type GatewayAgentResponse = {
  runId?: string;
  status?: string;
  summary?: string;
  result?: {
    payloads?: Array<{ text?: string }>;
  };
};

const MAX_FIELD_CHARS = 1200;
const MAX_RAW_RESPONSE_CHARS = 40_000;
const MAX_TOOL_CALLS_PER_TASK = 20;
const MAX_CONTINUATIONS = 3;
const MAX_FILE_SNIPPET_CHARS = 3500;
const MAX_SKILLS_PER_WORKSPACE = 5;
const MAX_SKILL_SNIPPET_CHARS = 2500;
const SCHEMA_VERSION = 2;

function truncateText(value: string, max = MAX_FIELD_CHARS): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}…`;
}

function normalizeValue(value: unknown, max = MAX_FIELD_CHARS): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return truncateText(value.trim(), max);
  }
  try {
    const raw = JSON.stringify(value);
    return truncateText(raw, max);
  } catch {
    return truncateText(String(value), max);
  }
}

function summarizeToolCall(call: TaskRecord["toolCalls"][number]): string {
  const args = normalizeValue(call.args, 400);
  const result = normalizeValue(call.result, 400);
  const error = call.isError ? " error" : "";
  const duration = typeof call.durationMs === "number" ? ` ${call.durationMs}ms` : "";
  const summary = call.summary ? ` ${call.summary}` : "";
  return `${call.toolName}${summary}${duration}${error}\nargs: ${args}\nresult: ${result}`;
}

function buildToolSummary(calls: TaskRecord["toolCalls"]): Array<{ tool: string; count: number; errors: number }> {
  const map = new Map<string, { tool: string; count: number; errors: number }>();
  for (const call of calls) {
    const entry = map.get(call.toolName) ?? { tool: call.toolName, count: 0, errors: 0 };
    entry.count += 1;
    entry.errors += call.isError ? 1 : 0;
    map.set(call.toolName, entry);
  }
  return Array.from(map.values());
}

function buildTaskBlock(task: TaskRecord): string {
  const toolLines = task.toolCalls.slice(0, MAX_TOOL_CALLS_PER_TASK).map((call, idx) => {
    return `#${idx + 1} ${summarizeToolCall(call)}`;
  });
  const toolList = toolLines.length > 0 ? toolLines.join("\n\n") : "none";
  const summary = buildToolSummary(task.toolCalls)
    .map((entry) => `${entry.tool} x${entry.count}${entry.errors ? ` (errors:${entry.errors})` : ""}`)
    .join(", ");
  const continuations = Array.isArray(task.continuations) ? task.continuations : [];
  const continuationLines = continuations.slice(0, MAX_CONTINUATIONS).map((entry, idx) => {
    return `#${idx + 1} [${entry.kind}] ${truncateText(entry.text ?? "", 800)}`;
  });
  const continuationBlock = continuationLines.length > 0 ? continuationLines.join("\n") : "none";
  const assistantReply = task.assistantReply?.text
    ? truncateText(task.assistantReply.text, 2000)
    : "none";
  const spawned = Array.isArray(task.spawnedSessionKeys) && task.spawnedSessionKeys.length > 0
    ? task.spawnedSessionKeys.join(", ")
    : "none";
  return [
    `TASK_ID: ${task.taskId}`,
    `SESSION_KEY: ${task.sessionKey}`,
    `USER_MESSAGE: ${normalizeValue(task.userMessage, 2000)}`,
    `ASSISTANT_REPLY: ${assistantReply}`,
    `CONTINUATIONS: ${continuationBlock}`,
    `SPAWNED_SESSION_KEYS: ${spawned}`,
    `TOOL_SUMMARY: ${summary || "none"}`,
    "TOOLS:",
    toolList,
  ].join("\n");
}

function normalizeSensitiveKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isSensitiveKeyName(key: string): boolean {
  const normalized = normalizeSensitiveKey(key);
  return (
    normalized === "token" ||
    normalized === "password" ||
    normalized === "secret" ||
    normalized === "apikey" ||
    normalized === "accesskey" ||
    normalized === "privatekey" ||
    normalized === "clientsecret" ||
    normalized === "refreshtoken" ||
    normalized === "bearertoken"
  );
}

function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth >= 6) {
    return "[truncated]";
  }
  if (Array.isArray(value)) {
    const out = value.slice(0, 20).map((entry) => redactSecrets(entry, depth + 1));
    if (value.length > out.length) {
      out.push("[truncated]");
    }
    return out;
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const entries = Object.entries(record).slice(0, 50);
  for (const [key, child] of entries) {
    if (isSensitiveKeyName(key)) {
      out[key] = "<redacted>";
      continue;
    }
    out[key] = redactSecrets(child, depth + 1);
  }
  if (Object.keys(record).length > entries.length) {
    out["__truncatedKeys"] = true;
  }
  return out;
}

function selectConfigForPrompt(config: OpenClawConfigRecord): OpenClawConfigRecord {
  const out: OpenClawConfigRecord = {};
  const keep = [
    "meta",
    "models",
    "agents",
    "tools",
    "messages",
    "commands",
    "approvals",
    "hooks",
    "gateway",
    "skills",
    "plugins",
  ];
  for (const key of keep) {
    if (key in config) {
      out[key] = config[key];
    }
  }
  return out;
}

function readTextSnippet(filePath: string, maxChars: number): string | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const raw = fs.readFileSync(filePath, "utf8");
    if (raw.length <= maxChars) {
      return raw;
    }
    return `${raw.slice(0, maxChars)}\n\n[truncated]`;
  } catch {
    return null;
  }
}

function listDirNames(dir: string, maxEntries: number): string[] {
  try {
    if (!fs.existsSync(dir)) {
      return [];
    }
    const names = fs.readdirSync(dir).slice(0, maxEntries);
    return names;
  } catch {
    return [];
  }
}

function buildWorkspaceContext(workspaces: Array<{ agentId: string; path: string }>): string {
  const lines: string[] = [];
  for (const ws of workspaces) {
    lines.push(`## Workspace: ${ws.agentId}`);
    lines.push(`ROOT: ${ws.path}`);
    const docs = ["AGENTS.md", "TOOLS.md", "SOUL.md", "RULES.md", "BOOTSTRAP.md", "HEARTBEAT.md"];
    for (const name of docs) {
      const filePath = path.join(ws.path, name);
      const snippet = readTextSnippet(filePath, MAX_FILE_SNIPPET_CHARS);
      if (!snippet) {
        continue;
      }
      lines.push("");
      lines.push(`### ${filePath}`);
      lines.push(snippet.trimEnd());
    }

    const skillsRoot = path.join(ws.path, "skills");
    const skillDirs = listDirNames(skillsRoot, MAX_SKILLS_PER_WORKSPACE);
    if (skillDirs.length > 0) {
      lines.push("");
      lines.push(`SKILLS_DIR: ${skillsRoot}`);
      lines.push(`SKILLS: ${skillDirs.join(", ")}`);
      for (const dirName of skillDirs) {
        const skillPath = path.join(skillsRoot, dirName, "SKILL.md");
        const snippet = readTextSnippet(skillPath, MAX_SKILL_SNIPPET_CHARS);
        if (!snippet) {
          continue;
        }
        lines.push("");
        lines.push(`### ${skillPath}`);
        lines.push(snippet.trimEnd());
      }
    }

    lines.push("");
  }
  return lines.join("\n");
}

function buildPrompt(params: {
  tasks: TaskRecord[];
  dimensions: EvolutionDimension[];
  changeTargets: EvolutionChangeTarget[];
  allowedPaths: string[];
  openclawConfigPath: string;
  openclawConfigSnippet: string;
  workspacePaths: Array<{ agentId: string; path: string }>;
  workspaceContext: string;
  hooksDir: string;
  skillsDir: string;
  useSearch: boolean;
  analysisAgentId: string;
}): string {
  const taskBlocks = params.tasks.map((task) => buildTaskBlock(task));
  const tasksSection = taskBlocks.length > 0 ? taskBlocks.join("\n\n---\n\n") : "none";
  const workspaceLines =
    params.workspacePaths.length > 0
      ? params.workspacePaths.map((entry) => `- ${entry.agentId}: ${entry.path}`).join("\n")
      : "none";
  return [
    "你是 OpenClaw evolution 分析器。",
    "请根据选中的任务与维度输出严格 JSON（不要 Markdown，不要代码块）。",
    "目标：提出可执行、可落盘、可回滚的自我进化方案（优先 changes，其次 recommendation，最后才是 userActions）。",
    "输出必须符合以下 JSON schema：",
    "{",
    '  "summary": string,',
    '  "items": [',
    "    {",
    '      "itemId": string,',
    '      "scope": "task|multi",',
    '      "taskId"?: string,',
    '      "dimension": "per_task_tool_quality|cross_task_patterns|change_recommendation",',
    '      "severity": "low|medium|high",',
    '      "title": string,',
    '      "reasoning": string,',
    '      "evidence": string,',
    '      "impact": string,',
    '      "risk": string,',
    '      "testPlan": string,',
    '      "rollbackPlan"?: string,',
    '      "recommendation"?: string,',
    '      "userActions"?: [{ "title": string, "reason"?: string, "steps": string[] }],',
    '      "changes"?: [',
    "        {",
    '          "changeId": string,',
    '          "target": { "kind": "openclaw_config|agent_file|hook_file|skill_file", "path"?: string },',
    '          "summary": string,',
    '          "reason": string,',
    '          "requiresRestart"?: boolean,',
    '          "operation":',
    "            | { \"type\": \"openclaw_config_merge_patch\", \"patch\": object }",
    "            | { \"type\": \"file_append\", \"content\": string }",
    "            | { \"type\": \"file_prepend\", \"content\": string }",
    "            | { \"type\": \"file_replace\", \"search\": string, \"replacement\": string }",
    "            | { \"type\": \"file_write\", \"content\": string, \"overwrite\"?: boolean }",
    "        }",
    "      ]",
    "    }",
    "  ]",
    "}",
    "要求：",
    "- 只分析指定任务，不要引入其他任务。",
    "- 仅输出与选择的维度相关的分析。",
    "- 不允许 no-op：items 至少输出 3 条，并且每个选中维度至少输出 1 条。",
    "- self-evolve 优先：每个 item 尽量给出 changes（至少 1 条）；总 changes 数量至少 2 条。",
    "- 只有当需要用户提供 secret（token/password/apiKey 等）时，才使用 userActions；否则不要用 userActions。",
    "- evidence 必须引用 TASKS/TOOLS 或 CONFIG/WORKSPACE_EXCERPTS 中的具体片段（比如 toolName、error、文件段落）。",
    "- openclaw_config_merge_patch 使用 JSON merge patch：对象递归 merge，null 表示删除 key。",
    "- openclaw_config_merge_patch 的 patch 只能包含顶层键：meta, wizard, diagnostics, models, agents, tools, messages, commands, approvals, hooks, channels, gateway, skills, plugins, bindings, session。",
    "- 不要在 patch 或文件内容里写入任何 secret 值（token/password/secret/apiKey 等）。需要 secret 时写入 userActions。",
    "- 如需修改 openclaw_config，优先针对执行 Agent 或全局配置；不要修改 ANALYSIS_AGENT_ID 对应的 agent 配置（避免评估 Agent 自身被改动）。",
    "- 文件修改必须使用 target.path 指向绝对路径，并且路径必须在允许范围内。",
    "- 所有 agent_file 修改必须针对执行任务的 Agent（EXECUTION_WORKSPACES）；不要修改评估 Agent 自己的 workspace（analysisAgentId）。",
    "- file_replace 只能用在 WORKSPACE_EXCERPTS 里出现过的原文片段；否则优先 file_append 或 file_write（overwrite=false）。",
    "- 如果 USE_SEARCH=true，必须至少使用一次 sessions_spawn 调用子代理检索 web 或 X/Twitter 方案；找到可行方案再写入 recommendation，并注明来源；找不到就不必提及。",
    "",
    `SELECTED_DIMENSIONS: ${params.dimensions.join(", ") || "none"}`,
    `CHANGE_TARGETS: ${params.changeTargets.join(", ") || "none"}`,
    `USE_SEARCH: ${params.useSearch ? "true" : "false"}`,
    `ANALYSIS_AGENT_ID: ${params.analysisAgentId}`,
    `OPENCLAW_CONFIG: ${params.openclawConfigPath}`,
    "OPENCLAW_CONFIG_SNIPPET (redacted):",
    params.openclawConfigSnippet,
    "EXECUTION_WORKSPACES:",
    workspaceLines,
    `MANAGED_HOOKS_DIR: ${params.hooksDir}`,
    `MANAGED_SKILLS_DIR: ${params.skillsDir}`,
    "ALLOWED_PATHS:",
    params.allowedPaths.map((p) => `- ${p}`).join("\n"),
    "",
    "WORKSPACE_EXCERPTS:",
    params.workspaceContext || "none",
    "",
    "TASKS:",
    tasksSection,
  ].join("\n");
}

function extractJsonCandidate(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }
  const fencedMatch = trimmed.match(/```json\\s*([\\s\\S]*?)\\s*```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return trimmed.slice(first, last + 1);
  }
  return null;
}

function parseEvolutionReport(text: string): { summary?: string; items?: unknown[]; error?: string } {
  const candidate = extractJsonCandidate(text);
  if (!candidate) {
    return { error: "no json payload found" };
  }
  try {
    const parsed = JSON.parse(candidate) as { summary?: unknown; items?: unknown };
    if (!parsed || typeof parsed !== "object") {
      return { error: "json payload is not an object" };
    }
    const summary = typeof parsed.summary === "string" ? parsed.summary : undefined;
    const items = Array.isArray(parsed.items) ? parsed.items : undefined;
    if (!summary || !items) {
      return { error: "missing summary or items" };
    }
    return { summary, items };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

function extractAgentText(response: GatewayAgentResponse): string {
  const payloads = response?.result?.payloads ?? [];
  const parts = payloads
    .map((p) => (typeof p.text === "string" ? p.text.trim() : ""))
    .filter(Boolean);
  return parts.join("\n\n");
}

function safeCastItems(items: unknown[]): EvolutionReportRecord["items"] {
  return items.filter((item) => item && typeof item === "object") as EvolutionReportRecord["items"];
}

export async function analyzeEvolutionReport(params: {
  tasks: TaskRecord[];
  client: GatewayCaptureClient;
  analysisAgentId: string;
  timeoutSeconds: number;
  dimensions: EvolutionDimension[];
  changeTargets: EvolutionChangeTarget[];
  useSearch: boolean;
  allowedPaths: string[];
  openclawConfigPath: string;
  workspacePaths: Array<{ agentId: string; path: string }>;
  hooksDir: string;
  skillsDir: string;
}): Promise<EvolutionReportRecord> {
  const { config: openclawConfig } = loadOpenClawConfig(params.openclawConfigPath);
  const openclawConfigSnippet = truncateText(
    JSON.stringify(redactSecrets(selectConfigForPrompt(openclawConfig)), null, 2),
    12_000,
  );
  const workspaceContext = truncateText(buildWorkspaceContext(params.workspacePaths), 30_000);

  const prompt = buildPrompt({
    tasks: params.tasks,
    dimensions: params.dimensions,
    changeTargets: params.changeTargets,
    allowedPaths: params.allowedPaths,
    openclawConfigPath: params.openclawConfigPath,
    openclawConfigSnippet,
    workspacePaths: params.workspacePaths,
    workspaceContext,
    hooksDir: params.hooksDir,
    skillsDir: params.skillsDir,
    useSearch: params.useSearch,
    analysisAgentId: params.analysisAgentId,
  });
  const runOnce = async (message: string, attempt: number): Promise<{
    rawText: string;
    parsed: { summary?: string; items?: unknown[]; error?: string };
    actionableItems: EvolutionReportRecord["items"];
  }> => {
    const idempotencyKey = crypto.randomUUID();
    const response = await params.client.request<GatewayAgentResponse>(
      "agent",
      {
        message,
        agentId: params.analysisAgentId,
        deliver: false,
        timeout: params.timeoutSeconds,
        extraSystemPrompt: params.useSearch
          ? "Only respond with JSON. Use tools when USE_SEARCH=true and call sessions_spawn at least once. Do not include Markdown or code fences."
          : "Only respond with JSON. Do not use tools. Do not include Markdown or code fences.",
        idempotencyKey,
        label: attempt === 1 ? "Evolve Report" : `Evolve Report (retry ${attempt})`,
      },
      { expectFinal: true },
    );
    const rawText = extractAgentText(response);
    const parsed = parseEvolutionReport(rawText);
    const items = parsed.items ? safeCastItems(parsed.items) : [];
    const actionableItems = items.filter((item) => {
      const changes = Array.isArray(item.changes) ? item.changes.length > 0 : false;
      const recommendation =
        typeof item.recommendation === "string" && item.recommendation.trim().length > 0;
      const userActions = Array.isArray(item.userActions) ? item.userActions.length > 0 : false;
      return changes || recommendation || userActions;
    });
    return { rawText, parsed, actionableItems };
  };

  const validateAttempt = (items: EvolutionReportRecord["items"]): {
    hasChanges: boolean;
    totalChanges: number;
    hasAtLeastThreeItems: boolean;
    missingRequiredFields: boolean;
  } => {
    let totalChanges = 0;
    let missingRequiredFields = false;
    for (const item of items) {
      if (Array.isArray(item.changes)) {
        totalChanges += item.changes.length;
      }
      const evidenceOk = typeof item.evidence === "string" && item.evidence.trim().length > 0;
      const impactOk = typeof item.impact === "string" && item.impact.trim().length > 0;
      const riskOk = typeof item.risk === "string" && item.risk.trim().length > 0;
      const testOk = typeof item.testPlan === "string" && item.testPlan.trim().length > 0;
      if (!evidenceOk || !impactOk || !riskOk || !testOk) {
        missingRequiredFields = true;
      }
    }
    return {
      hasChanges: totalChanges > 0,
      totalChanges,
      hasAtLeastThreeItems: items.length >= 3,
      missingRequiredFields,
    };
  };

  let attempt = await runOnce(prompt, 1);
  let validation = validateAttempt(attempt.actionableItems);

  if (
    attempt.parsed.error ||
    attempt.actionableItems.length === 0 ||
    !validation.hasAtLeastThreeItems ||
    validation.totalChanges < 2 ||
    validation.missingRequiredFields
  ) {
    const retryPrompt = [
      prompt,
      "",
      "PREVIOUS_OUTPUT_FAILED:",
      attempt.parsed.error ? `- parseError: ${attempt.parsed.error}` : "- parseError: none",
      `- actionableItems: ${attempt.actionableItems.length}`,
      `- totalChanges: ${validation.totalChanges}`,
      `- missingRequiredFields: ${validation.missingRequiredFields}`,
      "",
      "请重新输出严格 JSON，并确保：",
      "- items 至少 3 条",
      "- 总 changes 至少 2 条",
      "- 每个 item 的 evidence/impact/risk/testPlan 非空",
      "- 不要输出 Markdown 或代码块",
    ].join("\n");
    attempt = await runOnce(retryPrompt, 2);
    validation = validateAttempt(attempt.actionableItems);
  }

  const summary = attempt.actionableItems.length > 0 ? attempt.parsed.summary ?? "analysis failed" : "analysis failed";

  return {
    type: "evolution_report",
    schemaVersion: SCHEMA_VERSION,
    reportId: `evolution-${Date.now()}-${crypto.randomUUID()}`,
    createdAt: Date.now(),
    analysisAgentId: params.analysisAgentId,
    taskIds: params.tasks.map((task) => task.taskId),
    dimensions: params.dimensions,
    changeTargets: params.changeTargets,
    useSearch: params.useSearch,
    summary,
    items: attempt.actionableItems,
    rawResponse: attempt.rawText ? truncateText(attempt.rawText, MAX_RAW_RESPONSE_CHARS) : undefined,
    parseError: attempt.parsed.error,
  };
}
