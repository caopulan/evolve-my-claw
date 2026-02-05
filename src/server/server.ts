import path from "node:path";
import fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { buildTimeline, getSessions, getTasks, getAnalyses } from "./api.js";

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

  await app.register(fastifyStatic, {
    root: publicDir,
    wildcard: false,
    index: "index.html",
  });

  await app.listen({ host: params.host, port: params.port });
}
