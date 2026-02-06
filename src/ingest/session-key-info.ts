export type ParsedAgentSessionKey = {
  agentId: string;
  rest: string;
};

export function parseAgentSessionKey(sessionKey: string | undefined | null): ParsedAgentSessionKey | null {
  const raw = (sessionKey ?? "").trim();
  if (!raw) {
    return null;
  }
  const parts = raw.split(":").filter(Boolean);
  if (parts.length < 3) {
    return null;
  }
  if (parts[0] !== "agent") {
    return null;
  }
  const agentId = parts[1]?.trim();
  const rest = parts.slice(2).join(":");
  if (!agentId || !rest) {
    return null;
  }
  return { agentId, rest };
}

export type SessionKeyInfoKind = "main" | "channel" | "subagent" | "cron" | "hook" | "node" | "acp" | "unknown";

export type SessionKeyInfo = {
  raw: string;
  agentId?: string;
  rest?: string;
  kind: SessionKeyInfoKind;
  provider?: string;
  accountId?: string;
  peerKind?: "dm" | "group" | "channel";
  peerId?: string;
  threadKind?: "thread" | "topic";
  threadId?: string;
  mainKey?: string;
  meta?: {
    chatType?: string;
    originProvider?: string;
    originLabel?: string;
    space?: string;
    groupChannel?: string;
    subject?: string;
    lastChannel?: string;
  };
};

type SessionEntryLike = {
  chatType?: string;
  channel?: string;
  subject?: string;
  groupChannel?: string;
  space?: string;
  origin?: {
    label?: string;
    provider?: string;
  };
  lastChannel?: string;
};

const THREAD_MARKERS: Array<{ marker: string; kind: "thread" | "topic" }> = [
  { marker: ":thread:", kind: "thread" },
  { marker: ":topic:", kind: "topic" },
];

function splitThreadSuffix(rest: string): { base: string; threadKind?: "thread" | "topic"; threadId?: string } {
  const normalized = rest.toLowerCase();
  let idx = -1;
  let hit: (typeof THREAD_MARKERS)[number] | null = null;
  for (const marker of THREAD_MARKERS) {
    const candidate = normalized.lastIndexOf(marker.marker);
    if (candidate > idx) {
      idx = candidate;
      hit = marker;
    }
  }
  if (!hit || idx <= 0) {
    return { base: rest };
  }
  const base = rest.slice(0, idx).trim();
  const threadId = rest.slice(idx + hit.marker.length).trim();
  return { base, threadKind: hit.kind, threadId: threadId || undefined };
}

function lowerTrim(value: string | undefined | null): string {
  return (value ?? "").trim().toLowerCase();
}

function parseRest(base: string): Omit<SessionKeyInfo, "raw" | "agentId" | "rest" | "meta"> {
  const lowered = base.toLowerCase();
  if (!lowered) {
    return { kind: "unknown" };
  }

  const prefix = lowered.split(":", 1)[0] ?? "";
  if (prefix === "subagent") {
    return { kind: "subagent" };
  }
  if (prefix === "cron") {
    return { kind: "cron" };
  }
  if (prefix === "hook") {
    return { kind: "hook" };
  }
  if (prefix === "node") {
    return { kind: "node" };
  }
  if (prefix === "acp") {
    return { kind: "acp" };
  }

  const parts = base.split(":").filter(Boolean);
  if (parts.length >= 3) {
    const provider = lowerTrim(parts[0]);
    const kind = lowerTrim(parts[1]);
    if (kind === "group" || kind === "channel") {
      const peerId = parts.slice(2).join(":").trim();
      return {
        kind: "channel",
        provider: provider || undefined,
        peerKind: kind as "group" | "channel",
        peerId: peerId || undefined,
      };
    }
  }

  if (parts.length >= 2) {
    const head = lowerTrim(parts[0]);
    if (head === "dm") {
      const peerId = parts.slice(1).join(":").trim();
      return { kind: "channel", peerKind: "dm", peerId: peerId || undefined };
    }
  }

  if (parts.length >= 3) {
    const provider = lowerTrim(parts[0]);
    const maybeDm = lowerTrim(parts[1]);
    if (maybeDm === "dm") {
      const peerId = parts.slice(2).join(":").trim();
      return {
        kind: "channel",
        provider: provider || undefined,
        peerKind: "dm",
        peerId: peerId || undefined,
      };
    }
  }

  if (parts.length >= 4) {
    const provider = lowerTrim(parts[0]);
    const accountId = (parts[1] ?? "").trim();
    const maybeDm = lowerTrim(parts[2]);
    if (maybeDm === "dm") {
      const peerId = parts.slice(3).join(":").trim();
      return {
        kind: "channel",
        provider: provider || undefined,
        accountId: accountId || undefined,
        peerKind: "dm",
        peerId: peerId || undefined,
      };
    }
  }

  return { kind: "main", mainKey: base.trim() || undefined };
}

export function buildSessionKeyInfo(params: { key: string; entry?: SessionEntryLike | null }): SessionKeyInfo {
  const raw = (params.key ?? "").trim();
  const parsed = parseAgentSessionKey(raw);
  const rest = parsed?.rest ?? raw;
  const { base, threadKind, threadId } = splitThreadSuffix(rest);

  const baseInfo = parseRest(base);

  const entry = params.entry ?? undefined;
  const providerFromEntry =
    lowerTrim(entry?.channel) ||
    lowerTrim(entry?.origin?.provider) ||
    lowerTrim(entry?.lastChannel) ||
    undefined;

  const provider = baseInfo.provider ?? providerFromEntry ?? (baseInfo.kind === "main" ? "main" : undefined);

  const meta: SessionKeyInfo["meta"] = {};
  const chatType = entry?.chatType;
  if (chatType) {
    meta.chatType = String(chatType);
  }
  const originProvider = lowerTrim(entry?.origin?.provider);
  if (originProvider) {
    meta.originProvider = originProvider;
  }
  const originLabel = (entry?.origin?.label ?? "").trim();
  if (originLabel) {
    meta.originLabel = originLabel;
  }
  const space = (entry?.space ?? "").trim();
  if (space) {
    meta.space = space;
  }
  const groupChannel = (entry?.groupChannel ?? "").trim();
  if (groupChannel) {
    meta.groupChannel = groupChannel;
  }
  const subject = (entry?.subject ?? "").trim();
  if (subject) {
    meta.subject = subject;
  }
  const lastChannel = lowerTrim(entry?.lastChannel);
  if (lastChannel) {
    meta.lastChannel = lastChannel;
  }

  return {
    raw,
    agentId: parsed?.agentId,
    rest: parsed?.rest,
    ...baseInfo,
    provider,
    threadKind,
    threadId,
    meta: Object.keys(meta).length > 0 ? meta : undefined,
  };
}

export function resolveAgentIdFromSessionKey(sessionKey: string | undefined | null): string | undefined {
  return parseAgentSessionKey(sessionKey)?.agentId ?? undefined;
}

