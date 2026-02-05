import crypto from "node:crypto";
import type { GatewayCaptureClient } from "../gateway/client.js";
import type { TaskRecord } from "../tasks/task-store.js";
import type {
  EvolutionChangeTarget,
  EvolutionDimension,
  EvolutionReportRecord,
} from "./types.js";

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
  return [
    `TASK_ID: ${task.taskId}`,
    `SESSION_KEY: ${task.sessionKey}`,
    `USER_MESSAGE: ${normalizeValue(task.userMessage, 2000)}`,
    `CONTINUATIONS: ${continuationBlock}`,
    `TOOL_SUMMARY: ${summary || "none"}`,
    "TOOLS:",
    toolList,
  ].join("\n");
}

function buildPrompt(params: {
  tasks: TaskRecord[];
  dimensions: EvolutionDimension[];
  changeTargets: EvolutionChangeTarget[];
  allowedPaths: string[];
  openclawConfigPath: string;
  workspacePaths: Array<{ agentId: string; path: string }>;
  hooksDir: string;
  skillsDir: string;
  useSearch: boolean;
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
    '      "evidence"?: string,',
    '      "recommendation"?: string,',
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
    "- 只输出包含 solution 的条目；solution 必须是 recommendation（非空）或 changes（至少一条）。",
    "- 没有 solution 的问题不要输出为条目。",
    "- changes 必须可执行，给出明确原因与修改内容。",
    "- openclaw_config_merge_patch 的 patch 只能包含顶层键：agents, bindings, tools, session, plugins, hooks, skills。",
    "- 文件修改必须使用 target.path 指向绝对路径，并且路径必须在允许范围内。",
    "- 如果 USE_SEARCH=true，必须至少使用一次 sessions_spawn 调用子代理检索 web 或 X/Twitter 方案；找到可行方案再写入 recommendation，并注明来源；找不到就不必提及。",
    "",
    `SELECTED_DIMENSIONS: ${params.dimensions.join(", ") || "none"}`,
    `CHANGE_TARGETS: ${params.changeTargets.join(", ") || "none"}`,
    `USE_SEARCH: ${params.useSearch ? "true" : "false"}`,
    `OPENCLAW_CONFIG: ${params.openclawConfigPath}`,
    "WORKSPACES:",
    workspaceLines,
    `MANAGED_HOOKS_DIR: ${params.hooksDir}`,
    `MANAGED_SKILLS_DIR: ${params.skillsDir}`,
    "ALLOWED_PATHS:",
    params.allowedPaths.map((p) => `- ${p}`).join("\n"),
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
  const prompt = buildPrompt({
    tasks: params.tasks,
    dimensions: params.dimensions,
    changeTargets: params.changeTargets,
    allowedPaths: params.allowedPaths,
    openclawConfigPath: params.openclawConfigPath,
    workspacePaths: params.workspacePaths,
    hooksDir: params.hooksDir,
    skillsDir: params.skillsDir,
    useSearch: params.useSearch,
  });
  const idempotencyKey = crypto.randomUUID();

  const response = await params.client.request<GatewayAgentResponse>(
    "agent",
    {
      message: prompt,
      agentId: params.analysisAgentId,
      deliver: false,
      timeout: params.timeoutSeconds,
      extraSystemPrompt: params.useSearch
        ? "Only respond with JSON. Use tools when USE_SEARCH=true and call sessions_spawn at least once. Do not include Markdown or code fences."
        : "Only respond with JSON. Do not use tools. Do not include Markdown or code fences.",
      idempotencyKey,
      label: "Evolve Report",
    },
    { expectFinal: true },
  );

  const rawText = extractAgentText(response);
  const parsed = parseEvolutionReport(rawText);

  const items = parsed.items ? safeCastItems(parsed.items) : [];
  const actionableItems = items.filter((item) => {
    const recommendationValue = (item as { recommendation?: unknown }).recommendation;
    const recommendation =
      typeof recommendationValue === "string" && recommendationValue.trim().length > 0;
    const changeValue = (item as { changes?: unknown }).changes;
    const changes = Array.isArray(changeValue) ? changeValue.length > 0 : false;
    return recommendation || changes;
  });
  const summary =
    actionableItems.length > 0
      ? parsed.summary ?? "analysis failed"
      : "未找到可执行的解决方案";

  return {
    type: "evolution_report",
    reportId: `evolution-${Date.now()}-${crypto.randomUUID()}`,
    createdAt: Date.now(),
    analysisAgentId: params.analysisAgentId,
    taskIds: params.tasks.map((task) => task.taskId),
    dimensions: params.dimensions,
    changeTargets: params.changeTargets,
    useSearch: params.useSearch,
    summary,
    items: actionableItems,
    rawResponse: rawText ? truncateText(rawText, MAX_RAW_RESPONSE_CHARS) : undefined,
    parseError: parsed.error,
  };
}
