import fs from "node:fs";
import readline from "node:readline";
import { ensureDir, resolveOpenClawStateDir, resolveTelemetryDir } from "../paths.js";

export type TaskAnalysisRecord = {
  type: "task_analysis";
  analysisId: string;
  createdAt: number;
  analysisVersion: number;
  analysisAgentId: string;
  taskId: string;
  sessionKey: string;
  sessionId: string;
  agentId: string;
  userMessage: string;
  startTs: number;
  endTs?: number;
  durationMs?: number;
  toolSummary: Array<{ tool: string; count: number; errors: number }>;
  analysis?: Record<string, unknown>;
  rawResponse?: string;
  parseError?: string;
};

export const ANALYSIS_VERSION = 1;

export function resolveAnalysisPath(stateDir = resolveOpenClawStateDir()): string {
  return `${resolveTelemetryDir(stateDir)}/tasks.analysis.jsonl`;
}

export async function loadAnalysisIndex(stateDir = resolveOpenClawStateDir()): Promise<Set<string>> {
  const filePath = resolveAnalysisPath(stateDir);
  if (!fs.existsSync(filePath)) {
    return new Set();
  }
  const ids = new Set<string>();
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as { taskId?: unknown };
      if (typeof parsed.taskId === "string") {
        ids.add(parsed.taskId);
      }
    } catch {
      // ignore
    }
  }
  return ids;
}

export function appendAnalysisRecords(
  records: TaskAnalysisRecord[],
  stateDir = resolveOpenClawStateDir(),
): number {
  if (records.length === 0) {
    return 0;
  }
  const telemetryDir = resolveTelemetryDir(stateDir);
  ensureDir(telemetryDir);
  const filePath = resolveAnalysisPath(stateDir);
  const lines = records.map((record) => `${JSON.stringify(record)}\n`).join("");
  fs.appendFileSync(filePath, lines, "utf8");
  return records.length;
}
