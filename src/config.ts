import fs from "node:fs";
import path from "node:path";
import { resolveOpenClawStateDir, resolveTelemetryDir } from "./paths.js";
import { EVOLUTION_AGENT_ID } from "./evolution/constants.js";
import {
  EVOLUTION_CHANGE_TARGETS,
  EVOLUTION_DIMENSIONS,
  type EvolutionChangeTargetId,
  type EvolutionDimensionId,
} from "./evolution/analysis-options.js";

export type EvolveConfig = {
  excludeAgentIds: string[];
  excludeTools: string[];
  analysisAgentId: string;
  analysisTimeoutSeconds: number;
  evolutionAnalysis: EvolutionAnalysisConfig;
};

export type EvolutionAnalysisConfig = {
  scopeDays: number;
  agentIds: string[];
  focus: string[];
  dimensions: EvolutionDimensionId[];
  changeTargets: EvolutionChangeTargetId[];
  useSearch: boolean;
};

const DEFAULT_CONFIG: EvolveConfig = {
  excludeAgentIds: [EVOLUTION_AGENT_ID, "evolver"],
  excludeTools: ["message/send", "message/thread-reply"],
  analysisAgentId: EVOLUTION_AGENT_ID,
  analysisTimeoutSeconds: 120,
  evolutionAnalysis: {
    scopeDays: 5,
    agentIds: [],
    focus: [],
    dimensions: [...EVOLUTION_DIMENSIONS],
    changeTargets: [...EVOLUTION_CHANGE_TARGETS],
    useSearch: false,
  },
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

function normalizeStringList(value: unknown, fallback: string[]): string[] {
  if (typeof value === "string") {
    const split = value.split(",").map((entry) => entry.trim()).filter(Boolean);
    return split.length > 0 ? split : [...fallback];
  }
  return normalizeList(value, fallback);
}

function normalizePositiveInt(value: unknown, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return fallback;
  }
  return Math.floor(num);
}

function normalizeAllowedList<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T[],
): T[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const allow = new Set(allowed);
  const out: T[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const trimmed = entry.trim();
    if (trimmed && allow.has(trimmed as T)) {
      out.push(trimmed as T);
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
    const analysisRaw =
      parsed.evolutionAnalysis && typeof parsed.evolutionAnalysis === "object"
        ? (parsed.evolutionAnalysis as Partial<EvolutionAnalysisConfig>)
        : {};
    const analysisDefaults = DEFAULT_CONFIG.evolutionAnalysis;
    return {
      excludeAgentIds: normalizeList(parsed.excludeAgentIds, DEFAULT_CONFIG.excludeAgentIds),
      excludeTools: normalizeList(parsed.excludeTools, DEFAULT_CONFIG.excludeTools),
      analysisAgentId:
        typeof parsed.analysisAgentId === "string" && parsed.analysisAgentId.trim()
          ? parsed.analysisAgentId.trim()
          : DEFAULT_CONFIG.analysisAgentId,
      analysisTimeoutSeconds: timeout ?? DEFAULT_CONFIG.analysisTimeoutSeconds,
      evolutionAnalysis: {
        scopeDays: normalizePositiveInt(analysisRaw.scopeDays, analysisDefaults.scopeDays),
        agentIds: normalizeStringList(analysisRaw.agentIds, analysisDefaults.agentIds),
        focus: normalizeStringList(analysisRaw.focus, analysisDefaults.focus),
        dimensions: normalizeAllowedList(
          analysisRaw.dimensions,
          EVOLUTION_DIMENSIONS,
          analysisDefaults.dimensions,
        ),
        changeTargets: normalizeAllowedList(
          analysisRaw.changeTargets,
          EVOLUTION_CHANGE_TARGETS,
          analysisDefaults.changeTargets,
        ),
        useSearch: analysisRaw.useSearch === true ? true : analysisDefaults.useSearch,
      },
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
