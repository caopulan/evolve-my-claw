#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { Command } from "commander";
import { resolveOpenClawStateDir, resolveTelemetryDir, ensureDir } from "./paths.js";
import { startServer } from "./server/server.js";
import { GatewayCaptureClient } from "./gateway/client.js";
import { loadConfig } from "./config.js";
import { listSessions } from "./ingest/session-store.js";
import { parseSessionTranscript } from "./ingest/session-transcript.js";
import { buildTaskCandidates, mergeSubagentCandidates } from "./tasks/task-parser.js";
import { appendTaskRecords, loadTaskIndex, loadTaskRecords } from "./tasks/task-store.js";
import { analyzeTaskCandidate } from "./tasks/task-analyzer.js";
import { appendAnalysisRecords, loadAnalysisIndex } from "./tasks/analysis-store.js";
import { ensureEvolutionAgent } from "./evolution/ensure-agent.js";
import { EVOLUTION_AGENT_ID } from "./evolution/constants.js";

const program = new Command();

program.name("emc").description("Evolve My Claw - timeline + evolution tooling for OpenClaw");

program
  .command("serve")
  .description("Start local timeline server and UI")
  .option("--host <host>", "Host to bind", "127.0.0.1")
  .option("--port <port>", "Port to bind", "4797")
  .option("--state-dir <dir>", "OpenClaw state dir override")
  .option("--daemon", "Run server in background (detached)")
  .option("--pid-file <file>", "PID file path (daemon mode)")
  .option("--log-file <file>", "Log file path (daemon mode)")
  .action(async (opts) => {
    const stateDir = opts.stateDir ? path.resolve(opts.stateDir) : resolveOpenClawStateDir();
    const host = String(opts.host ?? "127.0.0.1");
    const port = Number.parseInt(String(opts.port ?? "4797"), 10);

    const resolvedPort = Number.isFinite(port) ? port : 4797;

    // In some environments, background processes started by tooling can be reaped when the
    // parent command exits. Daemon mode spawns a detached child so the server survives.
    const daemon = Boolean(opts.daemon) && process.env.EMC_DAEMON_CHILD !== "1";
    if (daemon) {
      const defaultPidFile = path.join(resolveTelemetryDir(stateDir), "serve.pid");
      const defaultLogFile = path.join(resolveTelemetryDir(stateDir), "serve.log");
      const pidFile = opts.pidFile ? path.resolve(String(opts.pidFile)) : defaultPidFile;
      const logFile = opts.logFile ? path.resolve(String(opts.logFile)) : defaultLogFile;

      ensureDir(path.dirname(pidFile));
      ensureDir(path.dirname(logFile));

      const out = fs.openSync(logFile, "a");
      const child = spawn(
        process.execPath,
        [path.join(process.cwd(), "dist", "cli.js"), "serve", "--host", host, "--port", String(resolvedPort), "--state-dir", stateDir],
        {
          detached: true,
          stdio: ["ignore", out, out],
          env: { ...process.env, EMC_DAEMON_CHILD: "1" },
        },
      );
      child.unref();
      fs.writeFileSync(pidFile, `${child.pid}\n`, "utf8");

      console.log(`evolve-my-claw: daemon started (pid ${child.pid})`);
      console.log(`evolve-my-claw: logs -> ${logFile}`);
      console.log(`evolve-my-claw: pid  -> ${pidFile}`);
      console.log(`evolve-my-claw: UI ready at http://${host}:${resolvedPort}`);
      return;
    }

    await startServer({ host, port: resolvedPort, stateDir });
    console.log(`evolve-my-claw: UI ready at http://${host}:${resolvedPort}`);
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
      caps: ["tool-events"],
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
    const allCandidates = [];

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
      allCandidates.push(...candidates);
    }

    const mergedCandidates = mergeSubagentCandidates(allCandidates);
    for (const candidate of mergedCandidates) {
      if (existing.has(candidate.taskId)) {
        skipped += 1;
        continue;
      }
      pending.push(candidate);
      existing.add(candidate.taskId);
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

program
  .command("evolution")
  .description("Ensure evolve-my-claw agent exists with dedicated workspace and full tools/skills")
  .option("--state-dir <dir>", "OpenClaw state dir override")
  .option("--openclaw-config <file>", "OpenClaw config path override")
  .option("--source-agent <id>", "Copy auth/models/workspace files from agent", "main")
  .option("--no-copy-skills", "Do not copy workspace skills from the source agent")
  .action((opts) => {
    const stateDir = opts.stateDir ? path.resolve(opts.stateDir) : resolveOpenClawStateDir();
    const ensure = ensureEvolutionAgent({
      stateDir,
      configPath: opts.openclawConfig ? path.resolve(String(opts.openclawConfig)) : undefined,
      sourceAgentId: opts.sourceAgent ? String(opts.sourceAgent).trim() : undefined,
      copySkills: opts.copySkills !== false,
    });

    const notes = [
      ensure.updatedConfig
        ? `updated OpenClaw config at ${ensure.configPath}`
        : `OpenClaw config already includes ${ensure.agentId}`,
      ensure.createdWorkspace
        ? `created workspace at ${ensure.workspaceDir}`
        : `workspace already present at ${ensure.workspaceDir}`,
      ensure.createdAgentDir
        ? `created agent dir at ${ensure.agentDir}`
        : `agent dir already present at ${ensure.agentDir}`,
    ];
    for (const note of notes) {
      console.log(`evolve-my-claw: ${note}`);
    }
    for (const note of ensure.notes) {
      console.log(`evolve-my-claw: ${note}`);
    }
  });

program
  .command("analyze")
  .description("Analyze task candidates via OpenClaw agent and append analysis JSONL")
  .option("--state-dir <dir>", "OpenClaw state dir override")
  .option("--config <file>", "Config JSON path override")
  .option("--openclaw-config <file>", "OpenClaw config path override")
  .option("--agent <id>", "Agent id for analysis (default from config)")
  .option("--url <wsUrl>", "Gateway WebSocket URL", "ws://127.0.0.1:18789")
  .option("--token <token>", "Gateway token (if required)")
  .option("--password <password>", "Gateway password (if required)")
  .option("--limit <n>", "Max tasks to analyze (0 = all)", "0")
  .option("--timeout-seconds <n>", "Agent timeout seconds", "120")
  .option("--dry-run", "Do not write tasks.analysis.jsonl")
  .option("--force", "Re-analyze tasks even if analysis exists", false)
  .action(async (opts) => {
    const stateDir = opts.stateDir ? path.resolve(opts.stateDir) : resolveOpenClawStateDir();
    const configPath = opts.config ? path.resolve(opts.config) : undefined;
    const config = loadConfig({ stateDir, configPath });
    const analysisAgentId = (opts.agent ? String(opts.agent).trim() : config.analysisAgentId).trim();
    const timeoutSeconds = Number.parseInt(String(opts.timeoutSeconds ?? "120"), 10);
    if (!analysisAgentId) {
      throw new Error("analysis agent id is required");
    }
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
      throw new Error("--timeout-seconds must be a positive integer");
    }

    const tasks = await loadTaskRecords(stateDir);
    const existing = opts.force ? new Set<string>() : await loadAnalysisIndex(stateDir);
    const pending = tasks.filter((task) => !existing.has(task.taskId));
    const limit = Number.parseInt(String(opts.limit ?? "0"), 10);
    const selected = Number.isFinite(limit) && limit > 0 ? pending.slice(0, limit) : pending;

    if (selected.length === 0) {
      console.log("evolve-my-claw: no tasks to analyze");
      return;
    }

    if (analysisAgentId.toLowerCase() === EVOLUTION_AGENT_ID) {
      const ensure = ensureEvolutionAgent({
        stateDir,
        configPath: opts.openclawConfig ? path.resolve(String(opts.openclawConfig)) : undefined,
      });
      if (ensure.updatedConfig) {
        console.log(`evolve-my-claw: updated OpenClaw config at ${ensure.configPath}`);
      }
      if (ensure.createdWorkspace) {
        console.log(`evolve-my-claw: created workspace at ${ensure.workspaceDir}`);
      }
      if (ensure.createdAgentDir) {
        console.log(`evolve-my-claw: created agent dir at ${ensure.agentDir}`);
      }
    }

    let readyResolve: (() => void) | undefined;
    let readyReject: ((err: Error) => void) | undefined;
    const ready = new Promise<void>((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });

    const client = new GatewayCaptureClient({
      url: String(opts.url),
      token: opts.token ? String(opts.token) : undefined,
      password: opts.password ? String(opts.password) : undefined,
      stateDir,
      onHello: () => readyResolve?.(),
      onError: (err) => {
        readyReject?.(err);
        console.error(`gateway error: ${err.message}`);
      },
    });

    client.start();
    await ready;

    let analyzed = 0;
    let failed = 0;
    for (const candidate of selected) {
      try {
        const record = await analyzeTaskCandidate({
          candidate,
          client,
          analysisAgentId,
          timeoutSeconds,
          extraSystemPrompt:
            "Only respond with JSON. Do not use tools. Do not include Markdown or code fences.",
        });
        analyzed += 1;
        if (!opts.dryRun) {
          appendAnalysisRecords([record], stateDir);
        }
      } catch (err) {
        failed += 1;
        console.error(`analysis failed for ${candidate.taskId}: ${(err as Error).message}`);
      }
    }

    client.stop();
    console.log(
      `evolve-my-claw: analyzed ${analyzed}/${selected.length} tasks (failed ${failed})`,
    );
    if (opts.dryRun) {
      console.log("evolve-my-claw: dry-run enabled; no analyses were written");
    }
  });

program.parse();
