const state = {
  sessions: [],
  activeSessionKey: null,
  events: [],
  eventIndex: new Map(),
  tasksBySession: new Map(),
  tasksById: new Map(),
  tasksLoaded: false,
  expandedSessions: new Set(),
  selectedTaskIds: new Set(),
  activeTaskId: null,
  focusedTaskId: null,
  mainView: "task",
  analysesByTask: new Map(),
  analysesLoaded: false,
  filters: new Set([
    "user_message",
    "assistant_message",
    "tool",
    "subagent_run",
    "subagent_result",
    "compaction",
    "agent_event",
    "model_change",
    "thinking_level_change",
    "session_info",
  ]),
  filteredEventIds: new Set(),
  selectedEventId: null,
  search: "",
  expandedEventIds: new Set(),
  evolutionReports: [],
  evolutionRunning: false,
  evolutionDimensions: new Set(["per_task_tool_quality", "cross_task_patterns"]),
  evolutionChangeTargets: new Set(["openclaw_config", "agent_persona", "hooks", "plugins", "skills"]),
  evolutionUseSearch: false,
  evolutionNotice: "",
  applyingChanges: new Set(),
  appliedChanges: new Set(),
};

const sessionsEl = document.getElementById("sessions");
const timelineEl = document.getElementById("timeline");
const sessionTitleEl = document.getElementById("session-title");
const sessionSubtitleEl = document.getElementById("session-subtitle");
const searchEl = document.getElementById("search");
const detailTitleEl = document.getElementById("detail-title");
const detailSubtitleEl = document.getElementById("detail-subtitle");
const detailBodyEl = document.getElementById("detail-body");
const evolutionContentEl = document.getElementById("evolution-content");
const evolutionControlsEl = document.getElementById("evolution-controls");
const evolutionSubtitleEl = document.getElementById("evolution-subtitle");
const viewTabs = Array.from(document.querySelectorAll(".view-option"));
const viewSwitchEl = document.querySelector(".view-switch");
const viewIndicatorLabelEl = document.querySelector(".view-indicator-label");
const taskViewEl = document.getElementById("task-view");
const evolutionViewEl = document.getElementById("evolution-view");
const mainEl = document.querySelector(".main");

const SELECTED_TASKS_KEY = "emc_selected_tasks";
const EVOLUTION_DIMENSIONS_KEY = "emc_evolution_dimensions";
const EVOLUTION_CHANGE_TARGETS_KEY = "emc_evolution_change_targets";
const EVOLUTION_APPLIED_CHANGES_KEY = "emc_evolution_applied_changes";
const EVOLUTION_USE_SEARCH_KEY = "emc_evolution_use_search";

function formatTime(ts) {
  const date = new Date(ts);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function formatTaskTime(ts) {
  const date = new Date(ts);
  return date.toLocaleString();
}

function createEmptyState(message) {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent = message;
  return empty;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeUrl(url) {
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }
  return null;
}

function renderInlineMarkdown(text) {
  const safe = escapeHtml(text);
  const withCode = safe.replace(/`([^`]+)`/g, "<code>$1</code>");
  const withBold = withCode.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  const withItalic = withBold.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  const withLinks = withItalic.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) => {
    const safeUrl = sanitizeUrl(url);
    if (!safeUrl) {
      return label;
    }
    return `<a href=\"${safeUrl}\" target=\"_blank\" rel=\"noopener noreferrer\">${label}</a>`;
  });
  return withLinks;
}

function renderBlockMarkdown(text) {
  const lines = text.split(/\r?\n/);
  const html = [];
  let inUl = false;
  let inOl = false;

  const closeLists = () => {
    if (inUl) {
      html.push("</ul>");
      inUl = false;
    }
    if (inOl) {
      html.push("</ol>");
      inOl = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      closeLists();
      continue;
    }
    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      closeLists();
      const level = headingMatch[1].length;
      const tag = level === 1 ? "h4" : level === 2 ? "h5" : "h6";
      html.push(`<${tag}>${renderInlineMarkdown(headingMatch[2])}</${tag}>`);
      continue;
    }
    const ulMatch = line.match(/^[-*]\s+(.*)$/);
    if (ulMatch) {
      if (!inUl) {
        closeLists();
        html.push("<ul>");
        inUl = true;
      }
      html.push(`<li>${renderInlineMarkdown(ulMatch[1])}</li>`);
      continue;
    }
    const olMatch = line.match(/^\d+\.\s+(.*)$/);
    if (olMatch) {
      if (!inOl) {
        closeLists();
        html.push("<ol>");
        inOl = true;
      }
      html.push(`<li>${renderInlineMarkdown(olMatch[1])}</li>`);
      continue;
    }
    closeLists();
    html.push(`<p>${renderInlineMarkdown(line)}</p>`);
  }

  closeLists();
  return html.join("");
}

function setMarkdown(el, text, mode = "inline") {
  if (!el) {
    return;
  }
  const content = text ?? "";
  el.innerHTML = mode === "block" ? renderBlockMarkdown(content) : renderInlineMarkdown(content);
  el.classList.toggle("md-block", mode === "block");
  el.classList.toggle("md-inline", mode === "inline");
}

