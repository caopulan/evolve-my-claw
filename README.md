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
  "excludeAgentIds": ["evolve-my-claw"],
  "excludeTools": ["message/send", "message/thread-reply"],
  "analysisAgentId": "evolve-my-claw",
  "analysisTimeoutSeconds": 120,
  "evolutionAnalysis": {
    "scopeDays": 5,
    "agentIds": [],
    "focus": [],
    "dimensions": [
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
      "E4"
    ],
    "changeTargets": ["config", "workspace", "extensions"],
    "useSearch": false
  }
}
```

## Analyze tasks with OpenClaw (optional)

```bash
node dist/cli.js analyze --agent evolve-my-claw
```

This appends analysis records to:

```
~/.openclaw/evolve-my-claw/tasks.analysis.jsonl
```

If the gateway requires auth:

```bash
node dist/cli.js analyze --agent evolve-my-claw --token <gateway-token>
```

## Ensure evolution agent (recommended once)

```bash
node dist/cli.js evolution
```

This ensures an `evolve-my-claw` agent exists in OpenClaw with its own workspace
and full tools/skills enabled.

## Evolution analysis (UI)

1. Open the UI (`node dist/cli.js serve`).
2. Select tasks in the sidebar.
3. Switch to the **Evolution** tab.
4. Choose analysis dimensions + change targets, then click **Run evolution analysis**.

Reports are written to:

```
~/.openclaw/evolve-my-claw/evolution.reports.jsonl
```

Each change can be applied from the UI (safe, scoped file operations + config merge patches).

Note: If you upgrade evolution analysis dimensions/config (e.g. switching to the self-evolution dimension set), delete the old `evolution.reports.jsonl` to avoid stale schema conflicts.

## Notes

- Tool start/update events are not globally broadcast by the gateway. The UI relies on session transcripts for tool timing.
- The viewer parses OpenClaw session transcripts and subagent registry files directly.

## Commands

- `emc serve`: start the local UI server
- `emc capture`: capture gateway agent events to JSONL
- `emc parse`: build task candidates and append to tasks.jsonl
- `emc analyze`: analyze task candidates and append tasks.analysis.jsonl

## Agent install note

Agent-facing install/start instructions live in `docs/agent-install.md`.
