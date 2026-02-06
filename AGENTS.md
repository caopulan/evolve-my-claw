# AGENTS.md

This repository contains **Evolve My Claw**, an external timeline and evolution toolkit for OpenClaw.

## Goals

- Provide a standalone timeline viewer for OpenClaw sessions.
- Optionally capture gateway agent events into JSONL for enrichment.
- Generate task-level logs (JSONL) from OpenClaw sessions without explicit task markers.
- Analyze task candidates with OpenClaw itself (LLM) and append structured analysis JSONL.
- Avoid modifying the OpenClaw repo unless explicitly requested.

## OpenClaw Source (Reference)

- OpenClaw source repo: https://github.com/openclaw/openclaw
- Keep a local clone of OpenClaw available for reference when changing this repo's code (schemas, session log formats, gateway events, config behavior, etc.).
- Prefer a sibling checkout:

```bash
cd ..
git clone https://github.com/openclaw/openclaw.git openclaw
```

- Alternatively, clone into a temp folder:

```bash
git clone https://github.com/openclaw/openclaw.git "${TMPDIR:-/tmp}/openclaw"
```

- Alternatively, keep the clone inside this repo (gitignored):

```bash
mkdir -p .tmp
git clone https://github.com/openclaw/openclaw.git .tmp/openclaw
```

- Treat the OpenClaw clone as read-only unless explicitly requested to modify OpenClaw itself.

## GitHub Description

Task-first telemetry for OpenClaw—merge subagents, visualize timelines, drive evolution.

## Capabilities

- **Task candidates**: `emc parse` scans session transcripts and writes candidate tasks to `~/.openclaw/evolve-my-claw/tasks.jsonl`. Each user message is a task boundary; tasks with no tool calls are filtered out.
- **Task analysis**: `emc analyze` sends each candidate to an OpenClaw agent and writes `~/.openclaw/evolve-my-claw/tasks.analysis.jsonl` with structured JSON analysis.
- **Event capture**: `emc capture` connects to the gateway and appends agent events to `~/.openclaw/evolve-my-claw/agent-events.jsonl`.
- **Timeline UI**: `emc serve` reads local session logs + optional captured events and serves a timeline viewer.
- **Rule-driven evolution**: evolution analysis first matches deterministic rules (evidence + seed changes), then asks an OpenClaw agent to refine the final report. Built-in rules live in `rules/builtin.rules.json5`; per-device overrides live in `~/.openclaw/evolve-my-claw/rules/*.json5`.

## Config (JSON)

Default path: `~/.openclaw/evolve-my-claw/config.json`

```json
{
  "excludeAgentIds": ["evolver"],
  "excludeTools": ["message/send", "message/thread-reply"],
  "analysisAgentId": "evolver",
  "analysisTimeoutSeconds": 120
}
```

Notes:
- Exclude the analysis agent (`analysisAgentId`) to avoid log recursion.
- Filter outbound send tools (`message/send`, `message/thread-reply`) so messaging isn’t treated as task work.

## Project Layout

- `src/cli.ts`: CLI entrypoint (`emc`).
- `src/server/`: Local HTTP server + API.
- `src/ingest/`: Parsers for session transcripts, subagent registry, and captured events.
- `src/tasks/`: Task candidate parsing + LLM analysis.
- `public/`: Static UI (HTML/CSS/JS).

## Commands

- Install: `pnpm install`
- Build: `pnpm build`
- Run UI: `node dist/cli.js serve`
- Capture events: `node dist/cli.js capture`
- Parse task candidates: `node dist/cli.js parse`
- Analyze tasks (LLM): `node dist/cli.js analyze --agent <agentId>`

## Data Sources

- Session transcripts: `~/.openclaw/agents/<agentId>/sessions/*.jsonl`
- Session index: `~/.openclaw/agents/<agentId>/sessions/sessions.json`
- Subagent registry: `~/.openclaw/subagents/runs.json`
- Captured events (this tool): `~/.openclaw/evolve-my-claw/agent-events.jsonl`
- Task candidates: `~/.openclaw/evolve-my-claw/tasks.jsonl`
- Task analysis: `~/.openclaw/evolve-my-claw/tasks.analysis.jsonl`

## Coding Notes

- TypeScript (ESM). Keep strict typing and avoid `any`.
- Prefer small, focused modules. Keep ingestion logic pure and testable.
- Keep UI changes in `public/` simple and dependency-free.
- Every change should include a git commit.
- Use concise, scoped commit messages (e.g. `UI: add subagent expanders`) and push after finishing the change.

## Testing

- `pnpm build` is the minimum correctness check.
