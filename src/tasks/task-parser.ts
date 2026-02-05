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
};

export type TaskCandidateRecord = {
  type: "task_candidate";
  taskId: string;
  rev: number;
  createdAt: number;
  sessionKey: string;
  sessionId: string;
  agentId: string;
  userMessageId: string;
  userMessage: string;
  startTs: number;
  endTs?: number;
  toolCalls: TaskToolCall[];
};

type CandidateBuilder = {
  taskId: string;
  createdAt: number;
  sessionKey: string;
  sessionId: string;
  agentId: string;
  userMessageId: string;
  userMessage: string;
  startTs: number;
  endTs?: number;
  toolCalls: TaskToolCall[];
};

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
    agentId: candidate.agentId,
    userMessageId: candidate.userMessageId,
    userMessage: candidate.userMessage,
    startTs: candidate.startTs,
    endTs: candidate.endTs,
    toolCalls: candidate.toolCalls,
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
  let current: CandidateBuilder | null = null;

  for (const event of events) {
    if (event.kind === "user_message") {
      const finished = finalizeCandidate(current);
      if (finished) {
        candidates.push(finished);
      }
      const userMessage = typeof event.details?.text === "string" ? event.details.text : event.summary ?? "";
      current = {
        taskId: `task-${params.session.sessionId}-${event.id}`,
        createdAt: event.ts,
        sessionKey: params.session.key,
        sessionId: params.session.sessionId,
        agentId: params.session.agentId,
        userMessageId: event.id,
        userMessage,
        startTs: event.ts,
        toolCalls: [],
      };
      continue;
    }

    if (!current) {
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
      const endTs = toolCall.endTs ?? event.ts;
      if (!current.endTs || endTs > current.endTs) {
        current.endTs = endTs;
      }
    }
  }

  const finished = finalizeCandidate(current);
  if (finished) {
    candidates.push(finished);
  }

  return candidates;
}
