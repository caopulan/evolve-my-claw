import fs from "node:fs";
import readline from "node:readline";
import { resolveOpenClawStateDir, resolveTelemetryDir } from "../paths.js";
import type { TimelineEvent } from "./session-transcript.js";

export type CapturedAgentEvent = {
  event: string;
  payload?: Record<string, unknown>;
  seq?: number;
  ts: number;
};

export function resolveAgentEventsPath(stateDir = resolveOpenClawStateDir()): string {
  return `${resolveTelemetryDir(stateDir)}/agent-events.jsonl`;
}

export async function loadCapturedAgentEvents(params: {
  stateDir?: string;
  sessionKey?: string;
}): Promise<CapturedAgentEvent[]> {
  const stateDir = params.stateDir ?? resolveOpenClawStateDir();
  const filePath = resolveAgentEventsPath(stateDir);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const events: CapturedAgentEvent[] = [];
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as CapturedAgentEvent;
      if (params.sessionKey) {
        const sessionKey = typeof parsed.payload?.sessionKey === "string" ? parsed.payload.sessionKey : undefined;
        if (sessionKey && sessionKey !== params.sessionKey) {
          continue;
        }
      }
      events.push(parsed);
    } catch {
      // ignore
    }
  }
  return events;
}

export function capturedEventsToTimeline(events: CapturedAgentEvent[], sessionKey: string, sessionId: string): TimelineEvent[] {
  return events
    .filter((evt) => evt.event === "agent")
    .map((evt, idx) => {
      const payload = evt.payload ?? {};
      const stream = typeof payload.stream === "string" ? payload.stream : "agent";
      const summary = typeof payload.data === "object" && payload.data && "phase" in payload.data
        ? `agent ${String((payload.data as { phase?: unknown }).phase ?? stream)}`
        : `agent ${stream}`;
      return {
        id: `agent-${idx}-${evt.seq ?? ""}`,
        ts: evt.ts,
        kind: "agent_event",
        sessionKey,
        sessionId,
        summary,
        details: payload,
      };
    });
}
