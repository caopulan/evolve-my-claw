import fs from "node:fs";
import readline from "node:readline";

export type TimelineEvent = {
  id: string;
  ts: number;
  kind: string;
  sessionKey: string;
  sessionId: string;
  toolCallId?: string;
  toolName?: string;
  runId?: string;
  durationMs?: number;
  summary?: string;
  details?: Record<string, unknown>;
};

type ToolCallRecord = {
  toolCallId: string;
  toolName: string;
  args?: unknown;
  startTs: number;
  result?: unknown;
  endTs?: number;
  isError?: boolean;
};

function parseTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return null;
}

function extractText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const entry = item as Record<string, unknown>;
    if (entry.type === "text" && typeof entry.text === "string") {
      parts.push(entry.text);
    }
  }
  return parts.join("\n");
}

function extractThinking(content: unknown): Array<{ text: string; signature?: string }> {
  if (!Array.isArray(content)) {
    return [];
  }
  const thoughts: Array<{ text: string; signature?: string }> = [];
  for (const item of content) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const entry = item as Record<string, unknown>;
    if (entry.type !== "thinking") {
      continue;
    }
    const text = typeof entry.thinking === "string" ? entry.thinking.trim() : "";
    const signature = typeof entry.thinkingSignature === "string" ? entry.thinkingSignature : undefined;
    if (text || signature) {
      thoughts.push({ text, signature });
    }
  }
  return thoughts;
}

function summarize(text: string, limit = 140): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) {
    return trimmed;
  }
  return `${trimmed.slice(0, limit)}…`;
}

function buildToolSummary(name: string, args?: unknown): string {
  if (!args || typeof args !== "object") {
    return name;
  }
  const record = args as Record<string, unknown>;
  const path = typeof record.path === "string" ? record.path : undefined;
  const command = typeof record.command === "string" ? record.command : undefined;
  if (path) {
    return `${name} ${path}`;
  }
  if (command) {
    return `${name} ${summarize(command, 80)}`;
  }
  return name;
}

