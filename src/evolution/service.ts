import path from "node:path";
import { GatewayCaptureClient } from "../gateway/client.js";
import { loadConfig as loadEvolveConfig } from "../config.js";
import { resolveOpenClawStateDir } from "../paths.js";
import { loadTaskRecords, type TaskRecord } from "../tasks/task-store.js";
import { ensureEvolutionAgent } from "./ensure-agent.js";
import { analyzeEvolutionReport } from "./evolution-analyzer.js";
import {
  EVOLUTION_CHANGE_TARGETS,
  EVOLUTION_DIMENSIONS,
  type EvolutionChangeTarget,
  type EvolutionDimension,
  type EvolutionReportRecord,
} from "./types.js";
import { appendEvolutionReports, loadEvolutionReports } from "./report-store.js";
import {
  listAgentWorkspaces,
  loadOpenClawConfig,
  resolveOpenClawConfigPath,
  type OpenClawConfigRecord,
} from "./openclaw-config.js";

const DEFAULT_GATEWAY_PORT = 18789;

function parseDimensions(input: unknown): EvolutionDimension[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const allowed = new Set(EVOLUTION_DIMENSIONS);
  const out: EvolutionDimension[] = [];
  for (const entry of input) {
    const value = typeof entry === "string" ? entry.trim() : "";
    if (value && allowed.has(value as EvolutionDimension)) {
      out.push(value as EvolutionDimension);
    }
  }
  return out;
}

function parseChangeTargets(input: unknown): EvolutionChangeTarget[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const allowed = new Set(EVOLUTION_CHANGE_TARGETS);
  const out: EvolutionChangeTarget[] = [];
  for (const entry of input) {
    const value = typeof entry === "string" ? entry.trim() : "";
    if (value && allowed.has(value as EvolutionChangeTarget)) {
      out.push(value as EvolutionChangeTarget);
    }
  }
  return out;
}

function resolveGatewayUrl(cfg: OpenClawConfigRecord): string {
  const gateway = (cfg.gateway ?? {}) as Record<string, unknown>;
  const portRaw = gateway.port;
  const port =
    typeof portRaw === "number" && Number.isFinite(portRaw) ? Math.floor(portRaw) : DEFAULT_GATEWAY_PORT;
  return `ws://127.0.0.1:${port}`;
}

function resolveGatewayAuth(cfg: OpenClawConfigRecord): { token?: string; password?: string } {
  const gateway = (cfg.gateway ?? {}) as Record<string, unknown>;
  const auth = (gateway.auth ?? {}) as Record<string, unknown>;
  const token = typeof auth.token === "string" ? auth.token : undefined;
  const password = typeof auth.password === "string" ? auth.password : undefined;
  return { token, password };
}

function matchReportTasks(report: EvolutionReportRecord, taskIds: string[]): boolean {
  if (taskIds.length === 0) {
    return true;
  }
  if (report.taskIds.length !== taskIds.length) {
    return false;
  }
  const requested = new Set(taskIds);
  return report.taskIds.every((id) => requested.has(id));
}

export async function getEvolutionReports(params: {
  stateDir?: string;
  taskIds?: string[];
}): Promise<EvolutionReportRecord[]> {
  const stateDir = params.stateDir ?? resolveOpenClawStateDir();
  const records = await loadEvolutionReports(stateDir);
  const taskIds = params.taskIds ?? [];
  const filtered = taskIds.length ? records.filter((record) => matchReportTasks(record, taskIds)) : records;
  return filtered.sort((a, b) => b.createdAt - a.createdAt);
}

function resolveAllowedPaths(cfg: OpenClawConfigRecord, stateDir: string): string[] {
  const workspaceEntries = Array.from(listAgentWorkspaces(cfg).entries()).map(([agentId, dir]) => ({
    agentId,
    path: dir,
  }));
  const hooksDir = path.join(stateDir, "hooks");
  const skillsDir = path.join(stateDir, "skills");
  return [
    ...workspaceEntries.map((entry) => entry.path),
    hooksDir,
    skillsDir,
  ];
}

function resolveWorkspacePaths(cfg: OpenClawConfigRecord) {
  return Array.from(listAgentWorkspaces(cfg).entries()).map(([agentId, dir]) => ({
    agentId,
    path: dir,
  }));
}

async function loadTasksByIds(stateDir: string, taskIds: string[]): Promise<TaskRecord[]> {
  const all = await loadTaskRecords(stateDir);
  const requested = new Set(taskIds);
  return all.filter((task) => requested.has(task.taskId));
}

export async function runEvolutionAnalysis(params: {
  stateDir?: string;
  evolveConfigPath?: string;
  openclawConfigPath?: string;
  taskIds: string[];
  dimensions: EvolutionDimension[];
  changeTargets: EvolutionChangeTarget[];
  analysisAgentId: string;
}): Promise<EvolutionReportRecord> {
  const stateDir = params.stateDir ?? resolveOpenClawStateDir();
  const evolveConfigPath = params.evolveConfigPath ? path.resolve(params.evolveConfigPath) : undefined;
  const evolveConfig = loadEvolveConfig({ stateDir, configPath: evolveConfigPath });
  const timeoutSeconds = evolveConfig.analysisTimeoutSeconds ?? 120;

  const openclawConfigPath = resolveOpenClawConfigPath(stateDir, params.openclawConfigPath);
  ensureEvolutionAgent({ stateDir, configPath: openclawConfigPath });

  const { config: openclawConfig } = loadOpenClawConfig(openclawConfigPath);
  const tasks = await loadTasksByIds(stateDir, params.taskIds);
  if (tasks.length === 0) {
    throw new Error("no matching tasks found");
  }

  const allowedPaths = resolveAllowedPaths(openclawConfig, stateDir);
  const workspacePaths = resolveWorkspacePaths(openclawConfig);
  const hooksDir = path.join(stateDir, "hooks");
  const skillsDir = path.join(stateDir, "skills");

  let readyResolve: (() => void) | undefined;
  let readyReject: ((err: Error) => void) | undefined;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  const gatewayUrl = resolveGatewayUrl(openclawConfig);
  const auth = resolveGatewayAuth(openclawConfig);
  const client = new GatewayCaptureClient({
    url: gatewayUrl,
    token: auth.token,
    password: auth.password,
    stateDir,
    onHello: () => readyResolve?.(),
    onError: (err) => {
      readyReject?.(err);
    },
  });

  client.start();
  try {
    await ready;
    const report = await analyzeEvolutionReport({
      tasks,
      client,
      analysisAgentId: params.analysisAgentId,
      timeoutSeconds,
      dimensions: params.dimensions,
      changeTargets: params.changeTargets,
      allowedPaths,
      openclawConfigPath,
      workspacePaths,
      hooksDir,
      skillsDir,
    });
    appendEvolutionReports([report], stateDir);
    return report;
  } finally {
    client.stop();
  }
}

export { parseDimensions, parseChangeTargets };
