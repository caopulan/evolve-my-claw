import path from "node:path";
import fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { buildTimeline, getSessions, getTasks, getAnalyses } from "./api.js";
import { parseTasks } from "./parse.js";
import { GatewayCaptureClient } from "../gateway/client.js";
import { analyzeTaskCandidate } from "../tasks/task-analyzer.js";
import { appendAnalysisRecords, loadAnalysisIndex } from "../tasks/analysis-store.js";
import { loadTaskRecords } from "../tasks/task-store.js";
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
import { ensureEvolutionAgent } from "../evolution/ensure-agent.js";
import { loadOpenClawConfig, resolveOpenClawConfigPath, type OpenClawConfigRecord } from "../evolution/openclaw-config.js";

export async function startServer(params: {
  host: string;
  port: number;
  stateDir: string;
}) {
  const app = fastify({ logger: false });
  const publicDir = path.join(process.cwd(), "public");
  let parseRunning = false;
  let analyzeRunning = false;

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

  const resolveGatewayAuth = (cfg: OpenClawConfigRecord): { token?: string; password?: string } => {
    const gateway = (cfg.gateway ?? {}) as Record<string, unknown>;
    const auth = (gateway.auth ?? {}) as Record<string, unknown>;
    const token = typeof auth.token === "string" ? auth.token : undefined;
    const password = typeof auth.password === "string" ? auth.password : undefined;
    return { token, password };
  };

  const resolveGatewayUrl = (cfg: OpenClawConfigRecord): string => {
    const gateway = (cfg.gateway ?? {}) as Record<string, unknown>;
    const portRaw = gateway.port;
    const port = typeof portRaw === "number" && Number.isFinite(portRaw) ? Math.floor(portRaw) : 18789;
    return `ws://127.0.0.1:${port}`;
  };

  app.post("/api/tasks/analyze", async (request, reply) => {
    if (analyzeRunning) {
      reply.code(409);
      return { error: "analysis already running" };
    }
    analyzeRunning = true;
    const startedAt = Date.now();
    try {
      const body = (request.body ?? {}) as {
        taskIds?: string[];
        limit?: number;
        force?: boolean;
        timeoutSeconds?: number;
      };

      const config = loadConfig({ stateDir: params.stateDir });
      const analysisAgentId = config.analysisAgentId || EVOLUTION_AGENT_ID;
      const timeoutSeconds = normalizePositiveInt(body?.timeoutSeconds, config.analysisTimeoutSeconds ?? 120);
      const force = body?.force === true;

      if (analysisAgentId.toLowerCase() === EVOLUTION_AGENT_ID) {
        ensureEvolutionAgent({ stateDir: params.stateDir });
      }

      const tasks = await loadTaskRecords(params.stateDir);
      const existing = force ? new Set<string>() : await loadAnalysisIndex(params.stateDir);
      const requestedIds = Array.isArray(body?.taskIds)
        ? body.taskIds.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim())
        : [];
      const pending = requestedIds.length
        ? tasks.filter((task) => requestedIds.includes(task.taskId))
        : tasks.filter((task) => !existing.has(task.taskId));

      const limit = normalizePositiveInt(body?.limit, 0);
      const selected = limit > 0 ? pending.slice(0, limit) : pending;
      if (selected.length === 0) {
        return {
          ok: true,
          result: { selected: 0, analyzed: 0, failed: 0, appended: 0, durationMs: Date.now() - startedAt, note: "no tasks to analyze" },
        };
      }

      const openclawConfigPath = resolveOpenClawConfigPath(params.stateDir, undefined);
      const { config: openclawConfig } = loadOpenClawConfig(openclawConfigPath);
      const auth = resolveGatewayAuth(openclawConfig);

      let readyResolve: (() => void) | undefined;
      let readyReject: ((err: Error) => void) | undefined;
      const ready = new Promise<void>((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
      });

      const client = new GatewayCaptureClient({
        url: resolveGatewayUrl(openclawConfig),
        token: auth.token,
        password: auth.password,
        stateDir: params.stateDir,
        onHello: () => readyResolve?.(),
        onError: (err) => readyReject?.(err),
      });

      client.start();
      await ready;

      let analyzed = 0;
      let failed = 0;
      let appended = 0;
      try {
        for (const candidate of selected) {
          try {
            const record = await analyzeTaskCandidate({
              candidate,
              client,
              analysisAgentId,
              timeoutSeconds,
              extraSystemPrompt:
                "Only respond with JSON. Follow the self-evolution skill Task Candidate Analysis section. Use tools only when needed. Do not include Markdown or code fences.",
            });
            analyzed += 1;
            appendAnalysisRecords([record], params.stateDir);
            appended += 1;
          } catch (err) {
            failed += 1;
            // keep going
          }
        }
      } finally {
        client.stop();
      }

      return {
        ok: true,
        result: {
          selected: selected.length,
          analyzed,
          failed,
          appended,
          durationMs: Date.now() - startedAt,
        },
      };
    } catch (err) {
      reply.code(500);
      return { error: (err as Error).message };
    } finally {
      analyzeRunning = false;
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
