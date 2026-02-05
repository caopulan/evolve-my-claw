import fs from "node:fs";
import path from "node:path";
import { resolveOpenClawStateDir, resolveTelemetryDir } from "./paths.js";

export type EvolveConfig = {
  excludeAgentIds: string[];
  excludeTools: string[];
};

const DEFAULT_CONFIG: EvolveConfig = {
  excludeAgentIds: ["evolver"],
  excludeTools: ["message/send", "message/thread-reply"],
};

function normalizeList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const trimmed = entry.trim();
    if (trimmed) {
      out.push(trimmed);
    }
  }
  return out.length > 0 ? out : [...fallback];
}

export function resolveConfigPath(stateDir = resolveOpenClawStateDir()): string {
  return path.join(resolveTelemetryDir(stateDir), "config.json");
}

export function loadConfig(params?: { stateDir?: string; configPath?: string }): EvolveConfig {
  const stateDir = params?.stateDir ?? resolveOpenClawStateDir();
  const configPath = params?.configPath ?? resolveConfigPath(stateDir);
  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<EvolveConfig>;
    return {
      excludeAgentIds: normalizeList(parsed.excludeAgentIds, DEFAULT_CONFIG.excludeAgentIds),
      excludeTools: normalizeList(parsed.excludeTools, DEFAULT_CONFIG.excludeTools),
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
