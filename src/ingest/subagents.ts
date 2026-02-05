import fs from "node:fs";
import { resolveOpenClawStateDir, resolveSubagentRegistryPath } from "../paths.js";
import type { TimelineEvent } from "./session-transcript.js";

export type SubagentRunRecord = {
  runId: string;
  childSessionKey: string;
  requesterSessionKey: string;
  task: string;
  label?: string;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  outcome?: { status: string; error?: string };
};

export function loadSubagentRuns(stateDir = resolveOpenClawStateDir()): SubagentRunRecord[] {
  const registryPath = resolveSubagentRegistryPath(stateDir);
  try {
    const raw = fs.readFileSync(registryPath, "utf8");
    const parsed = JSON.parse(raw) as { runs?: Record<string, SubagentRunRecord> };
    if (!parsed?.runs || typeof parsed.runs !== "object") {
      return [];
    }
    return Object.values(parsed.runs).filter((entry) => entry && typeof entry === "object");
  } catch {
    return [];
  }
}

export function subagentRunsToEvents(runs: SubagentRunRecord[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const run of runs) {
    const start = run.startedAt ?? run.createdAt;
    const end = run.endedAt ?? start;
    const durationMs = end >= start ? end - start : undefined;
    const summary = run.label ? `${run.label}` : run.task;
    events.push({
      id: `subagent-${run.runId}`,
      ts: start,
      kind: "subagent_run",
      sessionKey: run.requesterSessionKey,
      sessionId: run.requesterSessionKey,
      runId: run.runId,
      durationMs,
      summary,
      details: {
        childSessionKey: run.childSessionKey,
        task: run.task,
        label: run.label,
        outcome: run.outcome,
        endedAt: run.endedAt,
      },
    });
  }
  return events;
}
