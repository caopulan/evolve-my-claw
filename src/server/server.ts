import path from "node:path";
import fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { buildTimeline, getSessions, getTasks, getAnalyses } from "./api.js";
import {
  getEvolutionReports,
  parseChangeTargets,
  parseDimensions,
  runEvolutionAnalysis,
} from "../evolution/service.js";
import { applyEvolutionChange } from "../evolution/change-apply.js";
import { EVOLUTION_AGENT_ID } from "../evolution/constants.js";

export async function startServer(params: {
  host: string;
  port: number;
  stateDir: string;
}) {
  const app = fastify({ logger: false });
  const publicDir = path.join(process.cwd(), "public");

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
    };
    const taskIds = Array.isArray(body?.taskIds)
      ? body.taskIds.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim())
      : [];
    if (taskIds.length === 0) {
      reply.code(400);
      return { error: "taskIds required" };
    }
    const dimensions = parseDimensions(body?.dimensions);
    const changeTargets = parseChangeTargets(body?.changeTargets);
    if (dimensions.length === 0) {
      reply.code(400);
      return { error: "dimensions required" };
    }
    if (changeTargets.length === 0) {
      reply.code(400);
      return { error: "changeTargets required" };
    }

    try {
      const report = await runEvolutionAnalysis({
        stateDir: params.stateDir,
        taskIds,
        dimensions,
        changeTargets,
        analysisAgentId: EVOLUTION_AGENT_ID,
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
