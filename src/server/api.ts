import fs from "node:fs";
import path from "node:path";
import type { TimelineEvent } from "../ingest/session-transcript.js";
import { parseSessionTranscript } from "../ingest/session-transcript.js";
import { listSessions, type SessionIndexEntry } from "../ingest/session-store.js";
import { loadSubagentRuns } from "../ingest/subagents.js";
import { capturedEventsToTimeline, loadCapturedAgentEvents } from "../ingest/agent-events.js";
import { resolveOpenClawStateDir } from "../paths.js";
import { loadTaskRecords, type TaskRecord } from "../tasks/task-store.js";
import { loadAnalysisRecords, type TaskAnalysisRecord } from "../tasks/analysis-store.js";

const transcriptCache = new Map<string, { mtimeMs: number; events: TimelineEvent[] }>();

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function extractAgentIdFromSessionKey(sessionKey: string): string | undefined {
  const parts = sessionKey.split(":");
  if (parts.length >= 2 && parts[0] === "agent") {
    return parts[1];
  }
  return undefined;
}

function resolveSessionIdFromFile(sessionFile: string, fallback?: string): string {
  const base = path.basename(sessionFile);
  const match = base.match(/^([a-f0-9-]+)\.jsonl/i);
  if (match?.[1]) {
    return match[1];
  }
  return fallback ?? "unknown";
}

function resolveSessionFileById(stateDir: string, agentId: string, sessionId: string): string | undefined {
  const sessionsDir = path.join(stateDir, "agents", agentId, "sessions");
  const candidate = path.join(sessionsDir, `${sessionId}.jsonl`);
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  if (!fs.existsSync(sessionsDir)) {
    return undefined;
  }
  try {
    const match = fs
      .readdirSync(sessionsDir)
      .find((name) => name.startsWith(`${sessionId}.jsonl.deleted.`));
    if (match) {
      return path.join(sessionsDir, match);
    }
  } catch {
    // ignore
  }
  return undefined;
}

function extractSessionHints(events: TimelineEvent[]): Map<
  string,
  { sessionId?: string; transcriptPath?: string }
