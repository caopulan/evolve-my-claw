import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSON5 from "json5";
import { resolveTelemetryDir } from "../../paths.js";
import type { EvolutionRule, EvolutionRuleSetFile } from "./rule-types.js";

export type LoadedEvolutionRuleset = {
  schemaVersion: number;
  rules: EvolutionRule[];
  sources: {
    repoRoot?: string;
    builtinPath?: string;
    overridePaths: string[];
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readJson5File(filePath: string): unknown {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON5.parse(raw) as unknown;
}

function looksLikeRule(value: unknown): value is EvolutionRule {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.ruleId === "string" && value.ruleId.trim().length > 0;
}

function parseRuleSetFile(value: unknown): EvolutionRuleSetFile | null {
  if (!isRecord(value)) {
    return null;
  }
  const schemaVersion = typeof value.schemaVersion === "number" ? value.schemaVersion : 0;
  const rulesRaw = value.rules;
  const rules = Array.isArray(rulesRaw) ? rulesRaw.filter(looksLikeRule) : [];
  if (!rules.length) {
    return null;
  }
  return { schemaVersion, rules };
}

function findUp(startDir: string, predicate: (dir: string) => boolean): string | null {
  let current = path.resolve(startDir);
  for (let depth = 0; depth < 20; depth += 1) {
    if (predicate(current)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

function isEvolveRepoRoot(dir: string): boolean {
  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    return false;
  }
  try {
    const raw = fs.readFileSync(pkgPath, "utf8");
    const parsed = JSON.parse(raw) as { name?: unknown };
    return parsed?.name === "evolve-my-claw";
  } catch {
    return false;
  }
}

function resolveRepoRoot(): string | null {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return (
    findUp(process.cwd(), isEvolveRepoRoot) ??
    findUp(moduleDir, isEvolveRepoRoot)
  );
}

function mergeRule(base: EvolutionRule, override: EvolutionRule): EvolutionRule {
  const merged: EvolutionRule = { ...base, ...override };
  if (Array.isArray(override.triggers) && override.triggers.length > 0) {
    merged.triggers = override.triggers;
  }
  if (Array.isArray(override.actions) && override.actions.length > 0) {
    merged.actions = override.actions;
  }
  return merged;
}

function loadBuiltinRules(params: { repoRoot: string }): { rules: EvolutionRule[]; path?: string; schemaVersion: number } {
  const builtinPath = path.join(params.repoRoot, "rules", "builtin.rules.json5");
  if (!fs.existsSync(builtinPath)) {
    return { rules: [], schemaVersion: 0 };
  }
  try {
    const parsed = parseRuleSetFile(readJson5File(builtinPath));
    if (!parsed) {
      return { rules: [], schemaVersion: 0, path: builtinPath };
    }
    return { rules: parsed.rules, schemaVersion: parsed.schemaVersion, path: builtinPath };
  } catch {
    return { rules: [], schemaVersion: 0, path: builtinPath };
  }
}

function loadOverrideRules(params: { overrideDir: string }): { rules: EvolutionRule[]; paths: string[] } {
  if (!fs.existsSync(params.overrideDir)) {
    return { rules: [], paths: [] };
  }
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(params.overrideDir).filter((name) => name.endsWith(".json5"));
  } catch {
    return { rules: [], paths: [] };
  }
  const rules: EvolutionRule[] = [];
  const paths: string[] = [];
  for (const name of entries) {
    const filePath = path.join(params.overrideDir, name);
    try {
      const raw = readJson5File(filePath);
      const asSet = parseRuleSetFile(raw);
      if (asSet) {
        rules.push(...asSet.rules);
        paths.push(filePath);
        continue;
      }
      if (looksLikeRule(raw)) {
        rules.push(raw);
        paths.push(filePath);
      }
    } catch {
      // ignore malformed overrides
    }
  }
  return { rules, paths };
}

export function loadEvolutionRuleset(params: { stateDir: string }): LoadedEvolutionRuleset {
  const repoRoot = resolveRepoRoot() ?? undefined;
  const builtin = repoRoot ? loadBuiltinRules({ repoRoot }) : { rules: [], schemaVersion: 0, path: undefined };
  const overrideDir = path.join(resolveTelemetryDir(params.stateDir), "rules");
  const overrides = loadOverrideRules({ overrideDir });

  const byId = new Map<string, EvolutionRule>();
  for (const rule of builtin.rules) {
    byId.set(rule.ruleId, rule);
  }
  for (const rule of overrides.rules) {
    const prev = byId.get(rule.ruleId);
    if (prev) {
      byId.set(rule.ruleId, mergeRule(prev, rule));
    } else {
      byId.set(rule.ruleId, rule);
    }
  }

  const merged = Array.from(byId.values());
  merged.sort((a, b) => a.ruleId.localeCompare(b.ruleId));

  return {
    schemaVersion: Math.max(builtin.schemaVersion, 1),
    rules: merged,
    sources: {
      repoRoot,
      builtinPath: builtin.path,
      overridePaths: overrides.paths,
    },
  };
}

