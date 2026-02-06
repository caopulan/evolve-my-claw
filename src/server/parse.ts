import { loadConfig } from "../config.js";
import { parseSessionTranscript } from "../ingest/session-transcript.js";
import { listSessions } from "../ingest/session-store.js";
import { buildTaskCandidates, mergeSubagentCandidates, type TaskCandidateRecord } from "../tasks/task-parser.js";
import { appendTaskRecords, loadTaskIndex } from "../tasks/task-store.js";

export type ParseTasksResult = {
  sessionCount: number;
  candidateCount: number;
  mergedCount: number;
  newCount: number;
  existingCount: number;
  appended: number;
  durationMs: number;
};

export async function parseTasks(stateDir: string): Promise<ParseTasksResult> {
  const startedAt = Date.now();
  const config = loadConfig({ stateDir });
  const excludeIds = new Set(config.excludeAgentIds.map((id) => id.toLowerCase()));
  const sessions = listSessions(stateDir).filter(
    (session) => !excludeIds.has(session.agentId.toLowerCase()),
  );

  const existing = await loadTaskIndex(stateDir);
  const pending: TaskCandidateRecord[] = [];
  const allCandidates: TaskCandidateRecord[] = [];

  let sessionCount = 0;
  let candidateCount = 0;
  let skipped = 0;

  for (const session of sessions) {
    sessionCount += 1;
    const events = await parseSessionTranscript({
      sessionFile: session.sessionFile ?? "",
      sessionKey: session.key,
      sessionId: session.sessionId,
    });
    const candidates = buildTaskCandidates({ session, events, config });
    candidateCount += candidates.length;
    allCandidates.push(...candidates);
  }

  const mergedCandidates = mergeSubagentCandidates(allCandidates);
  for (const candidate of mergedCandidates) {
    if (existing.has(candidate.taskId)) {
      skipped += 1;
      continue;
    }
    pending.push(candidate);
    existing.add(candidate.taskId);
  }

  const appended = appendTaskRecords(pending, stateDir);

  return {
    sessionCount,
    candidateCount,
    mergedCount: mergedCandidates.length,
    newCount: pending.length,
    existingCount: skipped,
    appended,
    durationMs: Date.now() - startedAt,
  };
}