> {
  const hints = new Map<string, { sessionId?: string; transcriptPath?: string }>();
  for (const event of events) {
    if (event.kind !== "user_message") {
      continue;
    }
    const details = asRecord(event.details);
    const text = typeof details?.text === "string" ? details.text : "";
    if (!text.includes("sessionKey")) {
      continue;
    }
    const keyMatch = text.match(/sessionKey\s+(\S+)/i);
    if (!keyMatch?.[1]) {
      continue;
    }
    const key = keyMatch[1].trim();
    const sessionIdMatch = text.match(/sessionId\s+(\S+)/i);
    const transcriptMatch = text.match(/transcript\s+(\S+\.jsonl(?:\.deleted\.\S+)?)/i);
    const hint = hints.get(key) ?? {};
    if (sessionIdMatch?.[1]) {
      hint.sessionId = sessionIdMatch[1].trim();
    }
    if (transcriptMatch?.[1]) {
      hint.transcriptPath = transcriptMatch[1].trim();
    }
    hints.set(key, hint);
  }
  return hints;
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

function extractSpawnInfo(event: TimelineEvent): {
  childSessionKey?: string;
  label?: string;
  task?: string;
} {
  const details = asRecord(event.details);
  const args = asRecord(details?.args);
  const childSessionKey =
    extractChildSessionKeyFromToolResult(details?.result) ??
    (typeof details?.childSessionKey === "string" ? details.childSessionKey : undefined);
  const label = typeof args?.label === "string" ? args.label.trim() : undefined;
  const task = typeof args?.task === "string" ? args.task.trim() : undefined;
  return { childSessionKey, label: label || undefined, task: task || undefined };
}

function getEventRange(events: TimelineEvent[]): { start: number; end: number } | null {
  let start: number | null = null;
  let end: number | null = null;
  for (const event of events) {
    const childRange = event.children ? getEventRange(event.children) : null;
    const eventStart = typeof event.ts === "number" ? event.ts : null;
    const eventEnd =
      typeof event.durationMs === "number" && typeof event.ts === "number"
        ? event.ts + event.durationMs
        : eventStart;
    const candidates: number[] = [];
    if (eventStart != null) {
      candidates.push(eventStart);
    }
    if (eventEnd != null) {
      candidates.push(eventEnd);
    }
    if (childRange) {
      candidates.push(childRange.start, childRange.end);
    }
    for (const candidate of candidates) {
      start = start == null ? candidate : Math.min(start, candidate);
      end = end == null ? candidate : Math.max(end, candidate);
    }
  }
  if (start == null || end == null) {
    return null;
  }
  return { start, end };
}

function isSessionsSpawnEvent(event: TimelineEvent): boolean {
  return event.kind === "tool" && event.toolName === "sessions_spawn";
}

function buildSubagentEvent(params: {
  event: TimelineEvent;
  spawn: { childSessionKey?: string; label?: string; task?: string };
  run?: { runId: string; endedAt?: number; outcome?: { status: string; error?: string } };
  children: TimelineEvent[];
}): TimelineEvent {
  const baseDetails = asRecord(params.event.details);
  const childRange = getEventRange(params.children);
  const start = params.event.ts;
  const endCandidate =
    params.run?.endedAt ??
    (typeof baseDetails?.endedAt === "number" ? baseDetails.endedAt : undefined) ??
    childRange?.end;
  const durationMs = endCandidate && endCandidate >= start ? endCandidate - start : params.event.durationMs;
  const summarySource = params.spawn.label || params.spawn.task || params.event.summary || "Subagent run";
  return {
    ...params.event,
    kind: "subagent_run",
    durationMs,
    summary: summarySource,
    runId: params.run?.runId ?? params.event.runId,
    details: {
      childSessionKey: params.spawn.childSessionKey,
      label: params.spawn.label,
      task: params.spawn.task,
      runId: params.run?.runId ?? params.event.runId,
      outcome: params.run?.outcome,
      endedAt: endCandidate,
      spawn: baseDetails,
    },
    children: params.children,
  };
}

export function getSessions(stateDir = resolveOpenClawStateDir()): SessionIndexEntry[] {
  return listSessions(stateDir);
}

async function loadTranscriptEvents(params: {
  session: SessionIndexEntry;
}): Promise<TimelineEvent[]> {
  const sessionFile = params.session.sessionFile;
  if (!sessionFile || !fs.existsSync(sessionFile)) {
    return [];
  }
  const stat = fs.statSync(sessionFile);
  const cached = transcriptCache.get(sessionFile);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.events;
  }
  const events = await parseSessionTranscript({
    sessionFile,
    sessionKey: params.session.key,
    sessionId: params.session.sessionId,
  });
  transcriptCache.set(sessionFile, { mtimeMs: stat.mtimeMs, events });
  return events;
}

