import fs from "node:fs";
import readline from "node:readline";
import { ensureDir, resolveOpenClawStateDir, resolveTelemetryDir } from "../paths.js";
import type { EvolutionReportRecord } from "./types.js";

export function resolveEvolutionReportPath(stateDir = resolveOpenClawStateDir()): string {
  return `${resolveTelemetryDir(stateDir)}/evolution.reports.jsonl`;
}

export function appendEvolutionReports(
  records: EvolutionReportRecord[],
  stateDir = resolveOpenClawStateDir(),
): number {
  if (records.length === 0) {
    return 0;
  }
  const telemetryDir = resolveTelemetryDir(stateDir);
  ensureDir(telemetryDir);
  const filePath = resolveEvolutionReportPath(stateDir);
  const lines = records.map((record) => `${JSON.stringify(record)}\n`).join("");
  fs.appendFileSync(filePath, lines, "utf8");
  return records.length;
}

export async function loadEvolutionReports(
  stateDir = resolveOpenClawStateDir(),
): Promise<EvolutionReportRecord[]> {
  const filePath = resolveEvolutionReportPath(stateDir);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const records: EvolutionReportRecord[] = [];
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as EvolutionReportRecord;
      if (parsed?.reportId) {
        records.push(parsed);
      }
    } catch {
      // ignore
    }
  }
  return records;
}

export async function loadEvolutionReportById(
  reportId: string,
  stateDir = resolveOpenClawStateDir(),
): Promise<EvolutionReportRecord | undefined> {
  const records = await loadEvolutionReports(stateDir);
  return records.find((record) => record.reportId === reportId);
}
