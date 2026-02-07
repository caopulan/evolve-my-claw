import type { TimelineEvent } from "../ingest/session-transcript.js";
import type { SessionIndexEntry } from "../ingest/session-store.js";
import type { EvolveConfig } from "../config.js";
import { compileToolFilters, shouldExcludeTool } from "./tool-filters.js";

export type TaskToolCall = {
  toolCallId: string;
  toolName: string;
  startTs: number;
  endTs?: number;
  durationMs?: number;
  summary?: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
  originSessionKey?: string;
  originSessionId?: string;
};

export type TaskContinuation = {
  messageId: string;
  ts: number;
  text: string;
  kind: "subagent_request" | "background_result" | "followup";
};

export type TaskAssistantMessage = {
  messageId: string;
  ts: number;
  text: string;
};

export type TaskCandidateRecord = {
  type: "task_candidate";
  taskId: string;
  rev: number;
  createdAt: number;
  sessionKey: string;
  sessionId: string;
  parentSessionKey?: string;
  parentTaskId?: string;
  spawnedSessionKeys?: string[];
  agentId: string;
  userMessageId: string;
  userMessage: string;
  assistantReply?: TaskAssistantMessage;
  startTs: number;
  endTs?: number;
  toolCalls: TaskToolCall[];
  continuations?: TaskContinuation[];
};

type CandidateBuilder = {
  taskId: string;
  createdAt: number;
  sessionKey: string;
  sessionId: string;
  parentSessionKey?: string;
  parentTaskId?: string;
  spawnedSessionKeys: string[];
  agentId: string;
  userMessageId: string;
  userMessage: string;
  assistantReply?: TaskAssistantMessage;
  startTs: number;
  endTs?: number;
  toolCalls: TaskToolCall[];
  continuations: TaskContinuation[];
};

const CONTINUATION_MAX_CHARS = 2000;
const ASSISTANT_MAX_CHARS = 4000;

