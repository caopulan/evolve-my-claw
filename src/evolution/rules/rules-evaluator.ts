import crypto from "node:crypto";
import path from "node:path";
import type { TaskRecord } from "../../tasks/task-store.js";
import type { EvolutionChange, EvolutionReportItem, EvolutionUserAction } from "../types.js";
import type {
  AppendWorkspaceFileAction,
  ConfigMergePatchAction,
  CreateManagedSkillAction,
  EvolutionRule,
  RuleAction,
  RuleEvidence,
  RuleFinding,
  RuleMatchMode,
  RuleTrigger,
  ToolErrorCodeTrigger,
  ToolResultRegexTrigger,
} from "./rule-types.js";

type ToolSignal = {
  taskId: string;
  toolName: string;
  toolCallId: string;
  resultText: string;
  errorCodes: Array<{ code: string; message?: string; raw: string }>;
};

function stableId(input: string): string {
  return crypto.createHash("sha1").update(input).digest("hex").slice(0, 12);
}

function truncateText(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}…`;
}

function stringifyCompact(value: unknown, maxChars: number): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return truncateText(value, maxChars);
  }
  try {
    return truncateText(JSON.stringify(value), maxChars);
  } catch {
    return truncateText(String(value), maxChars);
  }
}

function tryParseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractErrorCodesFromJsonObject(obj: Record<string, unknown>): Array<{ code: string; message?: string; raw: string }> {
  const error = typeof obj.error === "string" ? obj.error.trim() : "";
  const message = typeof obj.message === "string" ? obj.message.trim() : undefined;
  if (error) {
    return [{ code: error, message, raw: JSON.stringify(obj) }];
  }
  const status = typeof obj.status === "string" ? obj.status.trim().toLowerCase() : "";
  if (status === "error") {
    const detail = typeof obj.error === "string" ? obj.error.trim() : undefined;
    return [{ code: "status:error", message: detail, raw: JSON.stringify(obj) }];
  }
  return [];
}

function extractToolSignals(tasks: TaskRecord[]): ToolSignal[] {
  const signals: ToolSignal[] = [];
  for (const task of tasks) {
    for (const call of task.toolCalls) {
      const texts: string[] = [];
      const errorCodes: Array<{ code: string; message?: string; raw: string }> = [];
      const result = call.result;
      if (Array.isArray(result)) {
        for (const entry of result) {
          if (!entry || typeof entry !== "object") {
            continue;
          }
          const record = entry as Record<string, unknown>;
          if (typeof record.text === "string") {
            texts.push(record.text);
            const obj = tryParseJsonObject(record.text);
            if (obj) {
              errorCodes.push(...extractErrorCodesFromJsonObject(obj));
            }
          } else {
            texts.push(stringifyCompact(record, 1200));
            errorCodes.push(...extractErrorCodesFromJsonObject(record));
          }
        }
      } else if (typeof result === "string") {
        texts.push(result);
        const obj = tryParseJsonObject(result);
        if (obj) {
          errorCodes.push(...extractErrorCodesFromJsonObject(obj));
        }
      } else if (result && typeof result === "object") {
        const record = result as Record<string, unknown>;
        texts.push(stringifyCompact(record, 1600));
        errorCodes.push(...extractErrorCodesFromJsonObject(record));
      }
      const resultText = truncateText(texts.filter(Boolean).join("\n\n") || stringifyCompact(result, 2000), 2400);
      signals.push({
        taskId: task.taskId,
        toolName: call.toolName,
        toolCallId: call.toolCallId,
        resultText,
        errorCodes,
      });
    }
  }
  return signals;
}

function matchesToolName(signal: ToolSignal, toolName?: string): boolean {
  if (!toolName) {
    return true;
  }
  return signal.toolName === toolName;
}

function safeRegex(pattern: string, flags?: string): RegExp | null {
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

function matchToolErrorCode(trigger: ToolErrorCodeTrigger, signals: ToolSignal[]): RuleEvidence[] {
  const out: RuleEvidence[] = [];
  for (const signal of signals) {
    if (!matchesToolName(signal, trigger.toolName)) {
      continue;
    }
    const hit = signal.errorCodes.find((code) => code.code === trigger.error);
    if (!hit) {
      continue;
    }
    out.push({
      taskId: signal.taskId,
      toolName: signal.toolName,
      toolCallId: signal.toolCallId,
      excerpt: truncateText(hit.raw || signal.resultText, 1200),
    });
  }
  return out;
}

function matchToolResultRegex(trigger: ToolResultRegexTrigger, signals: ToolSignal[]): RuleEvidence[] {
  const out: RuleEvidence[] = [];
  const re = safeRegex(trigger.pattern, trigger.flags);
  if (!re) {
    return out;
  }
  for (const signal of signals) {
    if (!matchesToolName(signal, trigger.toolName)) {
      continue;
    }
    if (!re.test(signal.resultText)) {
      continue;
    }
    out.push({
      taskId: signal.taskId,
      toolName: signal.toolName,
      toolCallId: signal.toolCallId,
      excerpt: truncateText(signal.resultText, 1200),
    });
  }
  return out;
}

function matchTrigger(trigger: RuleTrigger, signals: ToolSignal[]): RuleEvidence[] {
  if (trigger.kind === "tool_error_code") {
    return matchToolErrorCode(trigger, signals);
  }
  if (trigger.kind === "tool_result_regex") {
    return matchToolResultRegex(trigger, signals);
  }
  return [];
}

function isEnabled(rule: EvolutionRule): boolean {
  return rule.enabled !== false;
}

function resolveMatchMode(rule: EvolutionRule): RuleMatchMode {
  return rule.match === "all" ? "all" : "any";
}

function buildFinding(rule: EvolutionRule, signals: ToolSignal[]): RuleFinding | null {
  if (!isEnabled(rule)) {
    return null;
  }
  const mode = resolveMatchMode(rule);
  const triggerEvidences = rule.triggers.map((trigger) => matchTrigger(trigger, signals));

  const matched =
    mode === "all"
      ? triggerEvidences.every((ev) => ev.length > 0)
      : triggerEvidences.some((ev) => ev.length > 0);

  if (!matched) {
    return null;
  }

  const evidence = triggerEvidences.flat();
  const matchedTaskIds = Array.from(new Set(evidence.map((ev) => ev.taskId)));

  return {
    ruleId: rule.ruleId,
    title: rule.title,
    scope: rule.scope,
    severity: rule.severity,
    matchedTaskIds,
    evidence,
    actions: rule.actions,
  };
}

function actionToConfigChange(action: ConfigMergePatchAction): EvolutionChange {
  return {
    changeId: `change-${stableId(`config:${action.summary}:${JSON.stringify(action.patch)}`)}`,
    target: { kind: "openclaw_config" },
    summary: action.summary,
    reason: action.reason,
    requiresRestart: Boolean(action.requiresRestart),
    operation: { type: "openclaw_config_merge_patch", patch: action.patch },
  };
}

function actionToManagedSkillChange(action: CreateManagedSkillAction, skillsDir: string): EvolutionChange {
  const filePath = path.join(skillsDir, action.skillId, "SKILL.md");
  return {
    changeId: `change-${stableId(`skill:${filePath}:${action.summary}`)}`,
    target: { kind: "skill_file", path: filePath },
    summary: action.summary,
    reason: action.reason,
    operation: { type: "file_write", content: action.content, overwrite: Boolean(action.overwrite) },
  };
}

function actionToWorkspaceAppendChanges(
  action: AppendWorkspaceFileAction,
  workspaces: Array<{ agentId: string; path: string }>,
): EvolutionChange[] {
  const capped = workspaces.slice(0, 3);
  const changes: EvolutionChange[] = [];
  for (const ws of capped) {
    const filePath = path.join(ws.path, action.fileName);
    changes.push({
      changeId: `change-${stableId(`agent:${ws.agentId}:${filePath}:${action.summary}`)}`,
      target: { kind: "agent_file", path: filePath },
      summary: `${action.summary} (${ws.agentId})`,
      reason: action.reason,
      operation: { type: "file_append", content: action.content },
    });
  }
  return changes;
}

function actionToUserAction(action: RuleAction): EvolutionUserAction | null {
  if (action.kind !== "user_action") {
    return null;
  }
  return {
    title: action.title,
    reason: action.reason,
    steps: Array.isArray(action.steps) ? action.steps.filter(Boolean) : [],
  };
}

function buildEvidenceMarkdown(evidence: RuleEvidence[]): string {
  if (!evidence.length) {
    return "";
  }
  const blocks: string[] = ["**Rule evidence**", ""];
  for (const ev of evidence.slice(0, 4)) {
    const header = [
      `- taskId: \`${ev.taskId}\``,
      ev.toolName ? `tool: \`${ev.toolName}\`` : undefined,
      ev.toolCallId ? `call: \`${ev.toolCallId}\`` : undefined,
    ]
      .filter(Boolean)
      .join(" · ");
    blocks.push(header);
    blocks.push("");
    blocks.push("```");
    blocks.push(truncateText(ev.excerpt.trim(), 900));
    blocks.push("```");
    blocks.push("");
  }
  return blocks.join("\n").trim();
}