export async function parseSessionTranscript(params: {
  sessionFile: string;
  sessionKey: string;
  sessionId: string;
}): Promise<TimelineEvent[]> {
  const events: TimelineEvent[] = [];
  const toolCalls = new Map<string, ToolCallRecord>();

  if (!fs.existsSync(params.sessionFile)) {
    return events;
  }

  const stream = fs.createReadStream(params.sessionFile, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let lineNo = 0;
  for await (const line of rl) {
    lineNo += 1;
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let entry: Record<string, unknown> | null = null;
    try {
      entry = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!entry) {
      continue;
    }

    const entryType = typeof entry.type === "string" ? entry.type : "";
    const entryTs = parseTimestamp(entry.timestamp) ?? Date.now();

    if (entryType === "message") {
      const message = (entry.message ?? {}) as Record<string, unknown>;
      const role = typeof message.role === "string" ? message.role : "";
      const msgTs = parseTimestamp(message.timestamp) ?? entryTs;
      const content = message.content;

      if (role === "user") {
        const text = extractText(content) || String(content ?? "");
        if (text) {
          events.push({
            id: `msg-user-${lineNo}`,
            ts: msgTs,
            kind: "user_message",
            sessionKey: params.sessionKey,
            sessionId: params.sessionId,
            summary: summarize(text),
            details: { text },
          });
        }
      }

      if (role === "assistant") {
        const text = extractText(content);
        const thinkingItems = extractThinking(content);
        const thinkingText = thinkingItems.map((item) => item.text).filter(Boolean).join("\n\n");
        if (text || thinkingText) {
          events.push({
            id: `msg-assistant-${lineNo}`,
            ts: msgTs,
            kind: "assistant_message",
            sessionKey: params.sessionKey,
            sessionId: params.sessionId,
            summary: text
              ? summarize(text)
              : thinkingText
                ? `Thinking: ${summarize(thinkingText)}`
                : "Assistant message",
            details: {
              ...(text ? { text } : {}),
              ...(thinkingItems.length > 0 ? { thinking: thinkingItems } : {}),
            },
          });
        }
        if (Array.isArray(content)) {
          for (const item of content) {
            if (!item || typeof item !== "object") {
              continue;
            }
            const entryItem = item as Record<string, unknown>;
            const type = typeof entryItem.type === "string" ? entryItem.type : "";
            if (type.toLowerCase() !== "toolcall") {
              continue;
            }
            const toolCallId = typeof entryItem.id === "string" ? entryItem.id : "";
            const toolName = typeof entryItem.name === "string" ? entryItem.name : "tool";
            const args = entryItem.arguments;
            if (!toolCallId) {
              continue;
            }
            toolCalls.set(toolCallId, {
              toolCallId,
              toolName,
              args,
              startTs: msgTs,
            });
          }
        }
      }

      if (role === "toolResult") {
        const toolCallId = typeof message.toolCallId === "string" ? message.toolCallId : "";
        const toolName = typeof message.toolName === "string" ? message.toolName : "tool";
        const isError = Boolean(message.isError);
        const result = message.content ?? message;
        if (toolCallId) {
          const existing = toolCalls.get(toolCallId);
          if (existing) {
            existing.result = result;
            existing.endTs = msgTs;
            existing.isError = isError;
          } else {
            toolCalls.set(toolCallId, {
              toolCallId,
              toolName,
              startTs: msgTs,
              endTs: msgTs,
              result,
              isError,
            });
          }
        }
      }
      continue;
    }

    if (entryType === "compaction") {
      events.push({
        id: `compaction-${lineNo}`,
        ts: entryTs,
        kind: "compaction",
        sessionKey: params.sessionKey,
        sessionId: params.sessionId,
        summary: summarize(String(entry.summary ?? "Compaction")),
        details: entry,
      });
      continue;
    }

    if (entryType === "branch_summary") {
      events.push({
        id: `branch-${lineNo}`,
        ts: entryTs,
        kind: "branch_summary",
        sessionKey: params.sessionKey,
        sessionId: params.sessionId,
        summary: summarize(String(entry.summary ?? "Branch summary")),
        details: entry,
      });
      continue;
    }

    if (entryType === "model_change") {
      const provider = typeof entry.provider === "string" ? entry.provider : "";
      const model = typeof entry.modelId === "string" ? entry.modelId : "";
      const summary = provider || model ? `Model: ${provider}/${model}` : "Model change";
      events.push({
        id: `model-${lineNo}`,
        ts: entryTs,
        kind: "model_change",
        sessionKey: params.sessionKey,
        sessionId: params.sessionId,
        summary,
        details: entry,
      });
      continue;
    }

    if (entryType === "thinking_level_change") {
      const level = typeof entry.thinkingLevel === "string" ? entry.thinkingLevel : "";
      events.push({
        id: `thinking-${lineNo}`,
        ts: entryTs,
        kind: "thinking_level_change",
        sessionKey: params.sessionKey,
        sessionId: params.sessionId,
        summary: level ? `Thinking: ${level}` : "Thinking level change",
        details: entry,
      });
      continue;
    }

    if (entryType === "session_info") {
      const name = typeof entry.name === "string" ? entry.name : "";
      events.push({
        id: `session-info-${lineNo}`,
        ts: entryTs,
        kind: "session_info",
        sessionKey: params.sessionKey,
        sessionId: params.sessionId,
        summary: name ? `Session: ${name}` : "Session info",
        details: entry,
      });
      continue;
    }
  }

  for (const record of toolCalls.values()) {
    const duration = record.endTs ? record.endTs - record.startTs : undefined;
    events.push({
      id: `tool-${record.toolCallId}`,
      ts: record.startTs,
      kind: "tool",
      sessionKey: params.sessionKey,
      sessionId: params.sessionId,
      toolCallId: record.toolCallId,
      toolName: record.toolName,
      durationMs: duration,
      summary: buildToolSummary(record.toolName, record.args),
      details: {
        args: record.args,
        result: record.result,
        isError: record.isError,
        endedAt: record.endTs,
      },
    });
  }

  events.sort((a, b) => a.ts - b.ts);
  return events;
}
