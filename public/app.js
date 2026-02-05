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
  search: "",
};

const sessionsEl = document.getElementById("sessions");
const timelineEl = document.getElementById("timeline");
const sessionTitleEl = document.getElementById("session-title");
const sessionSubtitleEl = document.getElementById("session-subtitle");
const searchEl = document.getElementById("search");

function formatTime(ts) {
  const date = new Date(ts);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function renderSessions() {
  sessionsEl.innerHTML = "";
  state.sessions.forEach((session) => {
    const card = document.createElement("div");
    card.className = "session-card" + (session.key === state.activeSessionKey ? " active" : "");
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

function renderTimeline() {
  timelineEl.innerHTML = "";
  if (!state.activeSessionKey) {
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

  filtered.forEach((event) => {
    const wrapper = document.createElement("div");
    wrapper.className = `event ${event.kind}`;
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

    if (event.details) {
      const details = document.createElement("details");
      details.className = "event-details";
      const summaryEl = document.createElement("summary");
      summaryEl.textContent = "Details";
      const pre = document.createElement("pre");
      pre.textContent = JSON.stringify(event.details, null, 2);
      details.appendChild(summaryEl);
      details.appendChild(pre);
      wrapper.appendChild(details);
    }

    timelineEl.appendChild(wrapper);
  });
}

async function loadSessions() {
  const res = await fetch("/api/sessions");
  const data = await res.json();
  state.sessions = data.sessions || [];
  renderSessions();
}

async function loadTimeline(sessionKey) {
  state.activeSessionKey = sessionKey;
  renderSessions();
  sessionTitleEl.textContent = sessionKey;
  sessionSubtitleEl.textContent = "Loading timeline…";
  const res = await fetch(`/api/timeline?sessionKey=${encodeURIComponent(sessionKey)}`);
  const data = await res.json();
  state.events = data.events || [];
  sessionTitleEl.textContent = data.session?.displayName || data.session?.label || sessionKey;
  sessionSubtitleEl.textContent = data.session
    ? `${data.session.kind} · ${data.session.agentId}`
    : "";
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
