import fs from "node:fs";
import path from "node:path";
import { resolveOpenClawStateDir, resolveTelemetryDir } from "./paths.js";
import { EVOLUTION_AGENT_ID } from "./evolution/constants.js";

export type EvolveConfig = {
  excludeAgentIds: string[];
  excludeTools: string[];
  analysisAgentId: string;
  analysisTimeoutSeconds: number;
};

const DEFAULT_CONFIG: EvolveConfig = {
  excludeAgentIds: [EVOLUTION_AGENT_ID, "evolver"],
  excludeTools: ["message/send", "message/thread-reply"],
  analysisAgentId: EVOLUTION_AGENT_ID,
  analysisTimeoutSeconds: 120,
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
    const timeoutRaw = Number(parsed.analysisTimeoutSeconds);
    const timeout = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? Math.floor(timeoutRaw) : undefined;
    return {
      excludeAgentIds: normalizeList(parsed.excludeAgentIds, DEFAULT_CONFIG.excludeAgentIds),
      excludeTools: normalizeList(parsed.excludeTools, DEFAULT_CONFIG.excludeTools),
      analysisAgentId:
        typeof parsed.analysisAgentId === "string" && parsed.analysisAgentId.trim()
          ? parsed.analysisAgentId.trim()
          : DEFAULT_CONFIG.analysisAgentId,
      analysisTimeoutSeconds: timeout ?? DEFAULT_CONFIG.analysisTimeoutSeconds,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
