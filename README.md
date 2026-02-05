# Evolve My Claw

External timeline + evolution tooling for OpenClaw. This MVP provides:

- Session timeline UI (messages, tool calls, compactions, subagent runs)
- Optional capture of gateway agent events to JSONL
- Zero changes required inside the OpenClaw repo

## Quick start

```bash
pnpm install
pnpm build
node dist/cli.js serve
```

Open `http://127.0.0.1:4797` in your browser.

## Capture live agent events (optional)

```bash
node dist/cli.js capture
```

This writes JSONL to:

```
~/.openclaw/evolve-my-claw/agent-events.jsonl
```

You can override the gateway URL or auth:

```bash
node dist/cli.js capture --url ws://127.0.0.1:18789 --token <token>
```

## Parse task candidates (optional)

```bash
node dist/cli.js parse
```

This appends candidate tasks to:

```
~/.openclaw/evolve-my-claw/tasks.jsonl
```

By default it skips sessions from analyzer agents and filters outbound message sends. You can override defaults with a config file at:

```
~/.openclaw/evolve-my-claw/config.json
```

Example:

```json
{
  "excludeAgentIds": ["evolver"],
  "excludeTools": ["message/send", "message/thread-reply"]
}
```

## Notes

- Tool start/update events are not globally broadcast by the gateway. The UI relies on session transcripts for tool timing.
- The viewer parses OpenClaw session transcripts and subagent registry files directly.

## Commands

- `emc serve`: start the local UI server
- `emc capture`: capture gateway agent events to JSONL
- `emc parse`: build task candidates and append to tasks.jsonl

## Agent install note

Agent-facing install/start instructions live in `docs/agent-install.md`.
