import fs from "node:fs";
import path from "node:path";
import JSON5 from "json5";
import {
  resolveAgentSessionsDir,
  resolveAgentsDir,
  resolveOpenClawStateDir,
  resolveSessionStorePath,
} from "../paths.js";

export type SessionEntry = {
  sessionId: string;
  updatedAt?: number;
  sessionFile?: string;
  spawnedBy?: string;
  label?: string;
  displayName?: string;
  channel?: string;
  groupId?: string;
  model?: string;
  contextTokens?: number;
  totalTokens?: number;
  thinkingLevel?: string;
  verboseLevel?: string;
  lastChannel?: string;
  lastTo?: string;
  lastAccountId?: string;
};

export type SessionIndexEntry = {
  agentId: string;
  key: string;
  sessionId: string;
  sessionFile?: string;
  updatedAt?: number;
  label?: string;
  displayName?: string;
  spawnedBy?: string;
  channel?: string;
  kind: string;
};

export function listAgentIds(stateDir = resolveOpenClawStateDir()): string[] {
  const root = resolveAgentsDir(stateDir);
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

export function loadSessionStore(agentId: string, stateDir = resolveOpenClawStateDir()): Record<string, SessionEntry> {
  const storePath = resolveSessionStorePath(agentId, stateDir);
  try {
    const raw = fs.readFileSync(storePath, "utf8");
    const parsed = JSON5.parse(raw) as Record<string, SessionEntry>;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

function classifySessionKind(key: string): string {
  const normalized = key.toLowerCase();
  if (normalized.includes(":subagent:")) {
    return "subagent";
  }
  if (normalized.includes(":cron:")) {
    return "cron";
  }
  if (normalized.includes(":hook:")) {
    return "hook";
  }
  if (normalized.includes(":node:")) {
    return "node";
  }
  if (normalized.includes(":dm:") || normalized.includes(":group:") || normalized.includes(":channel:")) {
    return "channel";
  }
  return "main";
}

export function listSessions(stateDir = resolveOpenClawStateDir()): SessionIndexEntry[] {
  const agentIds = listAgentIds(stateDir);
  const sessions: SessionIndexEntry[] = [];
  for (const agentId of agentIds) {
    const store = loadSessionStore(agentId, stateDir);
    for (const [key, entry] of Object.entries(store)) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const sessionId = entry.sessionId;
      if (!sessionId) {
        continue;
      }
      const sessionFile = entry.sessionFile
        ? entry.sessionFile
        : path.join(resolveAgentSessionsDir(agentId, stateDir), `${sessionId}.jsonl`);
      sessions.push({
        agentId,
        key,
        sessionId,
        sessionFile,
        updatedAt: entry.updatedAt,
        label: entry.label,
        displayName: entry.displayName,
        spawnedBy: entry.spawnedBy,
        channel: entry.channel,
        kind: classifySessionKind(key),
      });
    }
  }
  return sessions.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}
