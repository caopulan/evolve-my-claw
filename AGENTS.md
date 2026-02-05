# AGENTS.md

This repository contains **Evolve My Claw**, an external timeline and evolution toolkit for OpenClaw.

## Goals

- Provide a standalone timeline viewer for OpenClaw sessions.
- Optionally capture gateway agent events into JSONL for enrichment.
- Avoid modifying the OpenClaw repo unless explicitly requested.

## Project Layout

- `src/cli.ts`: CLI entrypoint (`emc`).
- `src/server/`: Local HTTP server + API.
- `src/ingest/`: Parsers for session transcripts, subagent registry, and captured events.
- `public/`: Static UI (HTML/CSS/JS).

## Commands

- Install: `pnpm install`
- Build: `pnpm build`
- Run UI: `node dist/cli.js serve`
- Capture events: `node dist/cli.js capture`

## Data Sources

- Session transcripts: `~/.openclaw/agents/<agentId>/sessions/*.jsonl`
- Session index: `~/.openclaw/agents/<agentId>/sessions/sessions.json`
- Subagent registry: `~/.openclaw/subagents/runs.json`
- Captured events (this tool): `~/.openclaw/evolve-my-claw/agent-events.jsonl`

## Coding Notes

- TypeScript (ESM). Keep strict typing and avoid `any`.
- Prefer small, focused modules. Keep ingestion logic pure and testable.
- Keep UI changes in `public/` simple and dependency-free.
- Every change should include a git commit.

## Testing

- `pnpm build` is the minimum correctness check.
