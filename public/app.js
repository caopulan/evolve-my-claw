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
    "branch_summary",
    "agent_event",
    "model_change",
    "thinking_level_change",
    "session_info",
  ]),
  filteredEventIds: new Set(),
  selectedEventId: null,
  search: "",
  expandedEventIds: new Set(),
  sessionSearch: "",
  sidebarHidden: false,
  evolutionReports: [],
  evolutionRunning: false,
  evolutionDimensions: new Set(["per_task_tool_quality", "cross_task_patterns"]),
  evolutionChangeTargets: new Set(["openclaw_config", "agent_persona", "hooks", "plugins", "skills"]),
  evolutionUseSearch: false,
  evolutionNotice: "",
  evolutionHistoryScope: "all",
  evolutionHistoryQuery: "",
  evolutionActiveReportId: null,
  evolutionOpenItemIds: new Set(),
  applyingChanges: new Set(),
  appliedChanges: new Set(),
};

const appEl = document.querySelector(".app");
const sessionsEl = document.getElementById("sessions");
const sidebarHintEl = document.getElementById("sidebar-hint");
const sessionSearchEl = document.getElementById("session-search");
const timelineEl = document.getElementById("timeline");
const sessionTitleEl = document.getElementById("session-title");
const sessionSubtitleEl = document.getElementById("session-subtitle");
const searchEl = document.getElementById("search");
const timelineCountEl = document.getElementById("timeline-count");
const clearFocusEl = document.getElementById("clear-focus");
const taskStripEl = document.getElementById("task-strip");
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
const sidebarToggleEl = document.getElementById("sidebar-toggle");
const cmdkOpenEl = document.getElementById("cmdk-open");
const helpOpenEl = document.getElementById("help-open");
const cmdkDialogEl = document.getElementById("cmdk");
const cmdkInputEl = document.getElementById("cmdk-input");
const cmdkResultsEl = document.getElementById("cmdk-results");
const helpDialogEl = document.getElementById("help");
const toastEl = document.getElementById("toast");

const SELECTED_TASKS_KEY = "emc_selected_tasks";
const FILTERS_KEY = "emc_timeline_filters";
const SIDEBAR_HIDDEN_KEY = "emc_sidebar_hidden";
const EVOLUTION_DIMENSIONS_KEY = "emc_evolution_dimensions";
const EVOLUTION_CHANGE_TARGETS_KEY = "emc_evolution_change_targets";
const EVOLUTION_APPLIED_CHANGES_KEY = "emc_evolution_applied_changes";
const EVOLUTION_USE_SEARCH_KEY = "emc_evolution_use_search";
const EVOLUTION_HISTORY_SCOPE_KEY = "emc_evolution_history_scope";
const EVOLUTION_ACTIVE_REPORT_KEY = "emc_evolution_active_report";

const DEFAULT_FILTERS = [
  "user_message",
  "assistant_message",
  "tool",
  "subagent_run",
  "subagent_result",
  "compaction",
  "branch_summary",
  "agent_event",
  "model_change",
  "thinking_level_change",
  "session_info",
];

const cmdkState = {
  query: "",
  items: [],
  activeIndex: 0,
};

