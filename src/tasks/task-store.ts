import fs from "node:fs";
import readline from "node:readline";
import { ensureDir, resolveOpenClawStateDir, resolveTelemetryDir } from "../paths.js";
import type { TaskCandidateRecord } from "./task-parser.js";

export type TaskRecord = TaskCandidateRecord;

function isNonEmptyTaskRecord(record: TaskRecord | undefined | null): record is TaskRecord {
  if (!record || typeof record !== "object") {
    return false;
  }
  if (!record.taskId) {
    return false;
  }
  if (!Array.isArray(record.toolCalls) || record.toolCalls.length === 0) {
    return false;
  }
  return true;
}

export function resolveTaskStorePath(stateDir = resolveOpenClawStateDir()): string {
  return `${resolveTelemetryDir(stateDir)}/tasks.jsonl`;
}

export async function loadTaskRecords(stateDir = resolveOpenClawStateDir()): Promise<TaskRecord[]> {
  const filePath = resolveTaskStorePath(stateDir);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const records: TaskRecord[] = [];
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as TaskRecord;
      if (parsed?.taskId) {
        records.push(parsed);
      }
    } catch {
      // ignore
    }
  }
  return records;
}

export async function loadTaskIndex(stateDir = resolveOpenClawStateDir()): Promise<Set<string>> {
  const filePath = resolveTaskStorePath(stateDir);
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
      const parsed = JSON.parse(trimmed) as TaskRecord;
      if (parsed?.taskId) {
        ids.add(parsed.taskId);
      }
    } catch {
      // ignore
    }
  }
  return ids;
}

export async function loadTaskSessionIndex(
  stateDir = resolveOpenClawStateDir(),
): Promise<{ sessionKeys: Set<string>; total: number }> {
  const filePath = resolveTaskStorePath(stateDir);
  if (!fs.existsSync(filePath)) {
    return { sessionKeys: new Set(), total: 0 };
  }
  const sessionKeys = new Set<string>();
  let total = 0;
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as TaskRecord;
      if (isNonEmptyTaskRecord(parsed)) {
        total += 1;
        if (typeof parsed.sessionKey === "string" && parsed.sessionKey.trim()) {
          sessionKeys.add(parsed.sessionKey.trim());
        }
      }
    } catch {
      // ignore
    }
  }
  return { sessionKeys, total };
}

export function appendTaskRecords(records: TaskRecord[], stateDir = resolveOpenClawStateDir()): number {
  if (records.length === 0) {
    return 0;
  }
  const telemetryDir = resolveTelemetryDir(stateDir);
  ensureDir(telemetryDir);
  const filePath = resolveTaskStorePath(stateDir);
  const lines = records.map((record) => `${JSON.stringify(record)}\n`).join("");
  fs.appendFileSync(filePath, lines, "utf8");
  return records.length;
}
