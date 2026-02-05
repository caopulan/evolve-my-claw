#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { resolveOpenClawStateDir, resolveTelemetryDir, ensureDir } from "./paths.js";
import { startServer } from "./server/server.js";
import { GatewayCaptureClient } from "./gateway/client.js";
import { loadConfig } from "./config.js";
import { listSessions } from "./ingest/session-store.js";
import { parseSessionTranscript } from "./ingest/session-transcript.js";
import { buildTaskCandidates } from "./tasks/task-parser.js";
import { appendTaskRecords, loadTaskIndex } from "./tasks/task-store.js";

const program = new Command();

program.name("emc").description("Evolve My Claw - timeline + evolution tooling for OpenClaw");

program
  .command("serve")
  .description("Start local timeline server and UI")
  .option("--host <host>", "Host to bind", "127.0.0.1")
  .option("--port <port>", "Port to bind", "4797")
  .option("--state-dir <dir>", "OpenClaw state dir override")
  .action(async (opts) => {
    const stateDir = opts.stateDir ? path.resolve(opts.stateDir) : resolveOpenClawStateDir();
    const host = String(opts.host ?? "127.0.0.1");
    const port = Number.parseInt(String(opts.port ?? "4797"), 10);
    await startServer({ host, port: Number.isFinite(port) ? port : 4797, stateDir });
    console.log(`evolve-my-claw: UI ready at http://${host}:${Number.isFinite(port) ? port : 4797}`);
  });

program
  .command("capture")
  .description("Capture gateway agent events to JSONL for timeline enrichment")
  .option("--url <wsUrl>", "Gateway WebSocket URL", "ws://127.0.0.1:18789")
  .option("--token <token>", "Gateway token (if required)")
  .option("--password <password>", "Gateway password (if required)")
  .option("--state-dir <dir>", "OpenClaw state dir override")
  .option("--out <file>", "Output JSONL path")
  .action((opts) => {
    const stateDir = opts.stateDir ? path.resolve(opts.stateDir) : resolveOpenClawStateDir();
    const telemetryDir = resolveTelemetryDir(stateDir);
    ensureDir(telemetryDir);
    const outPath = opts.out ? path.resolve(opts.out) : path.join(telemetryDir, "agent-events.jsonl");
    const stream = fs.createWriteStream(outPath, { flags: "a" });

    const client = new GatewayCaptureClient({
      url: String(opts.url),
      token: opts.token ? String(opts.token) : undefined,
      password: opts.password ? String(opts.password) : undefined,
      stateDir,
      onEvent: (evt) => {
        if (evt.event !== "agent") {
          return;
        }
        const payload = typeof evt.payload === "object" && evt.payload ? (evt.payload as Record<string, unknown>) : undefined;
        const ts = typeof payload?.ts === "number" ? payload.ts : Date.now();
        stream.write(
          `${JSON.stringify({ event: evt.event, payload, seq: evt.seq, ts })}\n`,
        );
      },
      onError: (err) => {
        console.error(`capture error: ${err.message}`);
      },
      onClose: (code, reason) => {
        console.error(`gateway closed (${code}): ${reason}`);
      },
    });

    process.on("SIGINT", () => {
      stream.end();
      client.stop();
      process.exit(0);
    });

    client.start();
    console.log(`evolve-my-claw: capturing agent events -> ${outPath}`);
  });

program
  .command("parse")
  .description("Parse sessions into task candidates and append to tasks.jsonl")
  .option("--state-dir <dir>", "OpenClaw state dir override")
  .option("--config <file>", "Config JSON path override")
  .option("--dry-run", "Do not write tasks.jsonl")
  .action(async (opts) => {
    const stateDir = opts.stateDir ? path.resolve(opts.stateDir) : resolveOpenClawStateDir();
    const configPath = opts.config ? path.resolve(opts.config) : undefined;
    const config = loadConfig({ stateDir, configPath });
    const excludeIds = new Set(config.excludeAgentIds.map((id) => id.toLowerCase()));
    const sessions = listSessions(stateDir).filter((session) => !excludeIds.has(session.agentId.toLowerCase()));

    const existing = await loadTaskIndex(stateDir);
    const pending = [];

    let sessionCount = 0;
    let candidateCount = 0;
    let skipped = 0;

    for (const session of sessions) {
      sessionCount += 1;
      const events = await parseSessionTranscript({
        sessionFile: session.sessionFile ?? "",
        sessionKey: session.key,
        sessionId: session.sessionId,
      });
      const candidates = buildTaskCandidates({ session, events, config });
      candidateCount += candidates.length;
      for (const candidate of candidates) {
        if (existing.has(candidate.taskId)) {
          skipped += 1;
          continue;
        }
        pending.push(candidate);
        existing.add(candidate.taskId);
      }
    }

    const appended = opts.dryRun ? 0 : appendTaskRecords(pending, stateDir);

    console.log(
      `evolve-my-claw: parsed ${sessionCount} sessions, ${candidateCount} candidates (${pending.length} new, ${skipped} existing)`,
    );
    if (opts.dryRun) {
      console.log("evolve-my-claw: dry-run enabled; no tasks were written");
    } else {
      console.log(`evolve-my-claw: appended ${appended} tasks`);
    }
  });

program.parse();
