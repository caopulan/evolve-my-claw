import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const LEGACY_STATE_DIRS = [".clawdbot", ".moltbot", ".moldbot"] as const;

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

export function resolveOpenClawStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.OPENCLAW_STATE_DIR?.trim() || env.CLAWDBOT_STATE_DIR?.trim();
  if (override) {
    return resolveUserPath(override);
  }
  const home = os.homedir();
  const primary = path.join(home, ".openclaw");
  if (fs.existsSync(primary)) {
    return primary;
  }
  for (const legacy of LEGACY_STATE_DIRS) {
    const candidate = path.join(home, legacy);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return primary;
}

export function resolveAgentsDir(stateDir = resolveOpenClawStateDir()): string {
  return path.join(stateDir, "agents");
}

export function resolveAgentSessionsDir(agentId: string, stateDir = resolveOpenClawStateDir()): string {
  return path.join(resolveAgentsDir(stateDir), agentId, "sessions");
}

export function resolveSessionStorePath(agentId: string, stateDir = resolveOpenClawStateDir()): string {
  return path.join(resolveAgentSessionsDir(agentId, stateDir), "sessions.json");
}

export function resolveSubagentRegistryPath(stateDir = resolveOpenClawStateDir()): string {
  return path.join(stateDir, "subagents", "runs.json");
}

export function resolveTelemetryDir(stateDir = resolveOpenClawStateDir()): string {
  return path.join(stateDir, "evolve-my-claw");
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}
