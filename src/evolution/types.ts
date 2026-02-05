export const EVOLUTION_DIMENSIONS = [
  "per_task_tool_quality",
  "cross_task_patterns",
] as const;

export type EvolutionDimension = (typeof EVOLUTION_DIMENSIONS)[number];

export const EVOLUTION_CHANGE_TARGETS = [
  "openclaw_config",
  "agent_persona",
  "hooks",
  "plugins",
  "skills",
] as const;

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

export type EvolutionReportItem = {
  itemId: string;
  scope: "task" | "multi";
  taskId?: string;
  dimension: EvolutionDimension | "change_recommendation";
  severity: "low" | "medium" | "high";
  title: string;
  reasoning: string;
  evidence?: string;
  recommendation?: string;
  changes?: EvolutionChange[];
};

export type EvolutionReportRecord = {
  type: "evolution_report";
  reportId: string;
  createdAt: number;
  analysisAgentId: string;
  taskIds: string[];
  dimensions: EvolutionDimension[];
  changeTargets: EvolutionChangeTarget[];
  summary: string;
  items: EvolutionReportItem[];
  rawResponse?: string;
  parseError?: string;
};
