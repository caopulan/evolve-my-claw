import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSON5 from "json5";
import { resolveOpenClawStateDir } from "../paths.js";
import { EVOLUTION_AGENT_ID, EVOLUTION_AGENT_NAME } from "./constants.js";

type EnsureEvolutionAgentParams = {
  stateDir?: string;
  configPath?: string;
  sourceAgentId?: string;
  copySkills?: boolean;
};

type EnsureEvolutionAgentResult = {
  agentId: string;
  configPath: string;
  updatedConfig: boolean;
  configBackupPath?: string;
  workspaceDir: string;
  agentDir: string;
  createdWorkspace: boolean;
  createdAgentDir: boolean;
  createdFiles: string[];
  copiedFiles: string[];
  copiedAuthProfiles: boolean;
  copiedModels: boolean;
  copiedSkillsDir: boolean;
  notes: string[];
};

const LEGACY_CONFIG_NAMES = ["clawdbot.json", "moltbot.json", "moldbot.json"] as const;
const WORKSPACE_FILES = [
  "AGENTS.md",
  "SOUL.md",
  "TOOLS.md",
  "IDENTITY.md",
  "USER.md",
  "HEARTBEAT.md",
] as const;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeAgentId(value: string): string {
  return value.trim().toLowerCase();
}

function resolveUserPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (trimmed.startsWith("~")) {
    return path.resolve(trimmed.replace(/^~(?=$|[\\/])/, os.homedir()));
  }
  return path.resolve(trimmed);
}

