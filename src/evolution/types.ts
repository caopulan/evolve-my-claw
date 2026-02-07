import { EVOLUTION_CHANGE_TARGETS, EVOLUTION_DIMENSIONS } from "./analysis-options.js";

export type EvolutionDimension = (typeof EVOLUTION_DIMENSIONS)[number];
export type EvolutionChangeTarget = (typeof EVOLUTION_CHANGE_TARGETS)[number];

export type EvolutionChangeOperation =
  | {
      type: "openclaw_config_merge_patch";
      patch: Record<string, unknown>;
    }
  | {
      type: "file_append";
      content: string;
    }
  | {
      type: "file_prepend";
      content: string;
    }
  | {
      type: "file_replace";
      search: string;
      replacement: string;
    }
  | {
      type: "file_write";
      content: string;
      overwrite?: boolean;
    };

export type EvolutionChangeTargetKind =
  | "openclaw_config"
  | "agent_file"
  | "hook_file"
  | "skill_file";

export type EvolutionChange = {
  changeId: string;
  target: {
    kind: EvolutionChangeTargetKind;
    path?: string;
  };
  summary: string;
  reason: string;
  requiresRestart?: boolean;
  operation: EvolutionChangeOperation;
};

export type EvolutionUserAction = {
  title: string;
  reason?: string;
  steps: string[];
};

export type EvolutionReportItem = {
  itemId: string;
  scope: "task" | "multi";
  taskId?: string;
  dimension: EvolutionDimension;
  severity: "low" | "medium" | "high";
  title: string;
  /** Optional rule ids that this item addresses (rule-driven evolution mode). */
  ruleIds?: string[];
  reasoning: string;
  evidence?: string;
  impact?: string;
  risk?: string;
  testPlan?: string;
  rollbackPlan?: string;
  recommendation?: string;
  userActions?: EvolutionUserAction[];
  changes?: EvolutionChange[];
};

export type EvolutionReportRecord = {
  type: "evolution_report";
  schemaVersion?: number;
  reportId: string;
  createdAt: number;
  analysisAgentId: string;
  taskIds: string[];
  dimensions: EvolutionDimension[];
  changeTargets: EvolutionChangeTarget[];
  analysisScope?: {
    scopeDays?: number;
    agentIds?: string[];
    focus?: string[];
  };
  useSearch?: boolean;
  ruleEngine?: {
    matchedRuleIds: string[];
    builtinPath?: string;
    overridePaths?: string[];
  };
  summary: string;
  items: EvolutionReportItem[];
  rawResponse?: string;
  parseError?: string;
};