function buildDefaultTestPlan(finding: RuleFinding): string {
  const lines: string[] = [];
  lines.push("1. 重新运行触发该问题的任务，确认错误不再重复出现。");
  lines.push("2. 如果涉及 OpenClaw config 变更，重启 gateway 后再验证一次。");
  lines.push("3. 如果新增 skills/hooks 文件，运行 `openclaw skills check --json` / `openclaw hooks check --json` 验证加载情况。");
  if (finding.ruleId.includes("web.search")) {
    lines.push("4. 在需要在线检索的任务里，验证是否仍能完成目标（必要时用 browser/web_fetch fallback）。");
  }
  return lines.join("\n");
}

function buildDefaultRollbackPlan(changes: EvolutionChange[]): string {
  const hasConfig = changes.some((c) => c.target.kind === "openclaw_config");
  const fileTargets = changes.filter((c) => c.target.kind !== "openclaw_config");
  const lines: string[] = [];
  if (hasConfig) {
    lines.push("1. 回滚 OpenClaw config: 使用备份文件或撤销对应的 merge patch。");
  }
  if (fileTargets.length > 0) {
    lines.push("2. 回滚文件变更: 删除新增的文件/目录，或移除追加到文件中的段落。");
  }
  if (!lines.length) {
    lines.push("无需回滚。");
  }
  return lines.join("\n");
}

