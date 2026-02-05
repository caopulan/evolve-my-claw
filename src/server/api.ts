import fs from "node:fs";
import type { TimelineEvent } from "../ingest/session-transcript.js";
import { parseSessionTranscript } from "../ingest/session-transcript.js";
import { listSessions, type SessionIndexEntry } from "../ingest/session-store.js";
import { loadSubagentRuns, subagentRunsToEvents } from "../ingest/subagents.js";
import { capturedEventsToTimeline, loadCapturedAgentEvents } from "../ingest/agent-events.js";
import { resolveOpenClawStateDir } from "../paths.js";
import { loadTaskRecords, type TaskRecord } from "../tasks/task-store.js";

const transcriptCache = new Map<string, { mtimeMs: number; events: TimelineEvent[] }>();

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

  const [transcriptEvents, agentEvents] = await Promise.all([
    loadTranscriptEvents({ session }),
    loadCapturedAgentEvents({ stateDir, sessionKey: session.key }),
  ]);

  const subagentEvents = subagentRunsToEvents(
    loadSubagentRuns(stateDir).filter((run) => run.requesterSessionKey === session.key),
  );

  const agentTimeline = capturedEventsToTimeline(agentEvents, session.key, session.sessionId);

  const events = [...transcriptEvents, ...subagentEvents, ...agentTimeline].sort((a, b) => a.ts - b.ts);
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
