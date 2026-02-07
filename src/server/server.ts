import path from "node:path";
import fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { buildTimeline, getSessions, getTasks, getAnalyses } from "./api.js";
import { parseTasks } from "./parse.js";
import {
  getEvolutionReports,
  parseChangeTargets,
  parseDimensions,
  runEvolutionAnalysis,
} from "../evolution/service.js";
import { applyEvolutionChange } from "../evolution/change-apply.js";
import { EVOLUTION_AGENT_ID } from "../evolution/constants.js";
import { loadConfig } from "../config.js";
import {
  EVOLUTION_CHANGE_TARGET_LABELS,
  EVOLUTION_DIMENSION_GROUPS,
  EVOLUTION_DIMENSION_LABELS,
} from "../evolution/analysis-options.js";

export async function startServer(params: {
  host: string;
  port: number;
  stateDir: string;
}) {
  const app = fastify({ logger: false });
  const publicDir = path.join(process.cwd(), "public");
  let parseRunning = false;

  const normalizeStringList = (value: unknown): string[] => {
    if (typeof value === "string") {
      return value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
    if (Array.isArray(value)) {
      return value
        .filter((entry) => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
    return [];
  };

  const normalizePositiveInt = (value: unknown, fallback: number): number => {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) {
      return fallback;
    }
    return Math.floor(num);
  };

  app.get("/api/sessions", async () => {
    return { sessions: getSessions(params.stateDir) };
  });

  app.get("/api/timeline", async (request, reply) => {
    const query = request.query as { sessionKey?: string };
    const sessionKey = typeof query.sessionKey === "string" ? query.sessionKey.trim() : "";
    if (!sessionKey) {
      reply.code(400);
      return { error: "sessionKey required" };
    }
    const result = await buildTimeline({ sessionKey, stateDir: params.stateDir });
    return result;
  });

  app.get("/api/tasks", async (request) => {
    const query = request.query as { sessionKey?: string };
    const sessionKey = typeof query.sessionKey === "string" ? query.sessionKey.trim() : undefined;
    const tasks = await getTasks({ stateDir: params.stateDir, sessionKey });
    return { tasks };
  });

  app.post("/api/parse", async (_request, reply) => {
    if (parseRunning) {
      reply.code(409);
      return { error: "parse already running" };
    }
    parseRunning = true;
    try {
      const result = await parseTasks(params.stateDir);
      return { ok: true, result };
    } catch (err) {
      reply.code(500);
      return { error: (err as Error).message };
    } finally {
      parseRunning = false;
    }
  });

  app.get("/api/analyses", async (request) => {
    const query = request.query as { taskIds?: string };
    const taskIds =
      typeof query.taskIds === "string"
        ? query.taskIds
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean)
        : undefined;
    const analyses = await getAnalyses({ stateDir: params.stateDir, taskIds });
    return { analyses };
  });

  app.get("/api/evolution/options", async () => {
    const config = loadConfig({ stateDir: params.stateDir });
    const defaults = config.evolutionAnalysis;
    return {
      dimensionGroups: EVOLUTION_DIMENSION_GROUPS,
      dimensionLabels: EVOLUTION_DIMENSION_LABELS,
      changeTargetLabels: EVOLUTION_CHANGE_TARGET_LABELS,
      defaults: {
        scopeDays: defaults.scopeDays,
        agentIds: defaults.agentIds,
        focus: defaults.focus,
        dimensions: defaults.dimensions,
        changeTargets: defaults.changeTargets,
        useSearch: defaults.useSearch,
      },
    };
  });

  app.get("/api/evolution/reports", async (request) => {
    const query = request.query as { taskIds?: string };
    const taskIds =
      typeof query.taskIds === "string"
        ? query.taskIds
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean)
        : undefined;
    const reports = await getEvolutionReports({ stateDir: params.stateDir, taskIds });
    return { reports };
  });

  app.post("/api/evolution/analyze", async (request, reply) => {
    const body = request.body as {
      taskIds?: string[];
      dimensions?: string[];
      changeTargets?: string[];
      useSearch?: boolean;
      scopeDays?: number;
      agentIds?: string[] | string;
      focus?: string[] | string;
    };
    const taskIds = Array.isArray(body?.taskIds)
      ? body.taskIds.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim())
      : [];
    if (taskIds.length === 0) {
      reply.code(400);
      return { error: "taskIds required" };
    }
    const config = loadConfig({ stateDir: params.stateDir });
    const defaults = config.evolutionAnalysis;
    const dimensions = parseDimensions(body?.dimensions);
    const resolvedDimensions = dimensions.length > 0 ? dimensions : defaults.dimensions;
    const changeTargets = parseChangeTargets(body?.changeTargets);
    const resolvedChangeTargets =
      changeTargets.length > 0 ? changeTargets : defaults.changeTargets;
    if (resolvedDimensions.length === 0) {
      reply.code(400);
      return { error: "dimensions required" };
    }
    if (resolvedChangeTargets.length === 0) {
      reply.code(400);
      return { error: "changeTargets required" };
    }

    const hasAgentIds = Object.prototype.hasOwnProperty.call(body ?? {}, "agentIds");
    const hasFocus = Object.prototype.hasOwnProperty.call(body ?? {}, "focus");
    const agentIds = hasAgentIds ? normalizeStringList(body?.agentIds) : defaults.agentIds;
    const focus = hasFocus ? normalizeStringList(body?.focus) : defaults.focus;
    const scopeDays = normalizePositiveInt(body?.scopeDays, defaults.scopeDays);
    const useSearch = typeof body?.useSearch === "boolean" ? body.useSearch : defaults.useSearch;
    try {
      const report = await runEvolutionAnalysis({
        stateDir: params.stateDir,
        taskIds,
        dimensions: resolvedDimensions,
        changeTargets: resolvedChangeTargets,
        analysisScopeDays: scopeDays,
        analysisAgentIds: agentIds,
        analysisFocus: focus,
        analysisAgentId: EVOLUTION_AGENT_ID,
        useSearch,
      });
      return { report };
    } catch (err) {
      reply.code(500);
      return { error: (err as Error).message };
    }
  });

  app.post("/api/evolution/apply", async (request, reply) => {
    const body = request.body as { reportId?: string; changeId?: string };
    const reportId = typeof body?.reportId === "string" ? body.reportId.trim() : "";
    const changeId = typeof body?.changeId === "string" ? body.changeId.trim() : "";
    if (!reportId || !changeId) {
      reply.code(400);
      return { error: "reportId and changeId required" };
    }
    const reports = await getEvolutionReports({ stateDir: params.stateDir });
    const report = reports.find((entry) => entry.reportId === reportId);
    const items = report?.items ?? [];
    const change =
      items
        .flatMap((item) => item?.changes ?? [])
        .find((entry) => entry?.changeId === changeId) ?? null;
    if (!change) {
      reply.code(404);
      return { error: "change not found" };
    }
    const result = applyEvolutionChange({ change, stateDir: params.stateDir });
    if (!result.applied) {
      reply.code(400);
      return { error: result.message };
    }
    return { ok: true, message: result.message, requiresRestart: result.requiresRestart ?? false };
  });

  await app.register(fastifyStatic, {
    root: publicDir,
    wildcard: false,
    index: "index.html",
  });

  await app.listen({ host: params.host, port: params.port });
}
