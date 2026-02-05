const state = {
  sessions: [],
  activeSessionKey: null,
  events: [],
  filters: new Set([
    "user_message",
    "tool",
    "subagent_run",
    "compaction",
    "agent_event",
    "model_change",
    "thinking_level_change",
    "session_info",
  ]),
  filteredEventIds: new Set(),
  selectedEventId: null,
  search: "",
};

const sessionsEl = document.getElementById("sessions");
const timelineEl = document.getElementById("timeline");
const sessionTitleEl = document.getElementById("session-title");
const sessionSubtitleEl = document.getElementById("session-subtitle");
const sessionCountEl = document.getElementById("session-count");
const sessionChipsEl = document.getElementById("session-chips");
const searchEl = document.getElementById("search");
const detailTitleEl = document.getElementById("detail-title");
const detailSubtitleEl = document.getElementById("detail-subtitle");
const detailBodyEl = document.getElementById("detail-body");

function formatTime(ts) {
  const date = new Date(ts);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function createEmptyState(message) {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent = message;
  return empty;
}

function formatJsonValue(value) {
  if (typeof value === "string") {
    return `"${value}"`;
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "undefined") {
    return "undefined";
  }
  if (Number.isNaN(value)) {
    return "NaN";
  }
  return String(value);
}

function getJsonType(value) {
  if (value === null) {
    return "null";
  }
  if (typeof value === "undefined") {
    return "undefined";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

function createJsonLeaf(key, value) {
  const row = document.createElement("div");
  row.className = "json-leaf";

  if (key !== null && typeof key !== "undefined") {
    const keySpan = document.createElement("span");
    keySpan.className = "json-key";
    keySpan.textContent = String(key);
    row.appendChild(keySpan);

    const colon = document.createElement("span");
    colon.className = "json-colon";
    colon.textContent = ":";
    row.appendChild(colon);
  }

  const type = getJsonType(value);
  const valueSpan = document.createElement("span");
  valueSpan.className = `json-value json-${type}`;
  valueSpan.textContent = formatJsonValue(value);
  row.appendChild(valueSpan);

  return row;
}

function createJsonNode(key, value, depth) {
  if (!value || typeof value !== "object") {
    return createJsonLeaf(key, value);
  }

  const isArray = Array.isArray(value);
  const entries = isArray ? value.map((item, index) => [String(index), item]) : Object.entries(value);
  const label = key ?? (isArray ? "Array" : "Object");

  const details = document.createElement("details");
  details.className = "json-node";
  details.open = true;

  const summary = document.createElement("summary");
  const labelSpan = document.createElement("span");
  labelSpan.className = "json-key";
  labelSpan.textContent = String(label);
  summary.appendChild(labelSpan);

  const meta = document.createElement("span");
  meta.className = "json-meta";
  meta.textContent = isArray ? `[${entries.length}]` : `{${entries.length}}`;
  summary.appendChild(meta);

  details.appendChild(summary);

  const children = document.createElement("div");
  children.className = "json-children";

  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "json-empty";
    empty.textContent = "(empty)";
    children.appendChild(empty);
  } else {
    entries.forEach(([childKey, childValue]) => {
      children.appendChild(createJsonNode(childKey, childValue, depth + 1));
    });
  }

  details.appendChild(children);
  return details;
}

function createJsonTree(value) {
  const wrapper = document.createElement("div");
  wrapper.className = "json-tree";
  wrapper.appendChild(createJsonNode("payload", value, 0));
  return wrapper;
}

function normalizeEvents(events) {
  return (events || []).map((event, index) => {
    if (event.__key) {
      return event;
    }
    return {
      ...event,
      __key: event.id || `${event.kind}-${event.ts}-${index}`,
    };
  });
}

function getEventKey(event) {
  return event.__key || event.id;
}

function getSelectedEvent() {
  if (!state.selectedEventId) {
    return null;
  }
  return state.events.find((event) => getEventKey(event) === state.selectedEventId) || null;
}

function selectEvent(eventId) {
  state.selectedEventId = eventId;
  renderTimeline();
}

function renderSessions() {
  sessionsEl.innerHTML = "";

  if (sessionCountEl) {
    sessionCountEl.textContent = String(state.sessions.length);
  }

  if (!state.sessions.length) {
    sessionsEl.appendChild(createEmptyState("No sessions found"));
    return;
  }

  state.sessions.forEach((session, index) => {
    const card = document.createElement("div");
    card.style.setProperty("--index", String(index));
    card.className = "session-card" + (session.key === state.activeSessionKey ? " active" : "");
    card.setAttribute("data-session-key", session.key);
    const title = document.createElement("div");
    title.className = "session-title";
    title.textContent = session.displayName || session.label || session.key;
    const meta = document.createElement("div");
    meta.className = "session-meta";
    meta.textContent = `${session.kind} · ${session.agentId}`;
    card.appendChild(title);
    card.appendChild(meta);
    card.addEventListener("click", () => loadTimeline(session.key));
    sessionsEl.appendChild(card);
  });
}

function updateActiveSessionCard() {
  document.querySelectorAll(".session-card").forEach((card) => {
    const key = card.getAttribute("data-session-key");
    card.classList.toggle("active", key === state.activeSessionKey);
  });
}

function renderDetailPanel() {
  detailBodyEl.innerHTML = "";
  const event = getSelectedEvent();

  if (!event) {
    detailTitleEl.textContent = "No event selected";
    detailSubtitleEl.textContent = "";
    detailBodyEl.appendChild(createEmptyState("Click an event to inspect full details"));
    return;
  }

  detailTitleEl.textContent = event.summary || "(no summary)";
  detailSubtitleEl.textContent = `${event.kind.replace(/_/g, " ")} · ${formatTime(event.ts)}`;

  if (!state.filteredEventIds.has(getEventKey(event))) {
    const note = document.createElement("div");
    note.className = "detail-note";
    note.textContent = "Selected event is hidden by current filters.";
    detailBodyEl.appendChild(note);
  }

  const meta = document.createElement("dl");
  meta.className = "detail-meta";

  const metaItems = [
    { label: "Kind", value: event.kind },
    { label: "When", value: formatTime(event.ts) },
    { label: "Event ID", value: event.id || "-" },
    { label: "Session", value: event.sessionKey || "-" },
  ];

  if (event.durationMs != null) {
    metaItems.push({
      label: "Duration",
      value: `${(event.durationMs / 1000).toFixed(2)}s`,
    });
  }

  metaItems.forEach((item) => {
    const wrapper = document.createElement("div");
    const dt = document.createElement("dt");
    dt.textContent = item.label;
    const dd = document.createElement("dd");
    dd.textContent = String(item.value);
    wrapper.appendChild(dt);
    wrapper.appendChild(dd);
    meta.appendChild(wrapper);
  });

  detailBodyEl.appendChild(meta);

  const summarySection = document.createElement("div");
  summarySection.className = "detail-section";
  const summaryTitle = document.createElement("div");
  summaryTitle.className = "detail-section-title";
  summaryTitle.textContent = "Summary";
  const summaryText = document.createElement("div");
  summaryText.textContent = event.summary || "(no summary)";
  summarySection.appendChild(summaryTitle);
  summarySection.appendChild(summaryText);
  detailBodyEl.appendChild(summarySection);

  const detailsSection = document.createElement("div");
  detailsSection.className = "detail-section";
  const detailsTitle = document.createElement("div");
  detailsTitle.className = "detail-section-title";
  detailsTitle.textContent = "Details JSON";
  detailsSection.appendChild(detailsTitle);
  if (typeof event.details === "undefined") {
    const empty = document.createElement("div");
    empty.className = "json-empty";
    empty.textContent = "(no details payload)";
    detailsSection.appendChild(empty);
  } else {
    detailsSection.appendChild(createJsonTree(event.details));
  }
  detailBodyEl.appendChild(detailsSection);
}

function renderTimeline() {
  timelineEl.innerHTML = "";
  if (!state.activeSessionKey) {
    timelineEl.appendChild(createEmptyState("Select a session to load its timeline"));
    renderDetailPanel();
    return;
  }

  const search = state.search.trim().toLowerCase();
  const filtered = state.events.filter((event) => {
    if (!state.filters.has(event.kind)) {
      return false;
    }
    if (!search) {
      return true;
    }
    const target = `${event.summary ?? ""} ${JSON.stringify(event.details ?? {})}`.toLowerCase();
    return target.includes(search);
  });

  state.filteredEventIds = new Set(filtered.map((event) => getEventKey(event)));

  if (!filtered.length) {
    timelineEl.appendChild(createEmptyState("No events match the current filters"));
    renderDetailPanel();
    return;
  }

  filtered.forEach((event, index) => {
    const eventId = getEventKey(event);
    const wrapper = document.createElement("div");
    wrapper.className = `event ${event.kind}` + (eventId === state.selectedEventId ? " selected" : "");
    wrapper.style.setProperty("--index", index);
    wrapper.setAttribute("role", "button");
    wrapper.setAttribute("tabindex", "0");
    const header = document.createElement("div");
    header.className = "event-header";
    const kind = document.createElement("div");
    kind.className = "event-kind";
    kind.textContent = event.kind.replace(/_/g, " ");
    const time = document.createElement("div");
    time.className = "event-time";
    time.textContent = formatTime(event.ts);
    header.appendChild(kind);
    header.appendChild(time);

    const summary = document.createElement("div");
    summary.className = "event-summary";
    summary.textContent = event.summary || "(no summary)";

    wrapper.appendChild(header);
    wrapper.appendChild(summary);

    if (event.durationMs != null) {
      const duration = document.createElement("div");
      duration.className = "event-details";
      duration.textContent = `duration: ${(event.durationMs / 1000).toFixed(2)}s`;
      wrapper.appendChild(duration);
    }

    wrapper.addEventListener("click", () => selectEvent(eventId));
    wrapper.addEventListener("keydown", (eventKey) => {
      if (eventKey.key === "Enter" || eventKey.key === " ") {
        eventKey.preventDefault();
        selectEvent(eventId);
      }
    });

    timelineEl.appendChild(wrapper);
  });

  renderDetailPanel();
}

function updateSessionChips(events) {
  if (!sessionChipsEl) {
    return;
  }
  sessionChipsEl.innerHTML = "";
  if (!events || !events.length) {
    return;
  }

  const chip = document.createElement("span");
  chip.className = "chip";
  chip.textContent = `${events.length} events`;
  sessionChipsEl.appendChild(chip);
}

async function loadSessions() {
  const res = await fetch("/api/sessions");
  const data = await res.json();
  state.sessions = data.sessions || [];
  renderSessions();
  updateActiveSessionCard();
}

async function loadTimeline(sessionKey) {
  state.activeSessionKey = sessionKey;
  updateActiveSessionCard();
  sessionTitleEl.textContent = sessionKey;
  sessionSubtitleEl.textContent = "Loading timeline...";
  const res = await fetch(`/api/timeline?sessionKey=${encodeURIComponent(sessionKey)}`);
  const data = await res.json();
  state.events = normalizeEvents(data.events || []);
  state.selectedEventId = state.events.length ? getEventKey(state.events[0]) : null;
  sessionTitleEl.textContent = data.session?.displayName || data.session?.label || sessionKey;
  sessionSubtitleEl.textContent = data.session
    ? `${data.session.kind} · ${data.session.agentId}`
    : "";
  updateSessionChips(state.events);
  renderTimeline();
}

function wireFilters() {
  document.querySelectorAll(".filters input[type=checkbox]").forEach((input) => {
    input.addEventListener("change", (event) => {
      const target = event.target;
      const kind = target.getAttribute("data-kind");
      if (!kind) {
        return;
      }
      if (target.checked) {
        state.filters.add(kind);
      } else {
        state.filters.delete(kind);
      }
      renderTimeline();
    });
  });
}

searchEl.addEventListener("input", (event) => {
  const target = event.target;
  state.search = target.value || "";
  renderTimeline();
});

wireFilters();
loadSessions();
renderTimeline();
