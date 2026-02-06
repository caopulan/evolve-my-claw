export type RuleScope = "task" | "multi";
export type RuleSeverity = "low" | "medium" | "high";
export type RuleMatchMode = "any" | "all";

export type ToolErrorCodeTrigger = {
  kind: "tool_error_code";
  toolName?: string;
  error: string;
};

export type ToolResultRegexTrigger = {
  kind: "tool_result_regex";
  toolName?: string;
  pattern: string;
  flags?: string;
};

export type RuleTrigger = ToolErrorCodeTrigger | ToolResultRegexTrigger;

export type ConfigMergePatchAction = {
  kind: "openclaw_config_merge_patch";
  summary: string;
  reason: string;
  requiresRestart?: boolean;
  patch: Record<string, unknown>;
};

export type CreateManagedSkillAction = {
  kind: "create_managed_skill";
  summary: string;
  reason: string;
  skillId: string;
  overwrite?: boolean;
  content: string;
};

export type AppendWorkspaceFileAction = {
  kind: "append_workspace_file";
  summary: string;
  reason: string;
  fileName: string;
  content: string;
};

export type UserAction = {
  kind: "user_action";
  title: string;
  reason?: string;
  steps: string[];
};

export type RuleAction =
  | ConfigMergePatchAction
  | CreateManagedSkillAction
  | AppendWorkspaceFileAction
  | UserAction;

export type EvolutionRule = {
  ruleId: string;
  enabled?: boolean;
  title: string;
  description?: string;
  scope: RuleScope;
  severity: RuleSeverity;
  match?: RuleMatchMode;
  triggers: RuleTrigger[];
  actions: RuleAction[];
};

export type EvolutionRuleSetFile = {
  schemaVersion: number;
  rules: EvolutionRule[];
};

export type RuleEvidence = {
  taskId: string;
  toolName?: string;
  toolCallId?: string;
  excerpt: string;
};

export type RuleFinding = {
  ruleId: string;
  title: string;
  scope: RuleScope;
  severity: RuleSeverity;
  matchedTaskIds: string[];
  evidence: RuleEvidence[];
  actions: RuleAction[];
};