function truncateText(value: string, max = CONTINUATION_MAX_CHARS): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max)}…`;
}

function classifyContinuation(text: string): TaskContinuation["kind"] {
  const lowered = text.toLowerCase();
  if (lowered.includes("background task") || lowered.includes("后台任务")) {
    return "background_result";
  }
  return "followup";
}

function isBackgroundCompletionMessage(text: string): boolean {
  const trimmed = text.trimStart();
  const firstLine = trimmed.split(/\\r?\\n/, 1)[0] ?? "";
  const lowered = firstLine.toLowerCase();
  if (lowered.includes("background task")) {
    return true;
  }
  if (firstLine.includes("后台任务")) {
    return true;
  }
  return false;
}

function isAnalysisPromptMessage(text: string): boolean {
  const lowered = text.toLowerCase();
  if (lowered.includes("openclaw 任务分析器")) {
    return true;
  }
  if (text.includes("SELF_EVOLUTION_TASK_ANALYSIS")) {
    return true;
  }
  if (lowered.includes("task candidate analysis")) {
    return true;
  }
  if (lowered.includes("task_id:") && lowered.includes("json schema")) {
    return true;
  }
  return false;
}

function isAnalysisAssistantMessage(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) {
    return false;
  }
  return (
    trimmed.includes("\"title\"") &&
    trimmed.includes("\"summary\"") &&
    trimmed.includes("\"status\"") &&
    trimmed.includes("\"confidence\"")
  );
}

function extractBackgroundLabel(text: string): string | undefined {
  const match = text.match(/background task \"([^\"]+)\"/i);
  if (match?.[1]) {
    return match[1].trim();
  }
  return undefined;
}

function extractChildSessionKey(text: string): string | undefined {
  const match = text.match(/sessionKey\\s+([\\w:.-]+)/i);
  if (match?.[1]) {
    return match[1].trim();
  }
  return undefined;
}

function extractChildSessionKeyFromToolResult(result: unknown): string | undefined {
  if (!result) {
    return undefined;
  }
  if (typeof result === "object") {
    const record = result as Record<string, unknown>;
    if (typeof record.childSessionKey === "string") {
      return record.childSessionKey;
    }
    if (Array.isArray(result)) {
      for (const entry of result) {
        if (!entry || typeof entry !== "object") {
          continue;
        }
        const item = entry as Record<string, unknown>;
        if (typeof item.childSessionKey === "string") {
          return item.childSessionKey;
        }
        if (typeof item.text === "string") {
          try {
            const parsed = JSON.parse(item.text) as { childSessionKey?: string };
            if (typeof parsed.childSessionKey === "string") {
              return parsed.childSessionKey;
            }
          } catch {
            // ignore
          }
        }
      }
    }
  }
  if (typeof result === "string") {
    try {
      const parsed = JSON.parse(result) as { childSessionKey?: string };
      if (typeof parsed.childSessionKey === "string") {
        return parsed.childSessionKey;
      }
    } catch {
      // ignore
    }
  }
  return undefined;
}

function extractSpawnLabelFromArgs(args: Record<string, unknown> | undefined): string | undefined {
  if (!args) {
    return undefined;
  }
  const label = typeof args.label === "string" ? args.label.trim() : "";
  return label || undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function buildToolCall(event: TimelineEvent): TaskToolCall {
  const details = asRecord(event.details);
  return {
    toolCallId: event.toolCallId ?? event.id,
    toolName: event.toolName ?? "tool",
    startTs: event.ts,
    endTs: typeof details?.endedAt === "number" ? details.endedAt : undefined,
    durationMs: event.durationMs,
    summary: event.summary,
    args: details?.args,
    result: details?.result,
    isError: Boolean(details?.isError),
    originSessionKey: event.sessionKey,
    originSessionId: event.sessionId,
  };
}

function finalizeCandidate(candidate: CandidateBuilder | null): TaskCandidateRecord | null {
  if (!candidate || candidate.toolCalls.length === 0) {
    return null;
  }
  return {
    type: "task_candidate",
    taskId: candidate.taskId,
    rev: 1,
    createdAt: candidate.createdAt,
    sessionKey: candidate.sessionKey,
    sessionId: candidate.sessionId,
    parentSessionKey: candidate.parentSessionKey,
    parentTaskId: candidate.parentTaskId,
    spawnedSessionKeys: candidate.spawnedSessionKeys.length > 0 ? candidate.spawnedSessionKeys : undefined,
    agentId: candidate.agentId,
    userMessageId: candidate.userMessageId,
    userMessage: candidate.userMessage,
    assistantReply: candidate.assistantReply,
    startTs: candidate.startTs,
    endTs: candidate.endTs,
    toolCalls: candidate.toolCalls,
    continuations: candidate.continuations.length > 0 ? candidate.continuations : undefined,
  };
}

export function buildTaskCandidates(params: {
  session: SessionIndexEntry;
  events: TimelineEvent[];
  config: EvolveConfig;
}): TaskCandidateRecord[] {
  const events = [...params.events].sort((a, b) => a.ts - b.ts);
  const toolFilters = compileToolFilters(params.config.excludeTools);

  const candidates: TaskCandidateRecord[] = [];
  const candidatesById = new Map<string, TaskCandidateRecord>();
  const spawnBySessionKey = new Map<string, string>();
  const spawnByLabel = new Map<string, string>();
  let current: CandidateBuilder | null = null;
  let ignoreAssistant = false;

  const attachContinuation = (taskId: string, continuation: TaskContinuation): boolean => {
    if (current && current.taskId === taskId) {
      current.continuations.push(continuation);
      return true;
    }
    const existing = candidatesById.get(taskId);
    if (!existing) {
      return false;
    }
    if (!existing.continuations) {
      existing.continuations = [];
    }
    existing.continuations.push(continuation);
    return true;
  };

  for (const event of events) {
    if (event.kind === "user_message") {
      const userMessageRaw =
        typeof event.details?.text === "string" ? event.details.text : event.summary ?? "";
      const userMessage = userMessageRaw.trim();
      if (userMessage && isAnalysisPromptMessage(userMessage)) {
        ignoreAssistant = true;
        continue;
      }
      if (userMessage && isBackgroundCompletionMessage(userMessage)) {
        const continuation: TaskContinuation = {
          messageId: event.id,
          ts: event.ts,
          text: truncateText(userMessage),
          kind: classifyContinuation(userMessage),
        };
        const childKey = extractChildSessionKey(userMessage);
        const label = extractBackgroundLabel(userMessage);
        const targetTaskId =
          (childKey ? spawnBySessionKey.get(childKey) : undefined) ??
          (label ? spawnByLabel.get(label) : undefined);
        if (targetTaskId) {
          attachContinuation(targetTaskId, continuation);
        } else if (current) {
          current.continuations.push(continuation);
        }
        continue;
      }
      const finished = finalizeCandidate(current);
      if (finished) {
        candidates.push(finished);
        candidatesById.set(finished.taskId, finished);
      }
      ignoreAssistant = false;
      current = {
        taskId: `task-${params.session.sessionId}-${event.id}`,
        createdAt: event.ts,
        sessionKey: params.session.key,
        sessionId: params.session.sessionId,
        parentSessionKey: params.session.spawnedBy ?? undefined,
        spawnedSessionKeys: [],
        agentId: params.session.agentId,
        userMessageId: event.id,
        userMessage: userMessage,
        assistantReply: undefined,
        startTs: event.ts,
        toolCalls: [],
        continuations: [],
      };
      continue;
    }

    if (!current) {
      continue;
    }

    if (event.kind === "assistant_message") {
      if (ignoreAssistant) {
        continue;
      }
      const textRaw = typeof event.details?.text === "string" ? event.details.text : event.summary ?? "";
      const text = textRaw.trim();
      if (!text || isAnalysisAssistantMessage(text)) {
        continue;
      }
      current.assistantReply = {
        messageId: event.id,
        ts: event.ts,
        text: truncateText(text, ASSISTANT_MAX_CHARS),
      };
      if (!current.endTs || event.ts > current.endTs) {
        current.endTs = event.ts;
      }
      continue;
    }

    if (event.kind === "tool") {
      const details = asRecord(event.details);
      const args = asRecord(details?.args);
      const toolName = event.toolName ?? "tool";
      if (shouldExcludeTool(toolName, args, toolFilters)) {
        continue;
      }
      const toolCall = buildToolCall(event);
      current.toolCalls.push(toolCall);
      if (toolName === "sessions_spawn") {
        const childKey = extractChildSessionKeyFromToolResult(details?.result);
        if (childKey) {
          spawnBySessionKey.set(childKey, current.taskId);
          current.spawnedSessionKeys.push(childKey);
        }
        const label = extractSpawnLabelFromArgs(args);
        if (label) {
          spawnByLabel.set(label, current.taskId);
        }
      }
      const endTs = toolCall.endTs ?? event.ts;
      if (!current.endTs || endTs > current.endTs) {
        current.endTs = endTs;
      }
    }
  }

  const finished = finalizeCandidate(current);
  if (finished) {
    candidates.push(finished);
    candidatesById.set(finished.taskId, finished);
  }

  return candidates;
}

function mergeToolCalls(base: TaskToolCall[], extra: TaskToolCall[]): TaskToolCall[] {
  const merged = [...base, ...extra];
  merged.sort((a, b) => a.startTs - b.startTs);
  return merged;
}

function resolveParentTaskId(
  child: TaskCandidateRecord,
  byId: Map<string, TaskCandidateRecord>,
  childToParent: Map<string, string>,
): string | undefined {
  const direct = childToParent.get(child.sessionKey);
  if (direct) {
    return direct;
  }
  if (!child.parentSessionKey) {
    return undefined;
  }
  let best: TaskCandidateRecord | undefined;
  for (const candidate of byId.values()) {
    if (candidate.sessionKey !== child.parentSessionKey) {
      continue;
    }
    if (candidate.startTs <= child.startTs) {
      if (!best || candidate.startTs > best.startTs) {
        best = candidate;
      }
    }
  }
  if (best) {
    return best.taskId;
  }
  for (const candidate of byId.values()) {
    if (candidate.sessionKey !== child.parentSessionKey) {
      continue;
    }
    if (!best || candidate.startTs > best.startTs) {
      best = candidate;
    }
  }
  return best?.taskId;
}

export function mergeSubagentCandidates(candidates: TaskCandidateRecord[]): TaskCandidateRecord[] {
  if (candidates.length === 0) {
    return candidates;
  }
  const byId = new Map<string, TaskCandidateRecord>();
  for (const candidate of candidates) {
    byId.set(candidate.taskId, candidate);
  }

  const childToParent = new Map<string, string>();
  for (const candidate of candidates) {
    if (!candidate.spawnedSessionKeys) {
      continue;
    }
    for (const childKey of candidate.spawnedSessionKeys) {
      childToParent.set(childKey, candidate.taskId);
    }
  }

  const removed = new Set<string>();
  for (const candidate of candidates) {
    const parentId = resolveParentTaskId(candidate, byId, childToParent);
    if (!parentId || parentId === candidate.taskId) {
      continue;
    }
    const parent = byId.get(parentId);
    if (!parent) {
      continue;
    }
    parent.toolCalls = mergeToolCalls(parent.toolCalls, candidate.toolCalls);
    if (candidate.continuations && candidate.continuations.length > 0) {
      if (!parent.continuations) {
        parent.continuations = [];
      }
      parent.continuations.push(...candidate.continuations);
    }
    if (candidate.endTs && (!parent.endTs || candidate.endTs > parent.endTs)) {
      parent.endTs = candidate.endTs;
    }
    removed.add(candidate.taskId);
  }

  return candidates.filter((candidate) => !removed.has(candidate.taskId));
}