export async function buildTimeline(params: {
  sessionKey: string;
  stateDir?: string;
}): Promise<{ session?: SessionIndexEntry; events: TimelineEvent[] }> {
  const stateDir = params.stateDir ?? resolveOpenClawStateDir();
  const sessions = listSessions(stateDir);
  const session = sessions.find((entry) => entry.key === params.sessionKey);
  if (!session) {
    return { events: [] };
  }

  const sessionsByKey = new Map(sessions.map((entry) => [entry.key, entry]));
  const runByChildSession = new Map<string, { runId: string; endedAt?: number; outcome?: { status: string; error?: string } }>();
  for (const run of loadSubagentRuns(stateDir)) {
    if (!run.childSessionKey) {
      continue;
    }
    runByChildSession.set(run.childSessionKey, {
      runId: run.runId,
      endedAt: run.endedAt,
      outcome: run.outcome,
    });
  }

  const rootTranscriptEvents = await loadTranscriptEvents({ session });
  const sessionHints = extractSessionHints(rootTranscriptEvents);
  const sessionFileOverrides = new Map<string, string>();
  const sessionIdOverrides = new Map<string, string>();
  sessionHints.forEach((hint, sessionKey) => {
    const agentId = extractAgentIdFromSessionKey(sessionKey) ?? session.agentId;
    let sessionFile = hint.transcriptPath && fs.existsSync(hint.transcriptPath) ? hint.transcriptPath : undefined;
    const sessionId = hint.sessionId;
    if (!sessionFile && sessionId) {
      sessionFile = resolveSessionFileById(stateDir, agentId, sessionId);
    }
    if (sessionFile) {
      sessionFileOverrides.set(sessionKey, sessionFile);
      sessionIdOverrides.set(sessionKey, sessionId ?? resolveSessionIdFromFile(sessionFile, sessionId));
    } else if (sessionId) {
      sessionIdOverrides.set(sessionKey, sessionId);
    }
  });

  const expandedCache = new Map<string, TimelineEvent[]>();

  const expandSessionEvents = async (
    sessionKey: string,
    ancestry: Set<string>,
  ): Promise<TimelineEvent[]> => {
    if (expandedCache.has(sessionKey)) {
      return expandedCache.get(sessionKey) ?? [];
    }
    let events: TimelineEvent[] = [];
    const sessionEntry = sessionsByKey.get(sessionKey);
    if (sessionEntry) {
      events = sessionKey === session.key ? rootTranscriptEvents : await loadTranscriptEvents({ session: sessionEntry });
    } else if (sessionFileOverrides.has(sessionKey)) {
      const sessionFile = sessionFileOverrides.get(sessionKey)!;
      const sessionId = sessionIdOverrides.get(sessionKey) ?? resolveSessionIdFromFile(sessionFile, sessionKey);
      events = await parseSessionTranscript({
        sessionFile,
        sessionKey,
        sessionId,
      });
    } else {
      return [];
    }
    const expanded: TimelineEvent[] = [];
    for (const event of events) {
      if (!isSessionsSpawnEvent(event)) {
        expanded.push(event);
        continue;
      }
      const spawn = extractSpawnInfo(event);
      const childKey = spawn.childSessionKey;
      let children: TimelineEvent[] = [];
      if (childKey && !ancestry.has(childKey)) {
        const nextAncestry = new Set(ancestry);
        nextAncestry.add(childKey);
        children = await expandSessionEvents(childKey, nextAncestry);
      }
      const run = childKey ? runByChildSession.get(childKey) : undefined;
      expanded.push(
        buildSubagentEvent({
          event,
          spawn,
          run,
          children,
        }),
      );
    }
    expandedCache.set(sessionKey, expanded);
    return expanded;
  };

  const [transcriptEvents, agentEvents] = await Promise.all([
    expandSessionEvents(session.key, new Set([session.key])),
    loadCapturedAgentEvents({ stateDir, sessionKey: session.key }),
  ]);

  const agentTimeline = capturedEventsToTimeline(agentEvents, session.key, session.sessionId);

  const events = [...transcriptEvents, ...agentTimeline].sort((a, b) => a.ts - b.ts);
  return { session, events };
}

export async function getTasks(params?: {
  stateDir?: string;
  sessionKey?: string;
}): Promise<TaskRecord[]> {
  const stateDir = params?.stateDir ?? resolveOpenClawStateDir();
  const tasks = await loadTaskRecords(stateDir);
  const sessionKey = params?.sessionKey?.trim();
  const filtered = sessionKey ? tasks.filter((task) => task.sessionKey === sessionKey) : tasks;
  return filtered.sort((a, b) => a.startTs - b.startTs);
}

export async function getAnalyses(params?: {
  stateDir?: string;
  taskIds?: string[];
}): Promise<TaskAnalysisRecord[]> {
  const stateDir = params?.stateDir ?? resolveOpenClawStateDir();
  const records = await loadAnalysisRecords(stateDir);
  if (!params?.taskIds || params.taskIds.length === 0) {
    return records;
  }
  const ids = new Set(params.taskIds);
  return records.filter((record) => ids.has(record.taskId));
}