function guessMarkdownMode(text) {
  if (!text) {
    return "inline";
  }
  if (/\r?\n/.test(text)) {
    return "block";
  }
  if (/^\s*(#{1,3}\s+|[-*]\s+|\d+\.\s+)/m.test(text)) {
    return "block";
  }
  return "inline";
}

function truncateText(text, max = 80) {
  const trimmed = text.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max)}…`;
}

const DIMENSION_LABELS = {
  per_task_tool_quality: "Per-task tool review",
  cross_task_patterns: "Cross-task patterns",
};

const CHANGE_TARGET_LABELS = {
  openclaw_config: "openclaw.json",
  agent_persona: "Agent persona",
  hooks: "Hooks",
  plugins: "Plugins",
  skills: "Skills",
};

function formatDimensionLabel(value) {
  return DIMENSION_LABELS[value] || value;
}

function formatChangeTargetLabel(value) {
  return CHANGE_TARGET_LABELS[value] || value;
}

function stripLeadingTimestamp(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  const bracketed = trimmed.match(/^\s*\[[^\]]+\]\s*(.*)$/s);
  if (bracketed?.[1]) {
    return bracketed[1].trim();
  }
  return trimmed
    .replace(
      /^\s*\[?\(?\d{4}(?:-|\/)\d{1,2}(?:-|\/)\d{1,2}(?:(?:\s|T)\d{1,2}:\d{2}(?::\d{2})?)?(?:\s*[A-Z+:-]{2,6})?\)?\]?\s*(?:-|:|\|)\s*/i,
      "",
    )
    .trim();
}

function extractMessageId(text) {
  if (!text) {
    return "";
  }
  const matches = text.match(/\[message_id:\s*([^\]]+)\]/gi);
  if (!matches || matches.length === 0) {
    return "";
  }
  const last = matches[matches.length - 1] || "";
  const id = last.replace(/\[message_id:\s*([^\]]+)\]/i, "$1").trim();
  return id;
}

function stripMessageId(text) {
  return text.replace(/\s*\[message_id:\s*[^\]]+\]\s*$/i, "").trim();
}

function taskDisplayTitle(task, max = 80) {
  const base = task.userMessage || task.taskId || "";
  const noTime = stripLeadingTimestamp(base);
  const noId = stripMessageId(noTime);
  return truncateText(noId, max);
}

function getTaskRange(task) {
  const start = typeof task.startTs === "number" ? task.startTs : null;
  let end = typeof task.endTs === "number" ? task.endTs : null;
  if (end == null && Array.isArray(task.toolCalls)) {
    for (const call of task.toolCalls) {
      const candidate = typeof call.endTs === "number" ? call.endTs : call.startTs;
      if (typeof candidate === "number") {
        end = end == null ? candidate : Math.max(end, candidate);
      }
    }
  }
  if (task.assistantReply && typeof task.assistantReply.ts === "number") {
    end = end == null ? task.assistantReply.ts : Math.max(end, task.assistantReply.ts);
  }
  if (start == null) {
    return null;
  }
  return { start, end: end ?? start };
}

function getSelectedTasks() {
  const selected = [];
  state.selectedTaskIds.forEach((taskId) => {
    const task = state.tasksById.get(taskId);
    if (task) {
      selected.push(task);
    }
  });
  return selected.sort((a, b) => a.startTs - b.startTs);
}

function getSelectedTaskIdsArray() {
  return getSelectedTasks()
    .map((task) => task.taskId)
    .filter((taskId) => typeof taskId === "string" && taskId.length > 0);
}

function reportMatchesTaskSelection(report, taskIds) {
  if (!Array.isArray(report?.taskIds)) {
    return false;
  }
  if (report.taskIds.length !== taskIds.length) {
    return false;
  }
  const requested = new Set(taskIds);
  return report.taskIds.every((id) => requested.has(id));
}

function listReportsForSelection() {
  const taskIds = getSelectedTaskIdsArray();
  if (!taskIds.length) {
    return [];
  }
  return state.evolutionReports.filter((report) => reportMatchesTaskSelection(report, taskIds));
}

function setActiveTask(taskId) {
  state.activeTaskId = taskId;
  renderDetailPanel();
}

function focusTask(task) {
  if (!task || !task.taskId) {
    return;
  }
  if (!state.selectedTaskIds.has(task.taskId)) {
    state.selectedTaskIds.add(task.taskId);
    persistSelectedTaskIds();
  }
  state.activeTaskId = task.taskId;
  state.focusedTaskId = task.taskId;
  updateActiveSessionCard();
  if (task.sessionKey && task.sessionKey !== state.activeSessionKey) {
    loadTimeline(task.sessionKey);
  } else {
    renderTimeline();
    renderDetailPanel();
  }
  renderEvolutionView();
}

function setMainView(view) {
  state.mainView = view;
  let activeLabel = "";
  viewTabs.forEach((btn) => {
    const isActive = btn.getAttribute("data-view") === view;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
    btn.setAttribute("tabindex", isActive ? "0" : "-1");
    if (isActive) {
      activeLabel = btn.dataset.label || btn.textContent?.trim() || "";
    }
  });
  if (viewSwitchEl) {
    viewSwitchEl.setAttribute("data-active", view);
  }
  if (viewIndicatorLabelEl && activeLabel) {
    viewIndicatorLabelEl.textContent = activeLabel;
  }
  if (taskViewEl) {
    taskViewEl.classList.toggle("active", view === "task");
  }
  if (evolutionViewEl) {
    evolutionViewEl.classList.toggle("active", view === "evolution");
  }
  if (mainEl) {
    mainEl.setAttribute("data-view", view);
  }
  if (view === "evolution") {
    renderEvolutionView();
  } else {
    renderTimeline();
    renderDetailPanel();
  }
}

function loadSelectedTaskIds() {
  try {
    const raw = localStorage.getItem(SELECTED_TASKS_KEY);
    if (!raw) {
      return new Set();
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((item) => typeof item === "string"));
    }
  } catch {
    // ignore
  }
  return new Set();
}

function persistSelectedTaskIds() {
  try {
    localStorage.setItem(SELECTED_TASKS_KEY, JSON.stringify([...state.selectedTaskIds]));
  } catch {
    // ignore
  }
}

function pruneSelectedTaskIds() {
  if (!state.selectedTaskIds.size) {
    return;
  }
  const next = new Set();
  let changed = false;
  state.selectedTaskIds.forEach((taskId) => {
    if (state.tasksById.has(taskId)) {
      next.add(taskId);
    } else {
      changed = true;
    }
  });
  if (changed) {
    state.selectedTaskIds = next;
    persistSelectedTaskIds();
  }
}

function loadBoolean(key, fallback = false) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) {
      return fallback;
    }
    if (raw === "true") {
      return true;
    }
    if (raw === "false") {
      return false;
    }
  } catch {
    // ignore
  }
  return fallback;
}

function persistBoolean(key, value) {
  try {
    localStorage.setItem(key, value ? "true" : "false");
  } catch {
    // ignore
  }
}

function loadStringSet(key, fallback = []) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return new Set(fallback);
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((item) => typeof item === "string"));
    }
  } catch {
    // ignore
  }
  return new Set(fallback);
}

function persistStringSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify([...value]));
  } catch {
    // ignore
  }
}

state.selectedTaskIds = loadSelectedTaskIds();
state.evolutionDimensions = loadStringSet(EVOLUTION_DIMENSIONS_KEY, [
  "per_task_tool_quality",
  "cross_task_patterns",
]);
state.evolutionChangeTargets = loadStringSet(EVOLUTION_CHANGE_TARGETS_KEY, [
  "openclaw_config",
  "agent_persona",
  "hooks",
  "plugins",
  "skills",
]);
state.evolutionUseSearch = loadBoolean(EVOLUTION_USE_SEARCH_KEY, false);
state.appliedChanges = loadStringSet(EVOLUTION_APPLIED_CHANGES_KEY, []);

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
  row.setAttribute("role", "button");
  row.setAttribute("tabindex", "0");

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
  const formatted = formatJsonValue(value);
  const rawText = typeof value === "string" ? value : formatted;
  valueSpan.textContent = formatted;
  valueSpan.dataset.raw = rawText;
  valueSpan.dataset.formatted = formatted;
  valueSpan.dataset.mode = "plain";
  const toggleMarkdown = () => {
    const mode = valueSpan.dataset.mode || "plain";
    if (mode === "markdown") {
      valueSpan.textContent = formatted;
      valueSpan.dataset.mode = "plain";
      valueSpan.classList.remove("is-markdown", "md-inline", "md-block");
      row.classList.remove("is-markdown");
      return;
    }
    const displayMode = guessMarkdownMode(rawText);
    setMarkdown(valueSpan, rawText, displayMode);
    valueSpan.dataset.mode = "markdown";
    valueSpan.classList.add("is-markdown");
    row.classList.add("is-markdown");
  };
  row.addEventListener("click", (event) => {
    const target = event.target;
    if (target && target.closest && target.closest("a")) {
      return;
    }
    toggleMarkdown();
  });
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleMarkdown();
    }
  });
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
  const indexMap = new Map();
  let fallbackIndex = 0;
  const visit = (items) =>
    (items || []).map((event) => {
      const key = event.__key || event.id || `${event.kind}-${event.ts}-${fallbackIndex++}`;
      const children = Array.isArray(event.children) ? visit(event.children) : undefined;
      const normalized = { ...event, __key: key, children };
      indexMap.set(key, normalized);
      return normalized;
    });
  return { events: visit(events), indexMap };
}

function getEventKey(event) {
  return event.__key || event.id;
}

function getSelectedEvent() {
  if (!state.selectedEventId) {
    return null;
  }
  return state.eventIndex.get(state.selectedEventId) || null;
}

function toEventDataId(eventId) {
  return encodeURIComponent(String(eventId));
}

function updateTimelineSelection(previousId, nextId) {
  if (!timelineEl) {
    return;
  }
  if (previousId) {
    const prevEl = timelineEl.querySelector(`[data-event-id="${toEventDataId(previousId)}"]`);
    if (prevEl) {
      prevEl.classList.remove("selected");
    }
  }
  if (nextId) {
    const nextEl = timelineEl.querySelector(`[data-event-id="${toEventDataId(nextId)}"]`);
    if (nextEl) {
      nextEl.classList.add("selected");
    }
  }
}

function selectEvent(eventId) {
  if (!eventId || state.selectedEventId === eventId) {
    return;
  }
  const previousId = state.selectedEventId;
  state.selectedEventId = eventId;
  if (state.mainView === "task") {
    updateTimelineSelection(previousId, eventId);
    renderDetailPanel();
  }
}

function renderSessions() {
  sessionsEl.innerHTML = "";

  if (!state.sessions.length) {
    sessionsEl.appendChild(createEmptyState("No sessions found"));
    return;
  }

  state.sessions.forEach((session, index) => {
    const tree = document.createElement("div");
    tree.className = "session-tree" + (state.expandedSessions.has(session.key) ? " expanded" : "");
    tree.setAttribute("data-session-key", session.key);

    const card = document.createElement("div");
    card.style.setProperty("--index", String(index));
    card.className = "session-card" + (session.key === state.activeSessionKey ? " active" : "");
    card.setAttribute("data-session-key", session.key);
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "session-toggle";
    toggle.setAttribute("aria-label", "Toggle tasks");
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleSessionExpanded(session.key);
    });
    const textWrap = document.createElement("div");
    textWrap.className = "session-text";
    const title = document.createElement("div");
    title.className = "session-title";
    title.textContent = session.displayName || session.label || session.key;
    const meta = document.createElement("div");
    meta.className = "session-meta";
    meta.textContent = `${session.kind} · ${session.agentId}`;
    textWrap.appendChild(title);
    textWrap.appendChild(meta);
    card.appendChild(toggle);
    card.appendChild(textWrap);
    card.addEventListener("click", () => {
      state.focusedTaskId = null;
      updateActiveSessionCard();
      loadTimeline(session.key);
    });

    const taskList = document.createElement("div");
    taskList.className = "task-list";
    const tasksForSession = state.tasksBySession.get(session.key) || [];

    if (!state.tasksLoaded) {
      const empty = document.createElement("div");
      empty.className = "task-empty";
      empty.textContent = "Loading tasks...";
      taskList.appendChild(empty);
    } else if (tasksForSession.length === 0) {
      const empty = document.createElement("div");
      empty.className = "task-empty";
      empty.textContent = "No tasks found. Run emc parse to generate tasks.";
      taskList.appendChild(empty);
    } else {
      tasksForSession.forEach((task) => {
        const item = document.createElement("div");
        item.className = "task-item" + (state.focusedTaskId === task.taskId ? " focused" : "");
        item.setAttribute("role", "button");
        item.setAttribute("tabindex", "0");
        item.addEventListener("click", () => {
          if (!checkbox.checked) {
            checkbox.checked = true;
          }
          focusTask(task);
        });
        item.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (!checkbox.checked) {
              checkbox.checked = true;
            }
            focusTask(task);
          }
        });

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = state.selectedTaskIds.has(task.taskId);
        checkbox.addEventListener("click", (event) => event.stopPropagation());
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) {
            state.selectedTaskIds.add(task.taskId);
          } else {
            state.selectedTaskIds.delete(task.taskId);
            if (state.activeTaskId === task.taskId) {
              state.activeTaskId = null;
            }
            if (state.focusedTaskId === task.taskId) {
              state.focusedTaskId = null;
              renderTimeline();
            }
          }
          persistSelectedTaskIds();
          updateActiveSessionCard();
          renderDetailPanel();
          renderEvolutionView();
        });

        const info = document.createElement("div");
        info.className = "task-info";
        const titleEl = document.createElement("div");
        titleEl.className = "task-title";
        titleEl.textContent = taskDisplayTitle(task);
        const timeEl = document.createElement("div");
        timeEl.className = "task-time";
        timeEl.textContent = formatTaskTime(task.startTs);
        const messageId = extractMessageId(task.userMessage || "");
        const idEl = document.createElement("div");
        idEl.className = "task-id";
        idEl.textContent = messageId;
        info.appendChild(titleEl);
        info.appendChild(timeEl);
        if (messageId) {
          info.appendChild(idEl);
        }
        item.appendChild(checkbox);
        item.appendChild(info);
        taskList.appendChild(item);
      });
    }

    tree.appendChild(card);
    tree.appendChild(taskList);
    sessionsEl.appendChild(tree);
  });
}

function updateActiveSessionCard() {
  document.querySelectorAll(".session-card").forEach((card) => {
    const key = card.getAttribute("data-session-key");
    const isActive = key === state.activeSessionKey && !state.focusedTaskId;
    card.classList.toggle("active", isActive);
  });
}

function setSessionExpanded(sessionKey, expanded) {
  if (expanded) {
    state.expandedSessions.add(sessionKey);
  } else {
    state.expandedSessions.delete(sessionKey);
  }
  const tree = sessionsEl.querySelector(`.session-tree[data-session-key="${sessionKey}"]`);
  if (tree) {
    tree.classList.toggle("expanded", expanded);
  }
}

function toggleSessionExpanded(sessionKey) {
  const expanded = state.expandedSessions.has(sessionKey);
  setSessionExpanded(sessionKey, !expanded);
}

function renderDetailPanel() {
  if (state.mainView !== "task") {
    return;
  }
  detailBodyEl.innerHTML = "";
  const event = getSelectedEvent();

  if (!event) {
    detailTitleEl.textContent = "Event Detail";
    detailSubtitleEl.textContent = "";
    detailBodyEl.appendChild(createEmptyState("Select an event in the timeline to view details."));
    return;
  }

  setMarkdown(detailTitleEl, event.summary || "(no summary)");
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
    metaItems.push({ label: "Duration", value: `${(event.durationMs / 1000).toFixed(2)}s` });
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

  const detailsSection = document.createElement("div");
  detailsSection.className = "detail-section";
  const detailsTitle = document.createElement("div");
  detailsTitle.className = "detail-section-title";
  detailsTitle.textContent = "Details JSON (click value to toggle markdown)";
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

function renderEvolutionView() {
  if (!evolutionContentEl || !evolutionControlsEl) {
    return;
  }

  evolutionControlsEl.innerHTML = "";
  evolutionContentEl.innerHTML = "";

  const selectedTasks = getSelectedTasks();
  const selectedCount = selectedTasks.length;

  if (evolutionSubtitleEl) {
    evolutionSubtitleEl.textContent = selectedCount
      ? `${selectedCount} task${selectedCount > 1 ? "s" : ""} selected`
      : "No tasks selected";
  }

  const controls = document.createElement("div");
  controls.className = "evolution-controls-grid";

  const dimensionSection = document.createElement("div");
  dimensionSection.className = "evolution-section";
  const dimTitle = document.createElement("div");
  dimTitle.className = "evolution-section-title";
  dimTitle.textContent = "Analysis dimensions";
  dimensionSection.appendChild(dimTitle);
  Object.keys(DIMENSION_LABELS).forEach((key) => {
    const label = document.createElement("label");
    label.className = "evolution-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.evolutionDimensions.has(key);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        state.evolutionDimensions.add(key);
      } else {
        state.evolutionDimensions.delete(key);
      }
      persistStringSet(EVOLUTION_DIMENSIONS_KEY, state.evolutionDimensions);
    });
    const span = document.createElement("span");
    span.textContent = formatDimensionLabel(key);
    label.appendChild(checkbox);
    label.appendChild(span);
    dimensionSection.appendChild(label);
  });
  controls.appendChild(dimensionSection);

  const targetSection = document.createElement("div");
  targetSection.className = "evolution-section";
  const targetTitle = document.createElement("div");
  targetTitle.className = "evolution-section-title";
  targetTitle.textContent = "Change targets";
  targetSection.appendChild(targetTitle);
  Object.keys(CHANGE_TARGET_LABELS).forEach((key) => {
    const label = document.createElement("label");
    label.className = "evolution-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.evolutionChangeTargets.has(key);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        state.evolutionChangeTargets.add(key);
      } else {
        state.evolutionChangeTargets.delete(key);
      }
      persistStringSet(EVOLUTION_CHANGE_TARGETS_KEY, state.evolutionChangeTargets);
    });
    const span = document.createElement("span");
    span.textContent = formatChangeTargetLabel(key);
    label.appendChild(checkbox);
    label.appendChild(span);
    targetSection.appendChild(label);
  });
  controls.appendChild(targetSection);

  const optionSection = document.createElement("div");
  optionSection.className = "evolution-section";
  const optionTitle = document.createElement("div");
  optionTitle.className = "evolution-section-title";
  optionTitle.textContent = "Options";
  optionSection.appendChild(optionTitle);
  const searchLabel = document.createElement("label");
  searchLabel.className = "evolution-option";
  const searchToggle = document.createElement("input");
  searchToggle.type = "checkbox";
  searchToggle.checked = state.evolutionUseSearch;
  searchToggle.addEventListener("change", () => {
    state.evolutionUseSearch = searchToggle.checked;
    persistBoolean(EVOLUTION_USE_SEARCH_KEY, state.evolutionUseSearch);
  });
  const searchSpan = document.createElement("span");
  searchSpan.textContent = "Search for solutions (web/X)";
  searchLabel.appendChild(searchToggle);
  searchLabel.appendChild(searchSpan);
  optionSection.appendChild(searchLabel);
  controls.appendChild(optionSection);

  const actionSection = document.createElement("div");
  actionSection.className = "evolution-section evolution-action";
  const runButton = document.createElement("button");
  runButton.type = "button";
  runButton.className = "evolution-run";
  runButton.textContent = state.evolutionRunning ? "Running..." : "Run evolution analysis";
  runButton.disabled = state.evolutionRunning;
  runButton.addEventListener("click", runEvolutionAnalysis);
  actionSection.appendChild(runButton);

  if (state.evolutionNotice) {
    const notice = document.createElement("div");
    notice.className = "evolution-notice";
    notice.textContent = state.evolutionNotice;
    actionSection.appendChild(notice);
  }
  controls.appendChild(actionSection);
  evolutionControlsEl.appendChild(controls);

  if (!selectedTasks.length) {
    evolutionContentEl.appendChild(createEmptyState("Select tasks to run evolution analysis."));
    return;
  }

  const selectedWrap = document.createElement("div");
  selectedWrap.className = "evolution-selected";
  selectedTasks.forEach((task) => {
    const pill = document.createElement("span");
    pill.className = "evolution-pill";
    pill.textContent = taskDisplayTitle(task, 60);
    selectedWrap.appendChild(pill);
  });
  evolutionContentEl.appendChild(selectedWrap);

  if (state.evolutionRunning) {
    evolutionContentEl.appendChild(createEmptyState("Running evolution analysis..."));
    return;
  }

  const reports = listReportsForSelection();
  if (!reports.length) {
    evolutionContentEl.appendChild(
      createEmptyState("No evolution report found for this selection. Run analysis to generate."),
    );
    return;
  }

  reports.forEach((report) => {
    const reportCard = document.createElement("div");
    reportCard.className = "evolution-report";

    const header = document.createElement("div");
    header.className = "evolution-report-header";
    const title = document.createElement("div");
    title.className = "evolution-report-title";
    title.textContent = report.summary || "Evolution report";
    const meta = document.createElement("div");
    meta.className = "evolution-report-meta";
    const dims = (report.dimensions || []).map(formatDimensionLabel).join(" · ");
    const targets = (report.changeTargets || []).map(formatChangeTargetLabel).join(" · ");
    meta.textContent = `${formatTaskTime(report.createdAt)} · ${dims || "no dimensions"} · ${
      targets || "no targets"
    }`;
    header.appendChild(title);
    header.appendChild(meta);
    reportCard.appendChild(header);

    (report.items || []).forEach((item) => {
      const itemCard = document.createElement("div");
      itemCard.className = "evolution-item";

      const itemHeader = document.createElement("div");
      itemHeader.className = "evolution-item-header";
      const itemTitle = document.createElement("div");
      itemTitle.className = "evolution-item-title";
      itemTitle.textContent = item.title || "Untitled finding";
      const badge = document.createElement("span");
      badge.className = `evolution-badge severity-${item.severity || "low"}`;
      badge.textContent = `${item.scope || "task"} · ${item.severity || "low"}`;
      itemHeader.appendChild(itemTitle);
      itemHeader.appendChild(badge);
      itemCard.appendChild(itemHeader);

      if (item.reasoning) {
        const reasoning = document.createElement("div");
        reasoning.className = "evolution-text";
        setMarkdown(reasoning, item.reasoning, "block");
        itemCard.appendChild(reasoning);
      }
      if (item.evidence) {
        const evidence = document.createElement("div");
        evidence.className = "evolution-evidence";
        setMarkdown(evidence, item.evidence, "block");
        itemCard.appendChild(evidence);
      }
      if (item.recommendation) {
        const recommendation = document.createElement("div");
        recommendation.className = "evolution-recommendation";
        setMarkdown(recommendation, item.recommendation, "block");
        itemCard.appendChild(recommendation);
      }

      if (Array.isArray(item.changes) && item.changes.length > 0) {
        const changeList = document.createElement("div");
        changeList.className = "evolution-change-list";
        item.changes.forEach((change) => {
          const changeCard = document.createElement("div");
          changeCard.className = "evolution-change";
          const changeTitle = document.createElement("div");
          changeTitle.className = "evolution-change-title";
          changeTitle.textContent = change.summary || "Proposed change";
          changeCard.appendChild(changeTitle);

          if (change.reason) {
            const changeReason = document.createElement("div");
            changeReason.className = "evolution-change-reason";
            setMarkdown(changeReason, change.reason, "block");
            changeCard.appendChild(changeReason);
          }

          const changeMeta = document.createElement("div");
          changeMeta.className = "evolution-change-meta";
          const target = change.target?.path || change.target?.kind || "unknown";
          const op = change.operation?.type || "operation";
          changeMeta.textContent = `${target} · ${op}`;
          changeCard.appendChild(changeMeta);

          const applyButton = document.createElement("button");
          applyButton.type = "button";
          applyButton.className = "evolution-apply";
          const applied = state.appliedChanges.has(change.changeId);
          applyButton.textContent = applied ? "Applied" : "Apply change";
          applyButton.disabled = applied || state.applyingChanges.has(change.changeId);
          applyButton.addEventListener("click", () =>
            applyEvolutionChange(report.reportId, change.changeId),
          );
          changeCard.appendChild(applyButton);
          changeList.appendChild(changeCard);
        });
        itemCard.appendChild(changeList);
      }

      reportCard.appendChild(itemCard);
    });

    evolutionContentEl.appendChild(reportCard);
  });
}

function eventMatchesSearch(event, search) {
  if (!search) {
    return true;
  }
  const target = `${event.summary ?? ""} ${JSON.stringify(event.details ?? {})}`.toLowerCase();
  return target.includes(search);
}

function filterEventTree(events, options) {
  const filtered = [];
  const ids = new Set();
  const search = options.search;
  const focusRange = options.focusRange;
  const filters = options.filters;

  for (const event of events) {
    const childResult = Array.isArray(event.children)
      ? filterEventTree(event.children, options)
      : { events: [], ids: new Set() };

    const matchesKind = filters.has(event.kind);
    const matchesSearch = eventMatchesSearch(event, search);
    const withinRange =
      !focusRange || (event.ts >= focusRange.start && event.ts <= focusRange.end);
    const matchesSelf = matchesKind && matchesSearch && withinRange;

    if (matchesSelf || childResult.events.length > 0) {
      const nextEvent = {
        ...event,
        children: childResult.events.length > 0 ? childResult.events : undefined,
      };
      filtered.push(nextEvent);
      ids.add(getEventKey(nextEvent));
      childResult.ids.forEach((id) => ids.add(id));
    }
  }

  return { events: filtered, ids };
}

function findFirstEventId(events) {
  for (const event of events) {
    const key = getEventKey(event);
    if (key) {
      return key;
    }
    if (Array.isArray(event.children)) {
      const child = findFirstEventId(event.children);
      if (child) {
        return child;
      }
    }
  }
  return null;
}

function renderEventNode(event, indexRef, depth = 0) {
  const eventId = getEventKey(event);
  const wrapper = document.createElement("div");
  wrapper.className = "event-node";
  wrapper.style.setProperty("--depth", String(depth));

  const hasChildren = Array.isArray(event.children) && event.children.length > 0;

  const card = document.createElement("div");
  card.className =
    `event ${event.kind}` +
    (eventId === state.selectedEventId ? " selected" : "") +
    (hasChildren ? " has-children" : "");
  card.style.setProperty("--index", String(indexRef.value));
  card.setAttribute("data-event-id", toEventDataId(eventId));
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", "0");

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
  setMarkdown(summary, event.summary || "(no summary)");

  card.appendChild(header);
  card.appendChild(summary);

  if (event.durationMs != null) {
    const duration = document.createElement("div");
    duration.className = "event-details";
    duration.textContent = `duration: ${(event.durationMs / 1000).toFixed(2)}s`;
    card.appendChild(duration);
  }

  card.addEventListener("click", () => selectEvent(eventId));
  card.addEventListener("keydown", (eventKey) => {
    if (eventKey.key === "Enter" || eventKey.key === " ") {
      eventKey.preventDefault();
      selectEvent(eventId);
    }
  });

  indexRef.value += 1;

  if (!hasChildren) {
    wrapper.appendChild(card);
    return wrapper;
  }

  const group = document.createElement("details");
  group.className = "event-group";
  if (state.expandedEventIds.has(eventId)) {
    group.open = true;
  }
  group.addEventListener("toggle", () => {
    if (group.open) {
      state.expandedEventIds.add(eventId);
    } else {
      state.expandedEventIds.delete(eventId);
    }
  });

  const summaryWrap = document.createElement("summary");
  summaryWrap.className = "event-group-summary";
  summaryWrap.appendChild(card);
  summaryWrap.addEventListener("click", () => selectEvent(eventId));
  summaryWrap.addEventListener("keydown", (eventKey) => {
    if (eventKey.key === "Enter" || eventKey.key === " ") {
      eventKey.preventDefault();
      selectEvent(eventId);
    }
  });

  const childrenWrap = document.createElement("div");
  childrenWrap.className = "event-children";
  event.children.forEach((child) => {
    childrenWrap.appendChild(renderEventNode(child, indexRef, depth + 1));
  });

  group.appendChild(summaryWrap);
  group.appendChild(childrenWrap);
  wrapper.appendChild(group);
  return wrapper;
}

function renderTimeline() {
  if (state.mainView !== "task") {
    return;
  }
  timelineEl.innerHTML = "";
  if (!state.activeSessionKey) {
    timelineEl.appendChild(createEmptyState("Select a session to load its timeline"));
    renderDetailPanel();
    return;
  }

  const search = state.search.trim().toLowerCase();
  const focusedTask =
    state.focusedTaskId && state.tasksById.get(state.focusedTaskId);
  const focusRange =
    focusedTask && focusedTask.sessionKey === state.activeSessionKey
      ? getTaskRange(focusedTask)
      : null;

  const filteredResult = filterEventTree(state.events, {
    filters: state.filters,
    search,
    focusRange,
  });

  state.filteredEventIds = filteredResult.ids;

  const firstVisibleId = findFirstEventId(filteredResult.events);
  if (firstVisibleId && !state.filteredEventIds.has(state.selectedEventId)) {
    state.selectedEventId = firstVisibleId;
  }

  if (!filteredResult.events.length) {
    timelineEl.appendChild(
      createEmptyState(
        focusRange
          ? "No events found in the focused task range."
          : "No events match the current filters",
      ),
    );
    renderDetailPanel();
    return;
  }

  const indexRef = { value: 0 };
  filteredResult.events.forEach((event) => {
    timelineEl.appendChild(renderEventNode(event, indexRef));
  });

  renderDetailPanel();
}

async function loadSessions() {
  const res = await fetch("/api/sessions");
  const data = await res.json();
  state.sessions = data.sessions || [];
  renderSessions();
  updateActiveSessionCard();
}

async function loadTasks() {
  try {
    const res = await fetch("/api/tasks");
    const data = await res.json();
    const tasks = Array.isArray(data.tasks) ? data.tasks : [];
    const bySession = new Map();
    const byId = new Map();
    tasks.forEach((task) => {
      if (!task || typeof task.sessionKey !== "string") {
        return;
      }
      if (typeof task.taskId === "string") {
        byId.set(task.taskId, task);
      }
      if (!bySession.has(task.sessionKey)) {
        bySession.set(task.sessionKey, []);
      }
      bySession.get(task.sessionKey).push(task);
    });
    bySession.forEach((list) => list.sort((a, b) => a.startTs - b.startTs));
    state.tasksBySession = bySession;
    state.tasksById = byId;
    pruneSelectedTaskIds();
    state.tasksLoaded = true;
    renderSessions();
    updateActiveSessionCard();
    renderDetailPanel();
    renderEvolutionView();
  } catch {
    state.tasksLoaded = true;
    renderSessions();
    renderEvolutionView();
  }
}

async function loadAnalyses() {
  try {
    const res = await fetch("/api/analyses");
    const data = await res.json();
    const analyses = Array.isArray(data.analyses) ? data.analyses : [];
    const byTask = new Map();
    analyses.forEach((record) => {
      if (record && typeof record.taskId === "string") {
        byTask.set(record.taskId, record);
      }
    });
    state.analysesByTask = byTask;
    state.analysesLoaded = true;
    renderEvolutionView();
  } catch {
    state.analysesLoaded = true;
    renderEvolutionView();
  }
}

async function loadEvolutionReports() {
  try {
    const res = await fetch("/api/evolution/reports");
    const data = await res.json();
    const reports = Array.isArray(data.reports) ? data.reports : [];
    state.evolutionReports = reports;
    renderEvolutionView();
  } catch {
    renderEvolutionView();
  }
}

async function runEvolutionAnalysis() {
  const taskIds = getSelectedTaskIdsArray();
  if (!taskIds.length) {
    state.evolutionNotice = "Select tasks before running evolution analysis.";
    renderEvolutionView();
    return;
  }
  const dimensions = [...state.evolutionDimensions];
  const changeTargets = [...state.evolutionChangeTargets];
  if (!dimensions.length || !changeTargets.length) {
    state.evolutionNotice = "Select at least one dimension and change target.";
    renderEvolutionView();
    return;
  }
  state.evolutionRunning = true;
  state.evolutionNotice = "";
  renderEvolutionView();
  try {
    const res = await fetch("/api/evolution/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskIds, dimensions, changeTargets, useSearch: state.evolutionUseSearch }),
    });
    const data = await res.json();
    if (!res.ok) {
      state.evolutionNotice = data?.error || "Evolution analysis failed.";
    } else if (data?.report) {
      state.evolutionReports = [data.report, ...state.evolutionReports];
      state.evolutionNotice = "Evolution analysis completed.";
    }
  } catch {
    state.evolutionNotice = "Evolution analysis failed.";
  } finally {
    state.evolutionRunning = false;
    renderEvolutionView();
  }
}

async function applyEvolutionChange(reportId, changeId) {
  if (!reportId || !changeId) {
    return;
  }
  if (state.applyingChanges.has(changeId)) {
    return;
  }
  state.applyingChanges.add(changeId);
  renderEvolutionView();
  try {
    const res = await fetch("/api/evolution/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportId, changeId }),
    });
    const data = await res.json();
    if (!res.ok) {
      state.evolutionNotice = data?.error || "Apply failed.";
    } else {
      state.appliedChanges.add(changeId);
      persistStringSet(EVOLUTION_APPLIED_CHANGES_KEY, state.appliedChanges);
      state.evolutionNotice = data?.requiresRestart
        ? "Change applied. Restart OpenClaw Gateway to take effect."
        : "Change applied.";
    }
  } catch {
    state.evolutionNotice = "Apply failed.";
  } finally {
    state.applyingChanges.delete(changeId);
    renderEvolutionView();
  }
}

async function loadTimeline(sessionKey) {
  state.activeSessionKey = sessionKey;
  updateActiveSessionCard();
  setSessionExpanded(sessionKey, true);
  sessionTitleEl.textContent = sessionKey;
  sessionSubtitleEl.textContent = "Loading timeline...";
  const res = await fetch(`/api/timeline?sessionKey=${encodeURIComponent(sessionKey)}`);
  const data = await res.json();
  const normalized = normalizeEvents(data.events || []);
  state.events = normalized.events;
  state.eventIndex = normalized.indexMap;
  state.selectedEventId = state.events.length ? getEventKey(state.events[0]) : null;
  state.expandedEventIds = new Set();
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

viewTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const key = tab.getAttribute("data-view");
    if (key === "task" || key === "evolution") {
      setMainView(key);
    }
  });
});

setMainView(state.mainView);

wireFilters();
loadSessions();
loadTasks();
loadAnalyses();
loadEvolutionReports();
renderTimeline();
