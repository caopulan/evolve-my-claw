import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveOpenClawStateDir } from "../paths.js";
import { EVOLUTION_AGENT_ID, EVOLUTION_AGENT_NAME } from "./constants.js";
import {
  loadOpenClawConfig,
  normalizeAgentId,
  resolveAgentDir,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
  resolveOpenClawConfigPath,
  resolveUserPath,
  type OpenClawConfigRecord,
  writeOpenClawConfig,
} from "./openclaw-config.js";

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

const WORKSPACE_FILES = [
  "AGENTS.md",
  "SOUL.md",
  "TOOLS.md",
  "IDENTITY.md",
  "USER.md",
  "HEARTBEAT.md",
] as const;

const EVOLUTION_GUIDANCE_MARKER = "## Evolution Workflow";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
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

function pathsEqual(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

function ensureEvolutionAgentConfig(params: {
  config: OpenClawConfigRecord;
  stateDir: string;
}): { config: OpenClawConfigRecord; changed: boolean } {
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

function ensureSelfEvolutionSkill(workspaceDir: string): { updated: boolean; note?: string } {
  const sourceDir = path.join(process.cwd(), "skills", "self-evolution");
  const sourceFile = path.join(sourceDir, "SKILL.md");
  if (!fs.existsSync(sourceFile)) {
    return { updated: false, note: "self-evolution skill not found in repo; skipped sync." };
  }
  const targetDir = path.join(workspaceDir, "skills", "self-evolution");
  const targetFile = path.join(targetDir, "SKILL.md");
  let shouldCopy = true;
  if (fs.existsSync(targetFile)) {
    try {
      const sourceRaw = fs.readFileSync(sourceFile, "utf8");
      const targetRaw = fs.readFileSync(targetFile, "utf8");
      shouldCopy = sourceRaw !== targetRaw;
    } catch {
      shouldCopy = true;
    }
  }
  if (!shouldCopy) {
    return { updated: false };
  }
  fs.mkdirSync(targetDir, { recursive: true });
  fs.cpSync(sourceDir, targetDir, { recursive: true });
  return { updated: true };
}

function evolutionGuidanceBlock(): string {
  return [
    "",
    EVOLUTION_GUIDANCE_MARKER,
    "",
    "Purpose: analyze selected tasks and propose targeted, high-signal improvements.",
    "",
    "Rules:",
    "- Only analyze the tasks explicitly selected by the user.",
    "- Respect the chosen analysis dimensions and change targets.",
    "- Prefer minimal, high-impact modifications; avoid changes without clear benefit.",
    "- Provide concrete reasons, evidence, and expected impact for every recommendation.",
    "- Prefer self-evolution via concrete changes (config/file edits). User actions are a fallback when secrets or manual steps are required.",
    "- Always include impact, risk, and a test plan so changes are safe to apply.",
    "",
    "Change execution:",
    "- Use structured JSON changes with explicit file targets and safe operations.",
    "- Config edits should be merge patches limited to supported top-level keys (agents/tools/messages/commands/approvals/hooks/gateway/skills/plugins, etc).",
    "- File edits should be append/replace/write with precise search strings.",
    "- Paths must stay within allowed OpenClaw workspaces or managed hooks/skills.",
  ].join("\n");
}

function maybeAppendEvolutionGuidance(workspaceDir: string): boolean {
  const agentsPath = path.join(workspaceDir, "AGENTS.md");
  if (!fs.existsSync(agentsPath)) {
    return false;
  }
  const raw = fs.readFileSync(agentsPath, "utf8");
  if (raw.includes(EVOLUTION_GUIDANCE_MARKER)) {
    return false;
  }
  fs.appendFileSync(agentsPath, `${evolutionGuidanceBlock()}\n`, "utf8");
  return true;
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

  const skillSync = ensureSelfEvolutionSkill(workspaceDir);
  const appendedGuidance = maybeAppendEvolutionGuidance(workspaceDir);

  const agentFiles = ensureAgentDirFiles({
    agentDir,
    sourceAgentDir,
  });

  const notes: string[] = [];
  if (skillSync.note) {
    notes.push(skillSync.note);
  }
  if (skillSync.updated) {
    notes.push("Synced self-evolution skill into evolve-my-claw workspace.");
  }
  if (workspace.copiedSkillsDir) {
    notes.push("Copied workspace skills from source agent.");
  }
  if (agentFiles.copiedAuthProfiles) {
    notes.push("Copied auth profiles from source agent.");
  }
  if (agentFiles.copiedModels) {
    notes.push("Copied models registry from source agent.");
  }
  if (appendedGuidance) {
    notes.push("Appended evolution guidance to AGENTS.md.");
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