function groupKeyForChange(change: EvolutionChange): string {
  if (change.target.kind === "openclaw_config") {
    return "config";
  }
  if (change.target.kind === "skill_file") {
    return "skills";
  }
  if (change.target.kind === "hook_file") {
    return "hooks";
  }
  return "workspace";
}

function groupTitleSuffix(groupKey: string): string {
  if (groupKey === "config") {
    return " (config)";
  }
  if (groupKey === "skills") {
    return " (skills)";
  }
  if (groupKey === "hooks") {
    return " (hooks)";
  }
  return " (workspace)";
}

export type RuleEngineContext = {
  skillsDir: string;
  workspacePaths: Array<{ agentId: string; path: string }>;
};

export type RuleEngineOutput = {
  findings: RuleFinding[];
  seedItems: EvolutionReportItem[];
  requiredRuleIds: string[];
};

export function evaluateEvolutionRules(params: {
  tasks: TaskRecord[];
  rules: EvolutionRule[];
  context: RuleEngineContext;
}): RuleEngineOutput {
  const signals = extractToolSignals(params.tasks);

  const findings: RuleFinding[] = [];
  for (const rule of params.rules) {
    const finding = buildFinding(rule, signals);
    if (finding) {
      findings.push(finding);
    }
  }

  const seedItems: EvolutionReportItem[] = [];
  for (const finding of findings) {
    const changes: EvolutionChange[] = [];
    const userActions: EvolutionUserAction[] = [];
    for (const action of finding.actions) {
      if (action.kind === "openclaw_config_merge_patch") {
        changes.push(actionToConfigChange(action));
        continue;
      }
      if (action.kind === "create_managed_skill") {
        changes.push(actionToManagedSkillChange(action, params.context.skillsDir));
        continue;
      }
      if (action.kind === "append_workspace_file") {
        changes.push(...actionToWorkspaceAppendChanges(action, params.context.workspacePaths));
        continue;
      }
      const ua = actionToUserAction(action);
      if (ua) {
        userActions.push(ua);
      }
    }

    const byGroup = new Map<string, EvolutionChange[]>();
    for (const change of changes) {
      const key = groupKeyForChange(change);
      const list = byGroup.get(key) ?? [];
      list.push(change);
      byGroup.set(key, list);
    }

    const evidenceMd = buildEvidenceMarkdown(finding.evidence);
    const matchedTaskId = finding.scope === "task" ? finding.matchedTaskIds[0] : undefined;

    const groups = Array.from(byGroup.entries());
    if (groups.length === 0) {
      // Still emit an item if we only have userActions, so the UI shows something actionable.
      seedItems.push({
        itemId: `item-${stableId(`rule:${finding.ruleId}:actions`)}`,
        scope: finding.scope,
        taskId: matchedTaskId,
        dimension: "change_recommendation",
        severity: finding.severity,
        title: finding.title,
        reasoning: `命中规则 \`${finding.ruleId}\`，但该规则没有生成可自动落盘的 changes。`,
        evidence: evidenceMd,
        impact: "减少重复失败与无效工具调用。",
        risk: "需要用户手动配置或调整环境变量。",
        testPlan: buildDefaultTestPlan(finding),
        rollbackPlan: "无需回滚。",
        userActions: userActions.length > 0 ? userActions : undefined,
        changes: undefined,
        ruleIds: [finding.ruleId],
      });
      continue;
    }

    // Attach user actions to the config group if possible, else to the first group.
    const preferredUserActionGroup =
      byGroup.has("config") ? "config" : (groups[0]?.[0] ?? "workspace");

    for (const [groupKey, groupChanges] of groups) {
      const title = `${finding.title}${groupTitleSuffix(groupKey)}`;
      const ua = groupKey === preferredUserActionGroup ? userActions : [];
      seedItems.push({
        itemId: `item-${stableId(`rule:${finding.ruleId}:${groupKey}`)}`,
        scope: finding.scope,
        taskId: matchedTaskId,
        dimension: "change_recommendation",
        severity: finding.severity,
        title,
        reasoning: `命中规则 \`${finding.ruleId}\`，并生成一组可落盘的 changes（${groupKey}）。`,
        evidence: evidenceMd,
        impact: "减少重复失败与无效工具调用；把已验证的 workaround 固化到配置/skills/workspace 文档里。",
        risk:
          groupKey === "config"
            ? "涉及 OpenClaw config 修改，可能需要重启 gateway；禁用工具会降低功能覆盖。"
            : "新增/追加文档与技能文件风险较低；主要风险是内容不符合你的偏好，需要调整。",
        testPlan: buildDefaultTestPlan(finding),
        rollbackPlan: buildDefaultRollbackPlan(groupChanges),
        userActions: ua.length > 0 ? ua : undefined,
        changes: groupChanges,
        ruleIds: [finding.ruleId],
      });
    }
  }

  const requiredRuleIds = findings.map((f) => f.ruleId);

  return { findings, seedItems, requiredRuleIds };
}

export function formatRuleFindingsForPrompt(findings: RuleFinding[], maxChars = 10_000): string {
  const compact = findings.map((f) => ({
    ruleId: f.ruleId,
    title: f.title,
    severity: f.severity,
    scope: f.scope,
    matchedTaskIds: f.matchedTaskIds,
    evidence: f.evidence.slice(0, 2),
    actions: f.actions.map((a) => a.kind),
  }));
  return truncateText(JSON.stringify(compact, null, 2), maxChars);
}

