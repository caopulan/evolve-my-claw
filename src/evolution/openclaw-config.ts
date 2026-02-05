import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSON5 from "json5";

export type OpenClawConfigRecord = Record<string, unknown>;

const LEGACY_CONFIG_NAMES = ["clawdbot.json", "moltbot.json", "moldbot.json"] as const;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function normalizeAgentId(value: string): string {
  return value.trim().toLowerCase();
}

export function resolveUserPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (trimmed.startsWith("~")) {
    return path.resolve(trimmed.replace(/^~(?=$|[\\/])/, os.homedir()));
  }
  return path.resolve(trimmed);
}

export function resolveOpenClawConfigPath(stateDir: string, configPath?: string): string {
  if (configPath && configPath.trim()) {
    return resolveUserPath(configPath);
  }
  const envOverride =
    process.env.OPENCLAW_CONFIG_PATH?.trim() || process.env.CLAWDBOT_CONFIG_PATH?.trim();
  if (envOverride) {
    return resolveUserPath(envOverride);
  }
  const candidates = [
    path.join(stateDir, "openclaw.json"),
    ...LEGACY_CONFIG_NAMES.map((name) => path.join(stateDir, name)),
  ];
  const existing = candidates.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  });
  return existing ?? candidates[0];
}

export function loadOpenClawConfig(configPath: string): { config: OpenClawConfigRecord; raw?: string } {
  if (!fs.existsSync(configPath)) {
    return { config: {} };
  }
  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = JSON5.parse(raw) as unknown;
  const config = asRecord(parsed) ?? {};
  return { config, raw };
}

export function writeOpenClawConfig(params: {
  configPath: string;
  config: OpenClawConfigRecord;
}): { backupPath?: string } {
  const { configPath, config } = params;
  let backupPath: string | undefined;
  if (fs.existsSync(configPath)) {
    backupPath = `${configPath}.bak.evolve-my-claw.${Date.now()}`;
    fs.copyFileSync(configPath, backupPath);
  }
  const serialized = `${JSON.stringify(config, null, 2)}\n`;
  fs.writeFileSync(configPath, serialized, "utf8");
  return { backupPath };
}

function resolveAgentsSection(config: OpenClawConfigRecord): Record<string, unknown> {
  const agents = asRecord(config.agents);
  if (agents) {
    return agents;
  }
  const fresh: Record<string, unknown> = {};
  config.agents = fresh;
  return fresh;
}

function resolveAgentList(agents: Record<string, unknown>): Array<Record<string, unknown>> {
  if (!Array.isArray(agents.list)) {
    return [];
  }
  return agents.list.filter((entry) => asRecord(entry)) as Array<Record<string, unknown>>;
}

export function resolveDefaultAgentId(config: OpenClawConfigRecord): string {
  const agents = asRecord(config.agents);
  const list = agents ? resolveAgentList(agents) : [];
  if (list.length === 0) {
    return "main";
  }
  const defaultEntry = list.find((entry) => entry.default === true);
  const idRaw = asString(defaultEntry?.id ?? list[0]?.id) ?? "main";
  return normalizeAgentId(idRaw);
}

export function resolveAgentWorkspaceDir(
  config: OpenClawConfigRecord,
  agentId: string,
): string {
  const normalized = normalizeAgentId(agentId);
  const agents = asRecord(config.agents);
  const list = agents ? resolveAgentList(agents) : [];
  const entry = list.find((item) => normalizeAgentId(asString(item.id) ?? "") === normalized);
  const entryWorkspace = asString(entry?.workspace);
  if (entryWorkspace) {
    return resolveUserPath(entryWorkspace);
  }
  const defaultAgentId = resolveDefaultAgentId(config);
  if (normalized === defaultAgentId) {
    const defaults = agents ? asRecord(agents.defaults) : undefined;
    const defaultWorkspace = asString(defaults?.workspace);
    if (defaultWorkspace) {
      return resolveUserPath(defaultWorkspace);
    }
    return path.join(os.homedir(), ".openclaw", "workspace");
  }
  return path.join(os.homedir(), ".openclaw", `workspace-${normalized}`);
}

export function resolveAgentDir(
  config: OpenClawConfigRecord,
  agentId: string,
  stateDir: string,
): string {
  const normalized = normalizeAgentId(agentId);
  const agents = asRecord(config.agents);
  const list = agents ? resolveAgentList(agents) : [];
  const entry = list.find((item) => normalizeAgentId(asString(item.id) ?? "") === normalized);
  const entryDir = asString(entry?.agentDir);
  if (entryDir) {
    return resolveUserPath(entryDir);
  }
  return path.join(stateDir, "agents", normalized, "agent");
}

export function listAgentWorkspaces(config: OpenClawConfigRecord): Map<string, string> {
  const agents = resolveAgentsSection(config);
  const list = resolveAgentList(agents);
  const ids = list.length > 0 ? list : [{ id: "main" }];
  const result = new Map<string, string>();
  for (const entry of ids) {
    const id = normalizeAgentId(asString(entry.id) ?? "main");
    result.set(id, resolveAgentWorkspaceDir(config, id));
  }
  return result;
}
