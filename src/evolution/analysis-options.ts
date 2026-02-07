export const EVOLUTION_DIMENSIONS = [
  "C1",
  "C2",
  "C3",
  "C4",
  "C5",
  "C6",
  "C7",
  "C8",
  "C9",
  "C10",
  "C11",
  "W1",
  "W2",
  "W3",
  "W4",
  "W5",
  "E1",
  "E2",
  "E3",
  "E4",
] as const;

export type EvolutionDimensionId = (typeof EVOLUTION_DIMENSIONS)[number];

export const EVOLUTION_DIMENSION_LABELS: Record<EvolutionDimensionId, string> = {
  C1: "模型选择与推理策略",
  C2: "工具策略与越权防护",
  C3: "Exec 环境",
  C4: "Web 工具能力",
  C5: "多 Agent 结构与路由",
  C6: "子代理策略",
  C7: "Channel 安全与 Allowlist",
  C8: "消息并发与去抖",
  C9: "Compaction 与上下文管理",
  C10: "Cron 调度",
  C11: "Plugins",
  W1: "行为准则与流程 (AGENTS.md)",
  W2: "环境与工具坑位 (TOOLS.md)",
  W3: "人格/语气/偏好 (SOUL/IDENTITY/USER)",
  W4: "持久记忆 (MEMORY.md + memory/*)",
  W5: "启动清单 (BOOT.md)",
  E1: "技能新增",
  E2: "技能优化",
  E3: "Internal Hooks",
  E4: "版本升级",
};

export type EvolutionDimensionGroup = {
  id: "config" | "workspace" | "extensions";
  label: string;
  items: EvolutionDimensionId[];
};

export const EVOLUTION_DIMENSION_GROUPS: EvolutionDimensionGroup[] = [
  {
    id: "config",
    label: "配置层 (openclaw.json)",
    items: [
      "C1",
      "C2",
      "C3",
      "C4",
      "C5",
      "C6",
      "C7",
      "C8",
      "C9",
      "C10",
      "C11",
    ],
  },
  {
    id: "workspace",
    label: "Workspace 层",
    items: ["W1", "W2", "W3", "W4", "W5"],
  },
  {
    id: "extensions",
    label: "扩展层 (Skills / Hooks)",
    items: ["E1", "E2", "E3", "E4"],
  },
];

export const EVOLUTION_CHANGE_TARGETS = ["config", "workspace", "extensions"] as const;

export type EvolutionChangeTargetId = (typeof EVOLUTION_CHANGE_TARGETS)[number];

export const EVOLUTION_CHANGE_TARGET_LABELS: Record<EvolutionChangeTargetId, string> = {
  config: "配置层",
  workspace: "Workspace 层",
  extensions: "扩展层",
};
