import fs from "node:fs";
import path from "node:path";
import { resolveOpenClawStateDir } from "../paths.js";
import type { EvolutionChange } from "./types.js";
import {
  listAgentWorkspaces,
  loadOpenClawConfig,
  resolveOpenClawConfigPath,
  writeOpenClawConfig,
  type OpenClawConfigRecord,
} from "./openclaw-config.js";

const ALLOWED_CONFIG_TOP_LEVEL = new Set([
  "agents",
  "bindings",
  "tools",
  "session",
  "plugins",
  "hooks",
  "skills",
]);

const ALLOWED_FILE_EXTENSIONS = new Set([".md", ".json", ".json5", ".ts", ".js"]);

type ApplyResult = {
  applied: boolean;
  message: string;
  requiresRestart?: boolean;
};

function isWithinPath(root: string, target: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedTarget = path.resolve(target);
  if (normalizedTarget === normalizedRoot) {
    return true;
  }
  const prefix = normalizedRoot.endsWith(path.sep) ? normalizedRoot : `${normalizedRoot}${path.sep}`;
  return normalizedTarget.startsWith(prefix);
}

function ensureDirForFile(filePath: string) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function applyMergePatch(target: unknown, patch: unknown): unknown {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
    return patch;
  }
  const targetObj = target && typeof target === "object" && !Array.isArray(target) ? target : {};
  const result: Record<string, unknown> = { ...(targetObj as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === null) {
      delete result[key];
      continue;
    }
    result[key] = applyMergePatch((result as Record<string, unknown>)[key], value);
  }
  return result;
}

function validateConfigPatch(patch: Record<string, unknown>): string | null {
  for (const key of Object.keys(patch)) {
    if (!ALLOWED_CONFIG_TOP_LEVEL.has(key)) {
      return `patch contains unsupported top-level key "${key}"`;
    }
  }
  return null;
}

function resolveAllowedRoots(config: OpenClawConfigRecord, stateDir: string): string[] {
  const workspaces = Array.from(listAgentWorkspaces(config).values());
  const managedHooks = path.join(stateDir, "hooks");
  const managedSkills = path.join(stateDir, "skills");
  return [...workspaces, managedHooks, managedSkills];
}

function validateFileTarget(filePath: string, allowedRoots: string[]): string | null {
  const ext = path.extname(filePath);
  if (!ALLOWED_FILE_EXTENSIONS.has(ext)) {
    return `file extension "${ext}" not allowed`;
  }
  const allowed = allowedRoots.some((root) => isWithinPath(root, filePath));
  if (!allowed) {
    return "file path not within allowed roots";
  }
  return null;
}

function applyFileOperation(
  filePath: string,
  operation: EvolutionChange["operation"],
): ApplyResult {
  const kind = operation.type;
  if (kind === "file_append" || kind === "file_prepend" || kind === "file_write") {
    const content = operation.content ?? "";
    ensureDirForFile(filePath);
    if (kind === "file_append") {
      const prefix = fs.existsSync(filePath) && fs.readFileSync(filePath, "utf8").trim().length > 0 ? "\n" : "";
      fs.appendFileSync(filePath, `${prefix}${content}\n`, "utf8");
      return { applied: true, message: "appended content" };
    }
    if (kind === "file_prepend") {
      const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
      fs.writeFileSync(filePath, `${content}\n${existing}`, "utf8");
      return { applied: true, message: "prepended content" };
    }
    if (kind === "file_write") {
      if (!operation.overwrite && fs.existsSync(filePath)) {
        return { applied: false, message: "file exists and overwrite is false" };
      }
      fs.writeFileSync(filePath, content, "utf8");
      return { applied: true, message: "wrote file content" };
    }
  }

  if (kind === "file_replace") {
    if (!fs.existsSync(filePath)) {
      return { applied: false, message: "file does not exist for replace" };
    }
    const existing = fs.readFileSync(filePath, "utf8");
    if (!existing.includes(operation.search)) {
      return { applied: false, message: "search string not found in file" };
    }
    const updated = existing.replace(operation.search, operation.replacement);
    fs.writeFileSync(filePath, updated, "utf8");
    return { applied: true, message: "replaced content" };
  }

  return { applied: false, message: "unsupported file operation" };
}

export function applyEvolutionChange(params: {
  change: EvolutionChange;
  stateDir?: string;
  configPath?: string;
}): ApplyResult {
  const stateDir = params.stateDir ?? resolveOpenClawStateDir();
  const configPath = resolveOpenClawConfigPath(stateDir, params.configPath);
  const { config } = loadOpenClawConfig(configPath);

  if (params.change.target.kind === "openclaw_config") {
    if (params.change.operation.type !== "openclaw_config_merge_patch") {
      return { applied: false, message: "invalid operation for openclaw_config" };
    }
    const patch = params.change.operation.patch;
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      return { applied: false, message: "patch must be an object" };
    }
    const patchError = validateConfigPatch(patch as Record<string, unknown>);
    if (patchError) {
      return { applied: false, message: patchError };
    }
    const merged = applyMergePatch(config, patch) as OpenClawConfigRecord;
    writeOpenClawConfig({ configPath, config: merged });
    return { applied: true, message: "openclaw config updated", requiresRestart: true };
  }

  const filePath = params.change.target.path;
  if (!filePath) {
    return { applied: false, message: "change target path missing" };
  }
  if (!path.isAbsolute(filePath)) {
    return { applied: false, message: "target path must be absolute" };
  }

  const allowedRoots = resolveAllowedRoots(config, stateDir);
  const fileError = validateFileTarget(filePath, allowedRoots);
  if (fileError) {
    return { applied: false, message: fileError };
  }

  return applyFileOperation(filePath, params.change.operation);
}