function resolveOpenClawConfigPath(stateDir: string, configPath?: string): string {
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

function loadOpenClawConfig(configPath: string): { config: Record<string, unknown>; raw?: string } {
  if (!fs.existsSync(configPath)) {
    return { config: {} };
  }
  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = JSON5.parse(raw) as unknown;
  const config = asRecord(parsed) ?? {};
  return { config, raw };
}

function resolveAgentsSection(config: Record<string, unknown>): Record<string, unknown> {
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

function resolveDefaultAgentId(config: Record<string, unknown>): string {
  const agents = asRecord(config.agents);
  const list = agents ? resolveAgentList(agents) : [];
  if (list.length === 0) {
    return "main";
  }
  const defaultEntry = list.find((entry) => entry.default === true);
  const idRaw = asString(defaultEntry?.id ?? list[0]?.id) ?? "main";
  return normalizeAgentId(idRaw);
}

function resolveAgentWorkspaceDir(
  config: Record<string, unknown>,
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

function resolveAgentDir(
  config: Record<string, unknown>,
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

function pathsEqual(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

function ensureEvolutionAgentConfig(params: {
  config: Record<string, unknown>;
  stateDir: string;
}): { config: Record<string, unknown>; changed: boolean } {
  const { config, stateDir } = params;
  const agents = resolveAgentsSection(config);
  let list = resolveAgentList(agents);
  let changed = false;

  if (list.length === 0) {
    list = [{ id: "main", default: true }];
    changed = true;
  }

  const defaultAgentId = resolveDefaultAgentId(config);
  const defaultWorkspace = resolveAgentWorkspaceDir(config, defaultAgentId);
  const defaultAgentDir = resolveAgentDir(config, defaultAgentId, stateDir);
  const desiredWorkspace = path.join(os.homedir(), ".openclaw", `workspace-${EVOLUTION_AGENT_ID}`);
  const desiredAgentDir = path.join(stateDir, "agents", EVOLUTION_AGENT_ID, "agent");

  const match = list.find(
    (entry) => normalizeAgentId(asString(entry.id) ?? "") === EVOLUTION_AGENT_ID,
  );

  const entry = match ?? {};
  const entryId = asString(entry.id);
  if (!entryId || normalizeAgentId(entryId) !== EVOLUTION_AGENT_ID) {
    entry.id = EVOLUTION_AGENT_ID;
    changed = true;
  }
  if (!asString(entry.name)) {
    entry.name = EVOLUTION_AGENT_NAME;
    changed = true;
  }

  const currentWorkspaceRaw = asString(entry.workspace);
  const currentWorkspace = currentWorkspaceRaw ? resolveUserPath(currentWorkspaceRaw) : undefined;
  if (!currentWorkspace || pathsEqual(currentWorkspace, defaultWorkspace)) {
    entry.workspace = desiredWorkspace;
    changed = true;
  }

  const currentAgentDirRaw = asString(entry.agentDir);
  const currentAgentDir = currentAgentDirRaw ? resolveUserPath(currentAgentDirRaw) : undefined;
  if (!currentAgentDir || pathsEqual(currentAgentDir, defaultAgentDir)) {
    entry.agentDir = desiredAgentDir;
    changed = true;
  }

  const tools = asRecord(entry.tools) ?? {};
  const allowList = Array.isArray(tools.allow) ? tools.allow : undefined;
  const allowChanged = !allowList || allowList.length !== 1 || allowList[0] !== "*";
  if (allowChanged) {
    tools.allow = ["*"];
    changed = true;
  }
  if (tools.deny) {
    delete tools.deny;
    changed = true;
  }
  if (tools.alsoAllow) {
    delete tools.alsoAllow;
    changed = true;
  }
  entry.tools = tools;

  if ("skills" in entry) {
    delete entry.skills;
    changed = true;
  }

  if (!match) {
    list.push(entry);
    changed = true;
  }

  agents.list = list;
  config.agents = agents;

  return { config, changed };
}

function defaultAgentsFileContent(name: (typeof WORKSPACE_FILES)[number]): string {
  switch (name) {
    case "AGENTS.md":
      return [
        "# AGENTS.md - Evolve My Claw",
        "",
        "This workspace powers the evolve-my-claw analysis agent.",
        "",
        "Primary focus:",
        "- Analyze OpenClaw task candidates and return structured JSON when requested.",
        "- Support evolution tooling and telemetry workflows.",
        "",
        "Guidelines:",
        "- Be concise and precise.",
        "- Prefer deterministic outputs over speculation.",
        "- Use tools only when necessary.",
        "",
      ].join("\n");
    case "SOUL.md":
      return ["# SOUL.md", "", "Calm, analytical, task-first.", ""].join("\n");
    case "TOOLS.md":
      return [
        "# TOOLS.md",
        "",
        "This agent can use the full OpenClaw tool surface when needed.",
        "Prefer minimal, targeted tool usage.",
        "",
      ].join("\n");
    case "IDENTITY.md":
      return [
        "# IDENTITY.md",
        "",
        "Name: Evolve My Claw",
        "Role: Evolution analysis agent",
        "",
      ].join("\n");
    case "USER.md":
      return [
        "# USER.md",
        "",
        "The user is the OpenClaw operator and maintainer of evolve-my-claw.",
        "Ask concise clarification questions when needed.",
        "",
      ].join("\n");
    case "HEARTBEAT.md":
      return ["# HEARTBEAT.md", "", "Check for queued evolution tasks.", ""].join("\n");
  }
}

function ensureWorkspaceFiles(params: {
  workspaceDir: string;
  sourceWorkspaceDir?: string;
  copySkills?: boolean;
}): {
  createdWorkspace: boolean;
  createdFiles: string[];
  copiedFiles: string[];
  copiedSkillsDir: boolean;
} {
  const { workspaceDir, sourceWorkspaceDir, copySkills } = params;
  const createdFiles: string[] = [];
  const copiedFiles: string[] = [];
  const workspaceExists = fs.existsSync(workspaceDir);
  if (!workspaceExists) {
    fs.mkdirSync(workspaceDir, { recursive: true });
  }

  const memoryDir = path.join(workspaceDir, "memory");
  if (!fs.existsSync(memoryDir)) {
    fs.mkdirSync(memoryDir, { recursive: true });
  }

  for (const name of WORKSPACE_FILES) {
    const target = path.join(workspaceDir, name);
    if (fs.existsSync(target)) {
      continue;
    }
    const source = sourceWorkspaceDir ? path.join(sourceWorkspaceDir, name) : undefined;
    if (source && fs.existsSync(source)) {
      fs.copyFileSync(source, target);
      copiedFiles.push(target);
      continue;
    }
    fs.writeFileSync(target, defaultAgentsFileContent(name), "utf8");
    createdFiles.push(target);
  }

  let copiedSkillsDir = false;
  if (copySkills && sourceWorkspaceDir) {
    const sourceSkills = path.join(sourceWorkspaceDir, "skills");
    const targetSkills = path.join(workspaceDir, "skills");
    if (fs.existsSync(sourceSkills) && !fs.existsSync(targetSkills)) {
      fs.cpSync(sourceSkills, targetSkills, { recursive: true });
      copiedSkillsDir = true;
    }
  }

  return {
    createdWorkspace: !workspaceExists,
    createdFiles,
    copiedFiles,
    copiedSkillsDir,
  };
}

function ensureAgentDirFiles(params: {
  agentDir: string;
  sourceAgentDir?: string;
}): {
  createdAgentDir: boolean;
  copiedAuthProfiles: boolean;
  copiedModels: boolean;
} {
  const { agentDir, sourceAgentDir } = params;
  const existed = fs.existsSync(agentDir);
  if (!existed) {
    fs.mkdirSync(agentDir, { recursive: true });
  }

  let copiedAuthProfiles = false;
  let copiedModels = false;
  const authTarget = path.join(agentDir, "auth-profiles.json");
  const modelsTarget = path.join(agentDir, "models.json");
  if (sourceAgentDir) {
    const authSource = path.join(sourceAgentDir, "auth-profiles.json");
    const modelsSource = path.join(sourceAgentDir, "models.json");
    if (!fs.existsSync(authTarget) && fs.existsSync(authSource)) {
      fs.copyFileSync(authSource, authTarget);
      copiedAuthProfiles = true;
    }
    if (!fs.existsSync(modelsTarget) && fs.existsSync(modelsSource)) {
      fs.copyFileSync(modelsSource, modelsTarget);
      copiedModels = true;
    }
  }

  return {
    createdAgentDir: !existed,
    copiedAuthProfiles,
    copiedModels,
  };
}

function writeOpenClawConfig(params: {
  configPath: string;
  config: Record<string, unknown>;
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

export function ensureEvolutionAgent(
  params: EnsureEvolutionAgentParams = {},
): EnsureEvolutionAgentResult {
  const stateDir = params.stateDir ?? resolveOpenClawStateDir();
  const configPath = resolveOpenClawConfigPath(stateDir, params.configPath);
  const { config } = loadOpenClawConfig(configPath);
  const { config: updatedConfig, changed } = ensureEvolutionAgentConfig({ config, stateDir });

  let configBackupPath: string | undefined;
  if (changed) {
    const written = writeOpenClawConfig({ configPath, config: updatedConfig });
    configBackupPath = written.backupPath;
  }

  const workspaceDir = resolveAgentWorkspaceDir(updatedConfig, EVOLUTION_AGENT_ID);
  const agentDir = resolveAgentDir(updatedConfig, EVOLUTION_AGENT_ID, stateDir);
  const sourceAgentId = params.sourceAgentId ?? resolveDefaultAgentId(updatedConfig);
  const sourceWorkspaceDir = resolveAgentWorkspaceDir(updatedConfig, sourceAgentId);
  const sourceAgentDir = resolveAgentDir(updatedConfig, sourceAgentId, stateDir);

  const workspace = ensureWorkspaceFiles({
    workspaceDir,
    sourceWorkspaceDir,
    copySkills: params.copySkills ?? true,
  });

  const agentFiles = ensureAgentDirFiles({
    agentDir,
    sourceAgentDir,
  });

  const notes: string[] = [];
  if (workspace.copiedSkillsDir) {
    notes.push("Copied workspace skills from source agent.");
  }
  if (agentFiles.copiedAuthProfiles) {
    notes.push("Copied auth profiles from source agent.");
  }
  if (agentFiles.copiedModels) {
    notes.push("Copied models registry from source agent.");
  }

  return {
    agentId: EVOLUTION_AGENT_ID,
    configPath,
    updatedConfig: changed,
    configBackupPath,
    workspaceDir,
    agentDir,
    createdWorkspace: workspace.createdWorkspace,
    createdAgentDir: agentFiles.createdAgentDir,
    createdFiles: workspace.createdFiles,
    copiedFiles: workspace.copiedFiles,
    copiedAuthProfiles: agentFiles.copiedAuthProfiles,
    copiedModels: agentFiles.copiedModels,
    copiedSkillsDir: workspace.copiedSkillsDir,
    notes,
  };
}