function formatTime(ts) {
  const date = new Date(ts);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function formatTaskTime(ts) {
  const date = new Date(ts);
  return date.toLocaleString();
}

function formatClockTime(ts) {
  const date = new Date(ts);
  try {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return date.toLocaleTimeString();
  }
}

function createEmptyState(message) {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent = message;
  return empty;
}

function isTypingTarget(target) {
  if (!target || !(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") {
    return true;
  }
  if (target.isContentEditable) {
    return true;
  }
  return false;
}

function isInteractiveElement(el) {
  if (!el || !(el instanceof HTMLElement)) {
    return false;
  }
  const tag = el.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    tag === "button" ||
    tag === "a" ||
    tag === "summary"
  );
}

function showToast(message) {
  if (!toastEl) {
    return;
  }
  const item = document.createElement("div");
  item.className = "toast-item";
  item.textContent = message;
  toastEl.appendChild(item);

  window.setTimeout(() => {
    item.style.animation = "toastOut 0.22s ease-in both";
    window.setTimeout(() => item.remove(), 240);
  }, 2400);
}

async function copyToClipboard(text) {
  const value = String(text ?? "");
  if (!value) {
    return false;
  }
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // Fallback for non-secure contexts.
    try {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.style.position = "fixed";
      textarea.style.left = "-1000px";
      textarea.style.top = "-1000px";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand("copy");
      textarea.remove();
      return ok;
    } catch {
      return false;
    }
  }
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

function findTaskForEvent(event) {
  if (!event || typeof event.ts !== "number") {
    return null;
  }
  if (!state.tasksLoaded) {
    return null;
  }
  const sessionKey = typeof event.sessionKey === "string" ? event.sessionKey : "";
  if (!sessionKey) {
    return null;
  }
  const tasks = state.tasksBySession.get(sessionKey) || [];
  for (const task of tasks) {
    const range = getTaskRange(task);
    if (!range) {
      continue;
    }
    if (event.ts >= range.start && event.ts <= range.end) {
      return task;
    }
  }
  return null;
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

function countEvolutionReportChanges(report) {
  const items = Array.isArray(report?.items) ? report.items : [];
  let total = 0;
  items.forEach((item) => {
    if (Array.isArray(item?.changes)) {
      total += item.changes.length;
    }
  });
  return total;
}

function evolutionReportSearchText(report) {
  const parts = [];
  parts.push(report?.summary ?? "");
  parts.push(report?.reportId ?? "");
  if (Array.isArray(report?.taskIds)) {
    parts.push(report.taskIds.join(" "));
  }
  if (Array.isArray(report?.dimensions)) {
    parts.push(report.dimensions.join(" "));
  }
  if (Array.isArray(report?.changeTargets)) {
    parts.push(report.changeTargets.join(" "));
  }
  if (Array.isArray(report?.items)) {
    parts.push(
      report.items
        .map((item) => `${item?.title ?? ""} ${item?.dimension ?? ""} ${item?.scope ?? ""}`)
        .join(" "),
    );
  }
  return parts.join(" ").toLowerCase();
}

function getEvolutionReportById(reportId) {
  if (!reportId) {
    return null;
  }
  return state.evolutionReports.find((report) => report?.reportId === reportId) ?? null;
}

function ensureEvolutionActiveReportId(reports) {
  const list = Array.isArray(reports) ? reports : [];
  const active = state.evolutionActiveReportId;
  if (active && list.some((report) => report?.reportId === active)) {
    return active;
  }
  const nextId = list[0]?.reportId ?? null;
  state.evolutionActiveReportId = nextId;
  persistString(EVOLUTION_ACTIVE_REPORT_KEY, nextId ?? "");
  return nextId;
}

function renderEvolutionViewPreserveFocus() {
  const active = document.activeElement;
  if (active && active instanceof HTMLInputElement) {
    const id = active.id;
    const start = active.selectionStart;
    const end = active.selectionEnd;
    renderEvolutionView();
    const next = document.getElementById(id);
    if (next && next instanceof HTMLInputElement) {
      next.focus();
      if (typeof start === "number" && typeof end === "number") {
        try {
          next.setSelectionRange(start, end);
        } catch {
          // ignore
        }
      }
    }
    return;
  }
  renderEvolutionView();
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
  renderSessions();
  if (task.sessionKey && task.sessionKey !== state.activeSessionKey) {
    loadTimeline(task.sessionKey);
  } else {
    renderTimeline();
    renderDetailPanel();
  }
  renderEvolutionView();
}

function clearFocusedTask() {
  if (!state.focusedTaskId) {
    return;
  }
  state.focusedTaskId = null;
  state.activeTaskId = null;
  renderSessions();
  updateActiveSessionCard();
  renderTimeline();
  renderDetailPanel();
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

function updateSidebarVisibility() {
  if (!appEl) {
    return;
  }
  appEl.classList.toggle("is-sidebar-hidden", state.sidebarHidden);
  if (sidebarToggleEl) {
    const label = sidebarToggleEl.querySelector(".toolbar-button-label");
    if (label) {
      label.textContent = state.sidebarHidden ? "Show sessions" : "Hide sessions";
    }
  }
}

function setSidebarHidden(hidden) {
  state.sidebarHidden = Boolean(hidden);
  persistBoolean(SIDEBAR_HIDDEN_KEY, state.sidebarHidden);
  updateSidebarVisibility();
}

function toggleSidebarHidden() {
  setSidebarHidden(!state.sidebarHidden);
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

function loadString(key, fallback = "") {
  try {
    const raw = localStorage.getItem(key);
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (trimmed) {
        return trimmed;
      }
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

function persistString(key, value) {
  try {
    localStorage.setItem(key, String(value ?? ""));
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
state.filters = loadStringSet(FILTERS_KEY, DEFAULT_FILTERS);
state.sidebarHidden = loadBoolean(SIDEBAR_HIDDEN_KEY, false);
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
state.evolutionHistoryScope = loadString(EVOLUTION_HISTORY_SCOPE_KEY, "all") === "selection"
  ? "selection"
  : "all";
state.evolutionActiveReportId = loadString(EVOLUTION_ACTIVE_REPORT_KEY, "") || null;
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

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
}

function scrollEventIntoView(eventId) {
  if (!timelineEl || !eventId) {
    return;
  }
  const el = timelineEl.querySelector(`[data-event-id="${toEventDataId(eventId)}"]`);
  if (!el) {
    return;
  }
  el.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
}

function selectEvent(eventId) {
  if (!eventId || state.selectedEventId === eventId) {
    return;
  }
  const previousId = state.selectedEventId;
  state.selectedEventId = eventId;
  if (state.mainView === "task") {
    updateTimelineSelection(previousId, eventId);
    scrollEventIntoView(eventId);
    renderDetailPanel();
  }
}

function renderSessions() {
  sessionsEl.innerHTML = "";

  const query = state.sessionSearch.trim().toLowerCase();
  const matchesSession = (session) => {
    if (!query) {
      return true;
    }
    const haystack = `${session.displayName ?? ""} ${session.label ?? ""} ${session.key ?? ""} ${
      session.kind ?? ""
    } ${session.agentId ?? ""}`.toLowerCase();
    return haystack.includes(query);
  };
  const matchesTask = (task) => {
    if (!query) {
      return true;
    }
    const title = taskDisplayTitle(task);
    const messageId = extractMessageId(task.userMessage || "");
    const haystack = `${title} ${messageId} ${task.taskId ?? ""} ${task.sessionKey ?? ""}`.toLowerCase();
    return haystack.includes(query);
  };

  const sessionsToRender = query
    ? state.sessions.filter((session) => {
        if (matchesSession(session)) {
          return true;
        }
        const tasksForSession = state.tasksBySession.get(session.key) || [];
        return tasksForSession.some(matchesTask);
      })
    : state.sessions;

  if (sidebarHintEl) {
    const selectedCount = state.selectedTaskIds.size;
    const hintParts = [
      `${sessionsToRender.length} session${sessionsToRender.length === 1 ? "" : "s"}`,
      `${selectedCount} task${selectedCount === 1 ? "" : "s"} selected`,
    ];
    if (query) {
      hintParts.push(`query: "${query}"`);
    }
    sidebarHintEl.textContent = hintParts.join(" · ");
  }

  if (!sessionsToRender.length) {
    sessionsEl.appendChild(createEmptyState(query ? "No sessions match this search." : "No sessions found"));
    return;
  }

  sessionsToRender.forEach((session, index) => {
    const tree = document.createElement("div");
    const forceExpanded = Boolean(query);
    const isExpanded = forceExpanded || state.expandedSessions.has(session.key);
    tree.className = "session-tree" + (isExpanded ? " expanded" : "");
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
    const tasksCount = state.tasksLoaded ? (state.tasksBySession.get(session.key) || []).length : null;
    meta.textContent = `${session.kind} · ${session.agentId}${
      tasksCount != null ? ` · ${tasksCount} task${tasksCount === 1 ? "" : "s"}` : ""
    }`;
    textWrap.appendChild(title);
    textWrap.appendChild(meta);
    card.appendChild(toggle);
    card.appendChild(textWrap);
    card.addEventListener("click", () => {
      state.focusedTaskId = null;
      state.activeTaskId = null;
      renderSessions();
      updateActiveSessionCard();
      loadTimeline(session.key);
    });

    const taskList = document.createElement("div");
    taskList.className = "task-list";
    const tasksForSession = state.tasksBySession.get(session.key) || [];
    const tasksToShow = query
      ? matchesSession(session)
        ? tasksForSession
        : tasksForSession.filter(matchesTask)
      : tasksForSession;

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
    } else if (tasksToShow.length === 0) {
      const empty = document.createElement("div");
      empty.className = "task-empty";
      empty.textContent = "No tasks match this search.";
      taskList.appendChild(empty);
    } else {
      const header = document.createElement("div");
      header.className = "task-list-header";
      const headerTitle = document.createElement("div");
      headerTitle.textContent = "Tasks";
      const headerCount = document.createElement("div");
      headerCount.className = "task-count";
      const selectedInSession = tasksForSession.filter((task) => state.selectedTaskIds.has(task.taskId)).length;
      headerCount.textContent = query
        ? `${tasksToShow.length}/${tasksForSession.length} shown · ${selectedInSession} selected`
        : `${selectedInSession} selected`;
      header.appendChild(headerTitle);
      header.appendChild(headerCount);
      taskList.appendChild(header);

      tasksToShow.forEach((task) => {
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
          renderSessions();
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

        const analysisRecord = state.analysesByTask.get(task.taskId);
        if (analysisRecord) {
          const status = analysisRecord.parseError
            ? "failed"
            : analysisRecord.analysis
              ? "success"
              : analysisRecord.rawResponse
                ? "partial"
                : "unknown";
          const badge = document.createElement("span");
          badge.className = `task-badge status-${status}`;
          badge.setAttribute("title", `Analysis: ${status}`);
          badge.setAttribute("aria-label", `Analysis: ${status}`);
          item.appendChild(badge);
        }

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

function renderTaskStrip() {
  if (!taskStripEl) {
    return;
  }
  taskStripEl.innerHTML = "";
  if (!state.activeSessionKey || !state.tasksLoaded) {
    taskStripEl.hidden = true;
    return;
  }
  const tasks = state.tasksBySession.get(state.activeSessionKey) || [];
  if (!tasks.length) {
    taskStripEl.hidden = true;
    return;
  }
  taskStripEl.hidden = false;

  tasks.forEach((task) => {
    const chip = document.createElement("button");
    chip.type = "button";
    const isFocused = state.focusedTaskId === task.taskId;
    const isSelected = state.selectedTaskIds.has(task.taskId);
    chip.className =
      "task-chip" + (isFocused ? " active" : "") + (isSelected ? " selected" : "");
    chip.addEventListener("click", () => focusTask(task));

    const title = document.createElement("div");
    title.className = "task-chip-title";
    title.textContent = taskDisplayTitle(task, 64) || task.taskId || "Task";

    const meta = document.createElement("div");
    meta.className = "task-chip-meta";
    const toolCount = Array.isArray(task.toolCalls) ? task.toolCalls.length : 0;
    meta.textContent = `${formatClockTime(task.startTs)} · ${toolCount} tool${toolCount === 1 ? "" : "s"}`;

    chip.appendChild(title);
    chip.appendChild(meta);
    taskStripEl.appendChild(chip);
  });
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

  const actions = document.createElement("div");
  actions.className = "detail-actions";

  const makeAction = (label, getText, successMessage) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "detail-action";
    button.textContent = label;
    button.addEventListener("click", async () => {
      const text = getText();
      const ok = await copyToClipboard(text);
      showToast(ok ? successMessage : "Copy failed.");
    });
    return button;
  };

  actions.appendChild(
    makeAction(
      "Copy text",
      () => {
        const details = event.details ?? {};
        if (details && typeof details.text === "string" && details.text.trim()) {
          return details.text;
        }
        return event.summary || "";
      },
      "Copied text.",
    ),
  );
  actions.appendChild(
    makeAction(
      "Copy details",
      () => JSON.stringify(event.details ?? {}, null, 2),
      "Copied details JSON.",
    ),
  );
  actions.appendChild(
    makeAction(
      "Copy event id",
      () => String(event.id || ""),
      "Copied event id.",
    ),
  );
  detailBodyEl.appendChild(actions);

  if (!state.filteredEventIds.has(getEventKey(event))) {
    const note = document.createElement("div");
    note.className = "detail-note";
    note.textContent = "Selected event is hidden by current filters.";
    detailBodyEl.appendChild(note);
  }

  const task = findTaskForEvent(event);
  if (task) {
    const taskSection = document.createElement("div");
    taskSection.className = "detail-section";
    const taskTitle = document.createElement("div");
    taskTitle.className = "detail-section-title";
    taskTitle.textContent = "Task context";
    taskSection.appendChild(taskTitle);

    const taskHeader = document.createElement("div");
    taskHeader.className = "detail-task-header";
    const taskName = document.createElement("div");
    taskName.className = "detail-task-title";
    taskName.textContent = taskDisplayTitle(task, 120) || task.taskId || "Task";
    const taskActions = document.createElement("div");
    taskActions.className = "detail-task-actions";

    const focusBtn = document.createElement("button");
    focusBtn.type = "button";
    focusBtn.className = "detail-mini";
    focusBtn.textContent = "Focus range";
    focusBtn.addEventListener("click", () => focusTask(task));
    taskActions.appendChild(focusBtn);

    const selectBtn = document.createElement("button");
    selectBtn.type = "button";
    selectBtn.className = "detail-mini";
    const updateSelectBtn = () => {
      const selected = state.selectedTaskIds.has(task.taskId);
      selectBtn.textContent = selected ? "Selected" : "Select for evolution";
      selectBtn.setAttribute("data-selected", selected ? "true" : "false");
    };
    updateSelectBtn();
    selectBtn.addEventListener("click", () => {
      const selected = state.selectedTaskIds.has(task.taskId);
      if (selected) {
        state.selectedTaskIds.delete(task.taskId);
      } else {
        state.selectedTaskIds.add(task.taskId);
      }
      persistSelectedTaskIds();
      renderSessions();
      renderEvolutionView();
      updateSelectBtn();
    });
    taskActions.appendChild(selectBtn);

    taskHeader.appendChild(taskName);
    taskHeader.appendChild(taskActions);
    taskSection.appendChild(taskHeader);

    const taskMeta = document.createElement("div");
    taskMeta.className = "detail-task-meta";
    const messageId = extractMessageId(task.userMessage || "");
    const toolCount = Array.isArray(task.toolCalls) ? task.toolCalls.length : 0;
    const range = getTaskRange(task);
    const duration =
      range && typeof range.end === "number"
        ? `${((range.end - range.start) / 1000).toFixed(2)}s`
        : "-";
    taskMeta.textContent = `${formatTaskTime(task.startTs)}${
      messageId ? ` · ${messageId}` : ""
    } · ${toolCount} tool${toolCount === 1 ? "" : "s"} · ${duration}`;
    taskSection.appendChild(taskMeta);

    const analysisRecord = state.analysesByTask.get(task.taskId);
    if (analysisRecord) {
      const status = analysisRecord.parseError
        ? "failed"
        : analysisRecord.analysis
          ? "success"
          : analysisRecord.rawResponse
            ? "partial"
            : "unknown";

      const analysisDetails = document.createElement("details");
      analysisDetails.className = "detail-disclosure";

      const analysisSummary = document.createElement("summary");
      analysisSummary.className = "detail-disclosure-summary";
      const analysisLabel = document.createElement("span");
      analysisLabel.textContent = "Task analysis";
      const analysisPill = document.createElement("span");
      analysisPill.className = `analysis-pill status-${status}`;
      analysisPill.textContent = status;
      analysisSummary.appendChild(analysisLabel);
      analysisSummary.appendChild(analysisPill);
      analysisDetails.appendChild(analysisSummary);

      const analysisBody = document.createElement("div");
      analysisBody.className = "detail-disclosure-body";

      if (analysisRecord.parseError) {
        const error = document.createElement("div");
        error.className = "analysis-error";
        error.textContent = analysisRecord.parseError;
        analysisBody.appendChild(error);
      }

      if (Array.isArray(analysisRecord.toolSummary) && analysisRecord.toolSummary.length > 0) {
        const list = document.createElement("div");
        list.className = "summary-list";
        analysisRecord.toolSummary.forEach((entry) => {
          const row = document.createElement("div");
          row.className = "summary-row";
          const label = document.createElement("div");
          label.className = "summary-label";
          label.textContent = entry.tool;
          const value = document.createElement("div");
          value.className = "summary-value";
          value.textContent = `${entry.count}${entry.errors ? ` (err:${entry.errors})` : ""}`;
          row.appendChild(label);
          row.appendChild(value);
          list.appendChild(row);
        });
        analysisBody.appendChild(list);
      }

      if (analysisRecord.analysis) {
        const payload = document.createElement("div");
        payload.className = "detail-section";
        const payloadTitle = document.createElement("div");
        payloadTitle.className = "detail-section-title";
        payloadTitle.textContent = "Analysis JSON";
        payload.appendChild(payloadTitle);
        payload.appendChild(createJsonTree(analysisRecord.analysis));
        analysisBody.appendChild(payload);
      }

      analysisDetails.appendChild(analysisBody);
      taskSection.appendChild(analysisDetails);
    }

    detailBodyEl.appendChild(taskSection);
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
  const selectedTaskIds = getSelectedTaskIdsArray();

  if (evolutionSubtitleEl) {
    const reportCount = state.evolutionReports.length;
    const selectionLabel = selectedCount
      ? `${selectedCount} task${selectedCount > 1 ? "s" : ""} selected`
      : "No tasks selected";
    const historyLabel = reportCount
      ? `${reportCount} report${reportCount === 1 ? "" : "s"} stored`
      : "No stored reports";
    evolutionSubtitleEl.textContent = `${selectionLabel} · ${historyLabel}`;
  }

  const makeChip = (label, pressed, onClick) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `evo-chip${pressed ? " is-on" : ""}`;
    btn.setAttribute("aria-pressed", pressed ? "true" : "false");
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    return btn;
  };

  const composerGrid = document.createElement("div");
  composerGrid.className = "evo-composer-grid";

  const selectionCard = document.createElement("section");
  selectionCard.className = "evo-card evo-card-selection";

  const selectionHeader = document.createElement("div");
  selectionHeader.className = "evo-card-header";
  const selectionTitle = document.createElement("div");
  selectionTitle.className = "evo-card-title";
  selectionTitle.textContent = "Selection";
  const selectionMeta = document.createElement("div");
  selectionMeta.className = "evo-card-meta";
  selectionMeta.textContent = selectedCount ? `${selectedCount} tasks` : "Pick tasks from the left sidebar";
  selectionHeader.appendChild(selectionTitle);
  selectionHeader.appendChild(selectionMeta);

  const selectionActions = document.createElement("div");
  selectionActions.className = "evo-card-actions";
  const clearSelectionBtn = document.createElement("button");
  clearSelectionBtn.type = "button";
  clearSelectionBtn.className = "evo-mini";
  clearSelectionBtn.textContent = "Clear";
  clearSelectionBtn.disabled = selectedCount === 0;
  clearSelectionBtn.addEventListener("click", () => {
    state.selectedTaskIds = new Set();
    state.activeTaskId = null;
    state.focusedTaskId = null;
    persistSelectedTaskIds();
    renderSessions();
    updateActiveSessionCard();
    renderTimeline();
    renderDetailPanel();
    renderEvolutionView();
  });
  selectionActions.appendChild(clearSelectionBtn);

  selectionCard.appendChild(selectionHeader);
  selectionCard.appendChild(selectionActions);

  const tokenList = document.createElement("div");
  tokenList.className = "evo-token-list";
  if (selectedTasks.length === 0) {
    const empty = document.createElement("div");
    empty.className = "evo-token-empty";
    empty.textContent = "No tasks selected.";
    tokenList.appendChild(empty);
  } else {
    selectedTasks.forEach((task) => {
      const token = document.createElement("div");
      token.className = "evo-token";

      const main = document.createElement("button");
      main.type = "button";
      main.className = "evo-token-main";
      main.textContent = taskDisplayTitle(task, 80) || task.taskId || "Task";
      main.addEventListener("click", () => {
        focusTask(task);
        setMainView("task");
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "evo-token-remove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", "Remove task from selection");
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        if (!task?.taskId) {
          return;
        }
        state.selectedTaskIds.delete(task.taskId);
        if (state.activeTaskId === task.taskId) {
          state.activeTaskId = null;
        }
        if (state.focusedTaskId === task.taskId) {
          state.focusedTaskId = null;
        }
        persistSelectedTaskIds();
        renderSessions();
        updateActiveSessionCard();
        renderTimeline();
        renderDetailPanel();
        renderEvolutionView();
      });

      token.appendChild(main);
      token.appendChild(remove);
      tokenList.appendChild(token);
    });
  }
  selectionCard.appendChild(tokenList);
  composerGrid.appendChild(selectionCard);

  const configCard = document.createElement("section");
  configCard.className = "evo-card evo-card-config";

  const configHeader = document.createElement("div");
  configHeader.className = "evo-card-header";
  const configTitle = document.createElement("div");
  configTitle.className = "evo-card-title";
  configTitle.textContent = "Scope";
  const configMeta = document.createElement("div");
  configMeta.className = "evo-card-meta";
  configMeta.textContent = "Tune the analyzer before you run.";
  configHeader.appendChild(configTitle);
  configHeader.appendChild(configMeta);
  configCard.appendChild(configHeader);

  const dimGroup = document.createElement("div");
  dimGroup.className = "evo-group";
  const dimLabel = document.createElement("div");
  dimLabel.className = "evo-group-title";
  dimLabel.textContent = "Dimensions";
  dimGroup.appendChild(dimLabel);
  const dimRow = document.createElement("div");
  dimRow.className = "evo-chip-row";
  Object.keys(DIMENSION_LABELS).forEach((key) => {
    dimRow.appendChild(
      makeChip(formatDimensionLabel(key), state.evolutionDimensions.has(key), () => {
        if (state.evolutionDimensions.has(key)) {
          state.evolutionDimensions.delete(key);
        } else {
          state.evolutionDimensions.add(key);
        }
        persistStringSet(EVOLUTION_DIMENSIONS_KEY, state.evolutionDimensions);
        renderEvolutionView();
      }),
    );
  });
  dimGroup.appendChild(dimRow);
  configCard.appendChild(dimGroup);

  const targetGroup = document.createElement("div");
  targetGroup.className = "evo-group";
  const targetLabel = document.createElement("div");
  targetLabel.className = "evo-group-title";
  targetLabel.textContent = "Change targets";
  targetGroup.appendChild(targetLabel);
  const targetRow = document.createElement("div");
  targetRow.className = "evo-chip-row";
  Object.keys(CHANGE_TARGET_LABELS).forEach((key) => {
    targetRow.appendChild(
      makeChip(formatChangeTargetLabel(key), state.evolutionChangeTargets.has(key), () => {
        if (state.evolutionChangeTargets.has(key)) {
          state.evolutionChangeTargets.delete(key);
        } else {
          state.evolutionChangeTargets.add(key);
        }
        persistStringSet(EVOLUTION_CHANGE_TARGETS_KEY, state.evolutionChangeTargets);
        renderEvolutionView();
      }),
    );
  });
  targetGroup.appendChild(targetRow);
  configCard.appendChild(targetGroup);

  const optionGroup = document.createElement("div");
  optionGroup.className = "evo-group";
  const optionLabel = document.createElement("div");
  optionLabel.className = "evo-group-title";
  optionLabel.textContent = "Options";
  optionGroup.appendChild(optionLabel);
  const optionRow = document.createElement("div");
  optionRow.className = "evo-chip-row";
  optionRow.appendChild(
    makeChip("Search for fixes (web/X)", state.evolutionUseSearch, () => {
      state.evolutionUseSearch = !state.evolutionUseSearch;
      persistBoolean(EVOLUTION_USE_SEARCH_KEY, state.evolutionUseSearch);
      renderEvolutionView();
    }),
  );
  optionGroup.appendChild(optionRow);
  configCard.appendChild(optionGroup);

  composerGrid.appendChild(configCard);

  const runCard = document.createElement("section");
  runCard.className = "evo-card evo-card-run";

  const runHeader = document.createElement("div");
  runHeader.className = "evo-card-header";
  const runTitle = document.createElement("div");
  runTitle.className = "evo-card-title";
  runTitle.textContent = "Run";
  const runMeta = document.createElement("div");
  runMeta.className = "evo-card-meta";
  runMeta.textContent = "Generate a report + suggested patches.";
  runHeader.appendChild(runTitle);
  runHeader.appendChild(runMeta);
  runCard.appendChild(runHeader);

  const dimCount = state.evolutionDimensions.size;
  const targetCount = state.evolutionChangeTargets.size;
  const canRun =
    selectedTaskIds.length > 0 && dimCount > 0 && targetCount > 0 && !state.evolutionRunning;

  const runButton = document.createElement("button");
  runButton.type = "button";
  runButton.className = "evo-run";
  runButton.textContent = state.evolutionRunning ? "Analyzing…" : "Run evolution analysis";
  runButton.disabled = !canRun;
  runButton.addEventListener("click", runEvolutionAnalysis);
  runCard.appendChild(runButton);

  const runHint = document.createElement("div");
  runHint.className = "evo-hint";
  if (!selectedTaskIds.length) {
    runHint.textContent = "Select 1+ tasks to enable running.";
  } else if (!dimCount || !targetCount) {
    runHint.textContent = "Pick at least one dimension and one target.";
  } else {
    runHint.textContent = "Reports are stored locally and remain browsable as history.";
  }
  runCard.appendChild(runHint);

  if (state.evolutionNotice) {
    const notice = document.createElement("div");
    notice.className = "evo-notice";
    notice.textContent = state.evolutionNotice;
    runCard.appendChild(notice);
  }

  composerGrid.appendChild(runCard);
  evolutionControlsEl.appendChild(composerGrid);

  const grid = document.createElement("div");
  grid.className = "evo-grid";

  const historyPane = document.createElement("section");
  historyPane.className = "evo-pane evo-history";

  const historyHeader = document.createElement("div");
  historyHeader.className = "evo-pane-header";
  const historyTitle = document.createElement("div");
  historyTitle.className = "evo-pane-title";
  historyTitle.textContent = "History";

  const scopeControls = document.createElement("div");
  scopeControls.className = "evo-scope";
  const allScope = document.createElement("button");
  allScope.type = "button";
  allScope.className = `evo-scope-btn${state.evolutionHistoryScope === "all" ? " active" : ""}`;
  allScope.textContent = "All";
  allScope.addEventListener("click", () => {
    state.evolutionHistoryScope = "all";
    persistString(EVOLUTION_HISTORY_SCOPE_KEY, state.evolutionHistoryScope);
    renderEvolutionView();
  });
  const selScope = document.createElement("button");
  selScope.type = "button";
  selScope.className = `evo-scope-btn${
    state.evolutionHistoryScope === "selection" ? " active" : ""
  }`;
  selScope.textContent = "Selection";
  selScope.disabled = selectedTaskIds.length === 0;
  selScope.title = selectedTaskIds.length === 0 ? "Select tasks first" : "";
  selScope.addEventListener("click", () => {
    state.evolutionHistoryScope = "selection";
    persistString(EVOLUTION_HISTORY_SCOPE_KEY, state.evolutionHistoryScope);
    renderEvolutionView();
  });
  scopeControls.appendChild(allScope);
  scopeControls.appendChild(selScope);

  historyHeader.appendChild(historyTitle);
  historyHeader.appendChild(scopeControls);
  historyPane.appendChild(historyHeader);

  const historyTools = document.createElement("div");
  historyTools.className = "evo-pane-tools";
  const searchWrap = document.createElement("label");
  searchWrap.className = "evo-search";
  const searchInput = document.createElement("input");
  searchInput.id = "evo-history-search";
  searchInput.type = "search";
  searchInput.placeholder = "Search reports, tasks, findings…";
  searchInput.value = state.evolutionHistoryQuery;
  searchInput.addEventListener("input", () => {
    state.evolutionHistoryQuery = searchInput.value;
    renderEvolutionViewPreserveFocus();
  });
  searchWrap.appendChild(searchInput);
  historyTools.appendChild(searchWrap);
  historyPane.appendChild(historyTools);

  const query = state.evolutionHistoryQuery.trim().toLowerCase();
  const selectionFilter =
    state.evolutionHistoryScope === "selection" && selectedTaskIds.length > 0;

  const filteredReports = state.evolutionReports.filter((report) => {
    if (selectionFilter && !reportMatchesTaskSelection(report, selectedTaskIds)) {
      return false;
    }
    if (query && !evolutionReportSearchText(report).includes(query)) {
      return false;
    }
    return true;
  });

  if (filteredReports.length > 0) {
    const activeId = state.evolutionActiveReportId;
    if (!activeId || !filteredReports.some((report) => report?.reportId === activeId)) {
      state.evolutionActiveReportId = filteredReports[0].reportId ?? null;
      persistString(EVOLUTION_ACTIVE_REPORT_KEY, state.evolutionActiveReportId ?? "");
      state.evolutionOpenItemIds = new Set();
    }
  } else if (
    !state.evolutionActiveReportId ||
    !state.evolutionReports.some((report) => report?.reportId === state.evolutionActiveReportId)
  ) {
    ensureEvolutionActiveReportId(state.evolutionReports);
  }

  const list = document.createElement("div");
  list.className = "evo-report-list";
  if (state.evolutionReports.length === 0) {
    list.appendChild(createEmptyState("No evolution reports yet. Run analysis to create the first one."));
  } else if (filteredReports.length === 0) {
    const empty = document.createElement("div");
    empty.className = "evo-empty";
    empty.textContent = "No reports match the current filter.";
    list.appendChild(empty);
  } else {
    filteredReports.forEach((report, idx) => {
      const row = document.createElement("button");
      row.type = "button";
      const isActive = report.reportId === state.evolutionActiveReportId;
      row.className = `evo-report-row${isActive ? " active" : ""}`;
      row.style.setProperty("--index", String(idx));
      row.addEventListener("click", () => {
        if (state.evolutionActiveReportId === report.reportId) {
          return;
        }
        state.evolutionActiveReportId = report.reportId;
        persistString(EVOLUTION_ACTIVE_REPORT_KEY, state.evolutionActiveReportId ?? "");
        state.evolutionOpenItemIds = new Set();
        renderEvolutionView();
      });

      const top = document.createElement("div");
      top.className = "evo-report-top";
      const title = document.createElement("div");
      title.className = "evo-report-title";
      title.textContent = truncateText(report.summary || "Evolution report", 80);
      const time = document.createElement("div");
      time.className = "evo-report-time";
      time.textContent = formatTaskTime(report.createdAt);
      top.appendChild(title);
      top.appendChild(time);
      row.appendChild(top);

      const mid = document.createElement("div");
      mid.className = "evo-report-mid";
      const dims = (report.dimensions || []).map(formatDimensionLabel).join(" · ");
      const targets = (report.changeTargets || []).map(formatChangeTargetLabel).join(" · ");
      const searchFlag = report.useSearch ? "search:on" : "search:off";
      mid.textContent = `${dims || "no dimensions"} · ${targets || "no targets"} · ${searchFlag}`;
      row.appendChild(mid);

      const chips = document.createElement("div");
      chips.className = "evo-report-chips";

      const chip = (text, tone) => {
        const span = document.createElement("span");
        span.className = `evo-badge tone-${tone || "muted"}`;
        span.textContent = text;
        return span;
      };

      const itemCount = Array.isArray(report.items) ? report.items.length : 0;
      const changeCount = countEvolutionReportChanges(report);
      chips.appendChild(chip(`${itemCount} items`, "muted"));
      chips.appendChild(chip(`${changeCount} changes`, "accent"));

      const matchesSelection =
        selectedTaskIds.length > 0 && reportMatchesTaskSelection(report, selectedTaskIds);
      if (state.evolutionHistoryScope === "all" && matchesSelection) {
        chips.appendChild(chip("matches selection", "success"));
      }
      if (report.parseError) {
        chips.appendChild(chip("parse error", "danger"));
      }
      row.appendChild(chips);

      list.appendChild(row);
    });
  }

  const historyFooter = document.createElement("div");
  historyFooter.className = "evo-pane-footer";
  const shown = filteredReports.length;
  const total = state.evolutionReports.length;
  historyFooter.textContent = total ? `${shown}/${total} shown` : "";
  historyPane.appendChild(list);
  historyPane.appendChild(historyFooter);

  grid.appendChild(historyPane);

  const detailPane = document.createElement("section");
  detailPane.className = "evo-pane evo-detail";
  const activeReport = getEvolutionReportById(state.evolutionActiveReportId);
  if (!activeReport) {
    detailPane.appendChild(createEmptyState("Select a report to view details."));
    grid.appendChild(detailPane);
    evolutionContentEl.appendChild(grid);
    return;
  }

  const detailHeader = document.createElement("div");
  detailHeader.className = "evo-detail-header";
  const detailTitle = document.createElement("h4");
  detailTitle.className = "evo-detail-title";
  detailTitle.textContent = activeReport.summary || "Evolution report";
  detailHeader.appendChild(detailTitle);

  const detailMeta = document.createElement("div");
  detailMeta.className = "evo-detail-meta";
  const detailDims = (activeReport.dimensions || []).map(formatDimensionLabel).join(" · ");
  const detailTargets = (activeReport.changeTargets || []).map(formatChangeTargetLabel).join(" · ");
  const detailSearchFlag = activeReport.useSearch ? "search:on" : "search:off";
  detailMeta.textContent = `${formatTaskTime(activeReport.createdAt)} · ${detailDims || "no dimensions"} · ${
    detailTargets || "no targets"
  } · ${detailSearchFlag}`;
  detailHeader.appendChild(detailMeta);

  const detailActions = document.createElement("div");
  detailActions.className = "evo-detail-actions";

  const selectTasksBtn = document.createElement("button");
  selectTasksBtn.type = "button";
  selectTasksBtn.className = "evo-action";
  selectTasksBtn.textContent = "Select these tasks";
  selectTasksBtn.addEventListener("click", () => {
    const nextIds = Array.isArray(activeReport.taskIds)
      ? activeReport.taskIds.filter((id) => typeof id === "string" && state.tasksById.has(id))
      : [];
    state.selectedTaskIds = new Set(nextIds);
    state.activeTaskId = null;
    state.focusedTaskId = null;
    persistSelectedTaskIds();
    renderSessions();
    updateActiveSessionCard();
    renderEvolutionView();
  });
  detailActions.appendChild(selectTasksBtn);

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "evo-action";
  copyBtn.textContent = "Copy report JSON";
  copyBtn.addEventListener("click", async () => {
    const ok = await copyToClipboard(JSON.stringify(activeReport, null, 2));
    showToast(ok ? "Copied report JSON." : "Copy failed.");
  });
  detailActions.appendChild(copyBtn);

  detailHeader.appendChild(detailActions);
  detailPane.appendChild(detailHeader);

  const detailBody = document.createElement("div");
  detailBody.className = "evo-detail-body";

  if (activeReport.parseError) {
    const callout = document.createElement("div");
    callout.className = "evo-callout danger";
    callout.textContent = activeReport.parseError;
    detailBody.appendChild(callout);
  }

  if (activeReport.ruleEngine && (activeReport.ruleEngine.matchedRuleIds || []).length > 0) {
    const callout = document.createElement("div");
    callout.className = "evo-callout";
    const matched = activeReport.ruleEngine.matchedRuleIds.length;
    const lines = [`Rule engine: ${matched} rule${matched === 1 ? "" : "s"} matched.`];
    if (activeReport.ruleEngine.overridePaths && activeReport.ruleEngine.overridePaths.length > 0) {
      lines.push(`Overrides: ${activeReport.ruleEngine.overridePaths.join(", ")}`);
    }
    callout.textContent = lines.join(" ");
    detailBody.appendChild(callout);
  }

  const taskIdsWrap = document.createElement("div");
  taskIdsWrap.className = "evo-taskids";
  (activeReport.taskIds || []).forEach((taskId) => {
    const task = state.tasksById.get(taskId);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "evo-taskid";
    chip.textContent = task ? taskDisplayTitle(task, 70) : taskId;
    chip.addEventListener("click", () => {
      if (task) {
        focusTask(task);
        setMainView("task");
      }
    });
    taskIdsWrap.appendChild(chip);
  });
  detailBody.appendChild(taskIdsWrap);

  const items = Array.isArray(activeReport.items) ? activeReport.items : [];
  if (items.length === 0) {
    detailBody.appendChild(createEmptyState("This report contains no items."));
  } else {
    const itemList = document.createElement("div");
    itemList.className = "evo-item-list";
    items.forEach((item) => {
      const details = document.createElement("details");
      details.className = "evo-item";
      if (state.evolutionOpenItemIds.has(item.itemId)) {
        details.open = true;
      }
      details.addEventListener("toggle", () => {
        if (!item?.itemId) {
          return;
        }
        if (details.open) {
          state.evolutionOpenItemIds.add(item.itemId);
        } else {
          state.evolutionOpenItemIds.delete(item.itemId);
        }
      });

      const summary = document.createElement("summary");
      summary.className = "evo-item-summary";

      const sev = document.createElement("span");
      sev.className = `evo-sev sev-${item.severity || "low"}`;
      sev.textContent = (item.severity || "low").toUpperCase();
      summary.appendChild(sev);

      const title = document.createElement("div");
      title.className = "evo-item-title";
      title.textContent = item.title || "Untitled finding";
      summary.appendChild(title);

      const meta = document.createElement("div");
      meta.className = "evo-item-meta";
      const dim = item.dimension ? formatDimensionLabel(item.dimension) : "dimension";
      meta.textContent = `${item.scope || "task"} · ${dim}`;
      summary.appendChild(meta);

      details.appendChild(summary);

      const body = document.createElement("div");
      body.className = "evo-item-body";

      if (item.taskId) {
        const task = state.tasksById.get(item.taskId);
        const line = document.createElement("div");
        line.className = "evo-item-task";
        line.textContent = task ? `Task: ${taskDisplayTitle(task, 120)}` : `Task: ${item.taskId}`;
        body.appendChild(line);
      }

      const addMd = (label, text) => {
        if (!text) {
          return;
        }
        const section = document.createElement("div");
        section.className = "evo-md";
        setMarkdown(section, `**${label}**\n\n${text}`, "block");
        body.appendChild(section);
      };

      addMd("Reasoning", item.reasoning);
      addMd("Evidence", item.evidence);
      addMd("Impact", item.impact);
      addMd("Risk", item.risk);
      addMd("Test plan", item.testPlan);
      addMd("Rollback plan", item.rollbackPlan);
      addMd("Recommendation", item.recommendation);

      if (Array.isArray(item.userActions) && item.userActions.length > 0) {
        const section = document.createElement("div");
        section.className = "evo-md";
        const blocks = ["**User actions**", ""];
        item.userActions.forEach((action) => {
          blocks.push(`### ${action.title || "Action"}`);
          if (action.reason) {
            blocks.push(action.reason);
            blocks.push("");
          }
          const steps = Array.isArray(action.steps) ? action.steps.filter(Boolean) : [];
          if (steps.length > 0) {
            steps.forEach((step, idx) => blocks.push(`${idx + 1}. ${step}`));
          } else {
            blocks.push("(no steps provided)");
          }
          blocks.push("");
        });
        setMarkdown(section, blocks.join("\n"), "block");
        body.appendChild(section);
      }

      if (Array.isArray(item.changes) && item.changes.length > 0) {
        const changeList = document.createElement("div");
        changeList.className = "evo-change-list";
        item.changes.forEach((change) => {
          const changeCard = document.createElement("div");
          changeCard.className = "evo-change";

          const changeTitle = document.createElement("div");
          changeTitle.className = "evo-change-title";
          changeTitle.textContent = change.summary || "Proposed change";
          changeCard.appendChild(changeTitle);

          const changeMeta = document.createElement("div");
          changeMeta.className = "evo-change-meta";
          const target = change.target?.path || change.target?.kind || "unknown";
          const op = change.operation?.type || "operation";
          const restart = change.requiresRestart ? " · restart" : "";
          changeMeta.textContent = `${target} · ${op}${restart}`;
          changeCard.appendChild(changeMeta);

          if (change.reason) {
            const changeReason = document.createElement("div");
            changeReason.className = "evo-md";
            setMarkdown(changeReason, change.reason, "block");
            changeCard.appendChild(changeReason);
          }

          const apply = document.createElement("button");
          apply.type = "button";
          apply.className = "evo-apply";
          const applied = state.appliedChanges.has(change.changeId);
          apply.textContent = applied ? "Applied" : "Apply change";
          apply.disabled = applied || state.applyingChanges.has(change.changeId);
          apply.addEventListener("click", () => applyEvolutionChange(activeReport.reportId, change.changeId));
          changeCard.appendChild(apply);

          changeList.appendChild(changeCard);
        });
        body.appendChild(changeList);
      }

      details.appendChild(body);
      itemList.appendChild(details);
    });
    detailBody.appendChild(itemList);
  }

  if (activeReport.rawResponse) {
    const raw = document.createElement("details");
    raw.className = "evo-raw";
    const sum = document.createElement("summary");
    sum.textContent = "Raw response";
    raw.appendChild(sum);
    const pre = document.createElement("pre");
    pre.textContent = activeReport.rawResponse;
    raw.appendChild(pre);
    detailBody.appendChild(raw);
  }

  detailPane.appendChild(detailBody);

  grid.appendChild(detailPane);
  evolutionContentEl.appendChild(grid);
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

function collectEventChips(event, hasChildren) {
  const chips = [];
  const details = event?.details ?? {};

  if (event.durationMs != null) {
    chips.push({ label: `${(event.durationMs / 1000).toFixed(2)}s`, tone: "muted" });
  }

  if (hasChildren) {
    chips.push({
      label: `${event.children.length} child${event.children.length === 1 ? "" : "ren"}`,
      tone: "muted",
    });
  }

  if (event.kind === "tool") {
    const isError = Boolean(details && typeof details === "object" && details.isError);
    if (isError) {
      chips.push({ label: "error", tone: "danger" });
    }
    if (typeof event.toolName === "string" && event.toolName) {
      chips.push({ label: event.toolName, tone: "accent" });
    }
  }

  if (event.kind === "assistant_message") {
    const hasThinking =
      details &&
      typeof details === "object" &&
      Array.isArray(details.thinking) &&
      details.thinking.length > 0;
    if (hasThinking) {
      chips.push({ label: "thinking", tone: "info" });
    }
  }

  if (event.kind === "subagent_run") {
    const outcomeStatus =
      details &&
      typeof details === "object" &&
      details.outcome &&
      typeof details.outcome === "object" &&
      typeof details.outcome.status === "string"
        ? details.outcome.status
        : "";
    if (outcomeStatus) {
      const tone =
        outcomeStatus.toLowerCase() === "success"
          ? "success"
          : outcomeStatus.toLowerCase() === "failed"
            ? "danger"
            : "muted";
      chips.push({ label: outcomeStatus, tone });
    }
  }

  if (event.kind === "agent_event") {
    const stream =
      details && typeof details === "object" && typeof details.stream === "string"
        ? details.stream
        : "";
    if (stream) {
      chips.push({ label: stream, tone: "info" });
    }
  }

  return chips;
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

  const chips = collectEventChips(event, hasChildren);
  if (chips.length > 0) {
    const meta = document.createElement("div");
    meta.className = "event-meta";
    chips.forEach((chip) => {
      const span = document.createElement("span");
      span.className = `event-chip tone-${chip.tone || "muted"}`;
      span.textContent = chip.label;
      meta.appendChild(span);
    });
    card.appendChild(meta);
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
  renderTaskStrip();
  timelineEl.innerHTML = "";
  if (!state.activeSessionKey) {
    if (timelineCountEl) {
      timelineCountEl.textContent = "";
    }
    if (clearFocusEl) {
      clearFocusEl.hidden = true;
    }
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

  if (clearFocusEl) {
    clearFocusEl.hidden = !focusRange;
  }

  const filteredResult = filterEventTree(state.events, {
    filters: state.filters,
    search,
    focusRange,
  });

  state.filteredEventIds = filteredResult.ids;

  const firstVisibleId = findFirstEventId(filteredResult.events);
  const previousSelected = state.selectedEventId;
  if (firstVisibleId && !state.filteredEventIds.has(state.selectedEventId)) {
    state.selectedEventId = firstVisibleId;
  }

  if (timelineCountEl) {
    const total = state.eventIndex?.size ?? 0;
    const visible = state.filteredEventIds.size;
    const focusFlag = focusRange ? " · focus:on" : "";
    const searchFlag = search ? " · search:on" : "";
    timelineCountEl.textContent = `${visible}/${total} events${focusFlag}${searchFlag}`;
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

  if (state.selectedEventId && state.selectedEventId !== previousSelected) {
    scrollEventIntoView(state.selectedEventId);
  }
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
    renderTimeline();
  } catch {
    state.tasksLoaded = true;
    renderSessions();
    renderEvolutionView();
    renderTimeline();
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
    renderSessions();
    renderDetailPanel();
    renderEvolutionView();
  } catch {
    state.analysesLoaded = true;
    renderSessions();
    renderDetailPanel();
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
      state.evolutionActiveReportId = data.report.reportId || null;
      persistString(EVOLUTION_ACTIVE_REPORT_KEY, state.evolutionActiveReportId ?? "");
      state.evolutionOpenItemIds = new Set();
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

function getAllFilterKindsFromDom() {
  return Array.from(document.querySelectorAll(".filters input[type=checkbox]"))
    .map((el) => el.getAttribute("data-kind"))
    .filter((value) => typeof value === "string" && value.trim().length > 0);
}

function syncFilterCheckboxes() {
  document.querySelectorAll(".filters input[type=checkbox]").forEach((input) => {
    const kind = input.getAttribute("data-kind");
    if (!kind) {
      return;
    }
    input.checked = state.filters.has(kind);
  });
}

function setFilters(nextFilters) {
  state.filters = new Set(Array.from(nextFilters));
  persistStringSet(FILTERS_KEY, state.filters);
  syncFilterCheckboxes();
  renderTimeline();
}

function runFilterAction(action) {
  const allKinds = new Set(getAllFilterKindsFromDom());
  if (action === "all") {
    setFilters(allKinds);
    return;
  }
  if (action === "none") {
    setFilters([]);
    return;
  }
  if (action === "messages") {
    setFilters(
      ["user_message", "assistant_message"].filter((kind) => allKinds.has(kind)),
    );
    return;
  }
  if (action === "tools") {
    setFilters(
      ["tool", "subagent_run", "subagent_result"].filter((kind) => allKinds.has(kind)),
    );
  }
}

function wireFilters() {
  syncFilterCheckboxes();

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
      persistStringSet(FILTERS_KEY, state.filters);
      renderTimeline();
    });
  });

  document.querySelectorAll("[data-filter-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.getAttribute("data-filter-action");
      if (!action) {
        return;
      }
      runFilterAction(action);
    });
  });
}

function isOpenDialog(dialogEl) {
  return Boolean(dialogEl && typeof dialogEl === "object" && dialogEl.open);
}

function closeDialog(dialogEl) {
  if (!dialogEl || typeof dialogEl.close !== "function") {
    return;
  }
  if (isOpenDialog(dialogEl)) {
    dialogEl.close();
  }
}

function openDialog(dialogEl) {
  if (!dialogEl || typeof dialogEl.showModal !== "function") {
    return false;
  }
  if (!isOpenDialog(dialogEl)) {
    dialogEl.showModal();
  }
  return true;
}

function getCmdkItems(query) {
  const q = query.trim().toLowerCase();
  const items = [];

  const addAction = (id, title, meta, run) => {
    if (q && !`${title} ${meta ?? ""}`.toLowerCase().includes(q)) {
      return;
    }
    items.push({ kind: "action", id, title, meta, run });
  };

  addAction("toggle_sidebar", "Toggle sessions sidebar", "UI", () => toggleSidebarHidden());
  addAction("clear_focus", "Clear focused task range", "Timeline", () => clearFocusedTask());
  addAction("clear_search", "Clear timeline search", "Timeline", () => {
    state.search = "";
    if (searchEl) {
      searchEl.value = "";
    }
    renderTimeline();
  });
  addAction("reset_filters", "Reset timeline filters", "Timeline", () => setFilters(DEFAULT_FILTERS));
  addAction("view_timeline", "Go to timeline view", "View", () => setMainView("task"));
  addAction("view_evolution", "Go to evolution view", "View", () => setMainView("evolution"));

  const sessionMatches = (session) => {
    if (!q) {
      return true;
    }
    const haystack = `${session.displayName ?? ""} ${session.label ?? ""} ${session.key ?? ""} ${
      session.kind ?? ""
    } ${session.agentId ?? ""}`.toLowerCase();
    return haystack.includes(q);
  };

  const taskMatches = (task) => {
    if (!q) {
      return true;
    }
    const title = taskDisplayTitle(task);
    const messageId = extractMessageId(task.userMessage || "");
    const haystack = `${title} ${messageId} ${task.taskId ?? ""} ${task.sessionKey ?? ""}`.toLowerCase();
    return haystack.includes(q);
  };

  const sessions = state.sessions.filter(sessionMatches);
  const sessionLimit = q ? 10 : 6;
  sessions.slice(0, sessionLimit).forEach((session) => {
    items.push({
      kind: "session",
      id: session.key,
      title: session.displayName || session.label || session.key,
      meta: `${session.kind} · ${session.agentId}`,
      run: () => {
        state.focusedTaskId = null;
        updateActiveSessionCard();
        loadTimeline(session.key);
      },
    });
  });

  const taskPool = [];
  if (state.tasksLoaded) {
    if (state.activeSessionKey) {
      const activeTasks = state.tasksBySession.get(state.activeSessionKey) || [];
      taskPool.push(...activeTasks);
    } else if (q) {
      state.tasksBySession.forEach((list) => taskPool.push(...list));
    }
  }
  const uniqueTasks = new Map(taskPool.map((task) => [task.taskId, task]));
  const tasks = Array.from(uniqueTasks.values()).filter(taskMatches);
  const taskLimit = q ? 14 : 8;
  tasks.slice(0, taskLimit).forEach((task) => {
    items.push({
      kind: "task",
      id: task.taskId,
      title: taskDisplayTitle(task, 120) || task.taskId,
      meta: `${task.sessionKey} · ${formatTaskTime(task.startTs)}`,
      run: () => focusTask(task),
    });
  });

  return items;
}

function renderCmdk() {
  if (!cmdkResultsEl) {
    return;
  }
  cmdkResultsEl.innerHTML = "";
  cmdkState.items = getCmdkItems(cmdkState.query);
  if (cmdkState.activeIndex >= cmdkState.items.length) {
    cmdkState.activeIndex = Math.max(0, cmdkState.items.length - 1);
  }

  if (cmdkState.items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "cmdk-empty";
    empty.textContent = "No results.";
    cmdkResultsEl.appendChild(empty);
    return;
  }

  cmdkState.items.forEach((item, idx) => {
    const row = document.createElement("div");
    row.className = "cmdk-item";
    row.setAttribute("role", "option");
    row.setAttribute("tabindex", "-1");
    row.setAttribute("aria-selected", idx === cmdkState.activeIndex ? "true" : "false");
    row.addEventListener("click", () => runCmdkItem(idx));

    const title = document.createElement("div");
    title.className = "cmdk-title";
    title.textContent = item.title;
    const meta = document.createElement("div");
    meta.className = "cmdk-meta";
    meta.textContent = item.meta || item.kind;

    row.appendChild(title);
    row.appendChild(meta);
    cmdkResultsEl.appendChild(row);
  });
}

function runCmdkItem(index) {
  const item = cmdkState.items[index];
  if (!item) {
    return;
  }
  closeDialog(cmdkDialogEl);
  item.run();
}

function openCmdk() {
  const ok = openDialog(cmdkDialogEl);
  if (!ok) {
    return;
  }
  cmdkState.query = "";
  cmdkState.activeIndex = 0;
  if (cmdkInputEl) {
    cmdkInputEl.value = "";
    cmdkInputEl.focus();
    cmdkInputEl.select();
  }
  renderCmdk();
}

function openHelp() {
  openDialog(helpDialogEl);
}

function fromEventDataId(encoded) {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function getVisibleTimelineEventIds() {
  if (!timelineEl) {
    return [];
  }
  return Array.from(timelineEl.querySelectorAll(".event[data-event-id]"))
    .filter((el) => el instanceof HTMLElement && el.offsetParent !== null)
    .map((el) => fromEventDataId(el.getAttribute("data-event-id") || ""))
    .filter(Boolean);
}

function moveTimelineSelection(delta) {
  if (state.mainView !== "task") {
    return;
  }
  const ids = getVisibleTimelineEventIds();
  if (!ids.length) {
    return;
  }
  const current = state.selectedEventId;
  const idx = current ? ids.indexOf(current) : -1;
  const nextIdx = Math.min(ids.length - 1, Math.max(0, (idx === -1 ? 0 : idx) + delta));
  const nextId = ids[nextIdx];
  if (nextId) {
    selectEvent(nextId);
  }
}

function toggleSelectedEventGroup() {
  if (!timelineEl || !state.selectedEventId) {
    return;
  }
  const card = timelineEl.querySelector(
    `[data-event-id="${toEventDataId(state.selectedEventId)}"]`,
  );
  if (!card) {
    return;
  }
  const group = card.closest("details.event-group");
  if (!group) {
    return;
  }
  group.open = !group.open;
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

if (sessionSearchEl) {
  sessionSearchEl.addEventListener("input", (event) => {
    const target = event.target;
    state.sessionSearch = target.value || "";
    renderSessions();
  });
}

if (sidebarToggleEl) {
  sidebarToggleEl.addEventListener("click", () => toggleSidebarHidden());
}

if (cmdkOpenEl) {
  cmdkOpenEl.addEventListener("click", () => openCmdk());
}

if (helpOpenEl) {
  helpOpenEl.addEventListener("click", () => openHelp());
}

if (clearFocusEl) {
  clearFocusEl.addEventListener("click", () => clearFocusedTask());
}

if (cmdkInputEl) {
  cmdkInputEl.addEventListener("input", (event) => {
    const target = event.target;
    cmdkState.query = target.value || "";
    cmdkState.activeIndex = 0;
    renderCmdk();
  });

  cmdkInputEl.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (cmdkState.items.length === 0) {
        return;
      }
      cmdkState.activeIndex = Math.min(cmdkState.items.length - 1, cmdkState.activeIndex + 1);
      renderCmdk();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (cmdkState.items.length === 0) {
        return;
      }
      cmdkState.activeIndex = Math.max(0, cmdkState.activeIndex - 1);
      renderCmdk();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (cmdkState.items.length === 0) {
        return;
      }
      runCmdkItem(cmdkState.activeIndex);
      return;
    }
    if (event.key === "Escape") {
      if (cmdkState.query) {
        event.preventDefault();
        cmdkState.query = "";
        cmdkState.activeIndex = 0;
        cmdkInputEl.value = "";
        renderCmdk();
        return;
      }
      closeDialog(cmdkDialogEl);
    }
  });
}

document.addEventListener("keydown", (event) => {
  const key = event.key || "";
  const lower = key.toLowerCase();

  if (lower === "k" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    openCmdk();
    return;
  }

  if (isOpenDialog(cmdkDialogEl) || isOpenDialog(helpDialogEl)) {
    return;
  }

  if (key === "?" && !isTypingTarget(event.target)) {
    event.preventDefault();
    openHelp();
    return;
  }

  if (key === "/" && !isTypingTarget(event.target)) {
    event.preventDefault();
    if (searchEl) {
      searchEl.focus();
      searchEl.select();
    }
    return;
  }

  if (state.mainView === "task" && !isTypingTarget(event.target)) {
    if (isInteractiveElement(document.activeElement)) {
      return;
    }
    if (lower === "j" || key === "ArrowDown") {
      event.preventDefault();
      moveTimelineSelection(1);
      return;
    }
    if (lower === "k" || key === "ArrowUp") {
      event.preventDefault();
      moveTimelineSelection(-1);
      return;
    }
    if (key === "Enter") {
      event.preventDefault();
      toggleSelectedEventGroup();
      return;
    }
    if (key === "Escape") {
      if (state.search) {
        event.preventDefault();
        state.search = "";
        if (searchEl) {
          searchEl.value = "";
        }
        renderTimeline();
        showToast("Cleared search.");
        return;
      }
      if (state.focusedTaskId) {
        event.preventDefault();
        clearFocusedTask();
        showToast("Cleared focus.");
      }
    }
  }
});

updateSidebarVisibility();
setMainView(state.mainView);

wireFilters();
loadSessions();
loadTasks();
loadAnalyses();
loadEvolutionReports();
renderTimeline();
