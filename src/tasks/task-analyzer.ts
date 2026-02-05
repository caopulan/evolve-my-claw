import crypto from "node:crypto";
import type { GatewayCaptureClient } from "../gateway/client.js";
import type { TaskCandidateRecord, TaskContinuation, TaskToolCall } from "./task-parser.js";
import { ANALYSIS_VERSION, type TaskAnalysisRecord } from "./analysis-store.js";

type GatewayAgentResponse = {
  runId?: string;
  status?: string;
  summary?: string;
  result?: {
    payloads?: Array<{ text?: string }>;
  };
};

type AnalysisPayload = {
  title: string;
  summary: string;
  status: "success" | "failed" | "partial" | "unknown";
  confidence: number;
  task_type: string;
  merge_key: string;
  steps: Array<{ what: string; evidence?: string }>;
  issues: string[];
  suggestions: string[];
};

const MAX_FIELD_CHARS = 1200;
const MAX_RAW_RESPONSE_CHARS = 20_000;

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

function summarizeToolCall(call: TaskToolCall): string {
  const args = normalizeValue(call.args, 400);
  const result = normalizeValue(call.result, 400);
  const error = call.isError ? " error" : "";
  const duration = typeof call.durationMs === "number" ? ` ${call.durationMs}ms` : "";
  const summary = call.summary ? ` ${call.summary}` : "";
  return `${call.toolName}${summary}${duration}${error}\nargs: ${args}\nresult: ${result}`;
}

function toolSummary(call: TaskToolCall): { tool: string; count: number; errors: number } {
  return { tool: call.toolName, count: 1, errors: call.isError ? 1 : 0 };
}

export function buildToolSummary(calls: TaskToolCall[]): Array<{ tool: string; count: number; errors: number }> {
  const map = new Map<string, { tool: string; count: number; errors: number }>();
  for (const call of calls) {
    const entry = map.get(call.toolName) ?? { tool: call.toolName, count: 0, errors: 0 };
    const delta = toolSummary(call);
    entry.count += delta.count;
    entry.errors += delta.errors;
    map.set(call.toolName, entry);
  }
  return Array.from(map.values());
}

function buildPrompt(task: TaskCandidateRecord): string {
  const toolLines = task.toolCalls.map((call, idx) => {
    return `#${idx + 1} ${summarizeToolCall(call)}`;
  });
  const toolList = toolLines.length > 0 ? toolLines.join("\n\n") : "none";
  const summary = buildToolSummary(task.toolCalls)
    .map((entry) => `${entry.tool} x${entry.count}${entry.errors ? ` (errors:${entry.errors})` : ""}`)
    .join(", ");
  const continuations = Array.isArray(task.continuations) ? task.continuations : [];
  const continuationLines = continuations.slice(0, 3).map((entry: TaskContinuation, idx: number) => {
    return `#${idx + 1} [${entry.kind}] ${truncateText(entry.text, 800)}`;
  });
  const continuationBlock =
    continuationLines.length > 0 ? continuationLines.join("\n") : "none";
  return [
    "你是 OpenClaw 任务分析器。",
    "请基于以下候选任务，输出严格 JSON（不要 Markdown，不要代码块）。",
    "JSON schema:",
    "{",
    '  "title": string,',
    '  "summary": string,',
    '  "status": "success|failed|partial|unknown",',
    '  "confidence": number,',
    '  "task_type": string,',
    '  "merge_key": string,',
    '  "steps": [{"what": string, "evidence"?: string}],',
    '  "issues": [string],',
    '  "suggestions": [string]',
    "}",
    "要求:",
    "- 如果信息不足，status=unknown 且 confidence 低。",
    "- merge_key 为空字符串或简短稳定的归类标签。",
    "",
    `TASK_ID: ${task.taskId}`,
    `USER_MESSAGE: ${normalizeValue(task.userMessage, 2000)}`,
    `CONTINUATIONS: ${continuationBlock}`,
    `TOOL_SUMMARY: ${summary || "none"}`,
    "TOOLS:",
    toolList,
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

function parseAnalysis(text: string): { analysis?: AnalysisPayload; error?: string } {
  const candidate = extractJsonCandidate(text);
  if (!candidate) {
    return { error: "no json payload found" };
  }
  try {
    const parsed = JSON.parse(candidate) as AnalysisPayload;
    if (!parsed || typeof parsed !== "object") {
      return { error: "json payload is not an object" };
    }
    return { analysis: parsed };
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

export async function analyzeTaskCandidate(params: {
  candidate: TaskCandidateRecord;
  client: GatewayCaptureClient;
  analysisAgentId: string;
  timeoutSeconds: number;
  extraSystemPrompt?: string;
}): Promise<TaskAnalysisRecord> {
  const { candidate, client, analysisAgentId, timeoutSeconds } = params;
  const prompt = buildPrompt(candidate);
  const idempotencyKey = crypto.randomUUID();

  const response = await client.request<GatewayAgentResponse>("agent", {
    message: prompt,
    agentId: analysisAgentId,
    deliver: false,
    timeout: timeoutSeconds,
    extraSystemPrompt: params.extraSystemPrompt,
    idempotencyKey,
    label: "Evolve Analysis",
  }, { expectFinal: true });

  const rawText = extractAgentText(response);
  const parsed = parseAnalysis(rawText);
  const toolSummary = buildToolSummary(candidate.toolCalls);
  const durationMs =
    candidate.endTs && candidate.startTs ? Math.max(0, candidate.endTs - candidate.startTs) : undefined;

  return {
    type: "task_analysis",
    analysisId: `analysis-${candidate.taskId}-${Date.now()}`,
    createdAt: Date.now(),
    analysisVersion: ANALYSIS_VERSION,
    analysisAgentId,
    taskId: candidate.taskId,
    sessionKey: candidate.sessionKey,
    sessionId: candidate.sessionId,
    agentId: candidate.agentId,
    userMessage: candidate.userMessage,
    startTs: candidate.startTs,
    endTs: candidate.endTs,
    durationMs,
    toolSummary,
    analysis: parsed.analysis as unknown as Record<string, unknown> | undefined,
    rawResponse: rawText ? truncateText(rawText, MAX_RAW_RESPONSE_CHARS) : undefined,
    parseError: parsed.error,
  };
}
