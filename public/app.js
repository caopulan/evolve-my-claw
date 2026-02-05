const state = {
  sessions: [],
  activeSessionKey: null,
  events: [],
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
const evolutionContentEl = document.getElementById("evolution-content");
const evolutionSubtitleEl = document.getElementById("evolution-subtitle");
const viewTabs = Array.from(document.querySelectorAll(".view-tab"));
const taskViewEl = document.getElementById("task-view");
const evolutionViewEl = document.getElementById("evolution-view");
const mainEl = document.querySelector(".main");

const SELECTED_TASKS_KEY = "emc_selected_tasks";

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
  viewTabs.forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-view") === view);
  });
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

state.selectedTaskIds = loadSelectedTaskIds();

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
  const formatted = formatJsonValue(value);
  const rawText = typeof value === "string" ? value : formatted;
  valueSpan.textContent = formatted;
  valueSpan.dataset.raw = rawText;
  valueSpan.dataset.formatted = formatted;
  valueSpan.dataset.mode = "plain";
  valueSpan.addEventListener("click", (event) => {
    event.stopPropagation();
    const mode = valueSpan.dataset.mode || "plain";
    if (mode === "markdown") {
      valueSpan.textContent = formatted;
      valueSpan.dataset.mode = "plain";
      valueSpan.classList.remove("is-markdown", "md-inline", "md-block");
      return;
    }
    const displayMode = guessMarkdownMode(rawText);
    setMarkdown(valueSpan, rawText, displayMode);
    valueSpan.dataset.mode = "markdown";
    valueSpan.classList.add("is-markdown");
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

function renderEvolutionView() {
  if (!evolutionContentEl) {
    return;
  }
  evolutionContentEl.innerHTML = "";
  const selectedTasks = getSelectedTasks();
  const selectedCount = selectedTasks.length;

  if (evolutionSubtitleEl) {
    evolutionSubtitleEl.textContent = selectedCount
      ? `${selectedCount} task${selectedCount > 1 ? "s" : ""} selected`
      : "No tasks selected";
  }

  if (!selectedTasks.length) {
    evolutionContentEl.appendChild(createEmptyState("Select tasks to view evolution analysis."));
    return;
  }

  if (!state.analysesLoaded) {
    evolutionContentEl.appendChild(createEmptyState("Loading evolution analysis..."));
    return;
  }

  const container = document.createElement("div");
  container.className = "analysis-list";
  selectedTasks.forEach((task) => {
    const record = state.analysesByTask?.get(task.taskId);
    const card = document.createElement("div");
    card.className = "analysis-card";

    const header = document.createElement("div");
    header.className = "analysis-header";
    const title = document.createElement("div");
    title.className = "analysis-title";
    title.textContent = taskDisplayTitle(task, 90);
    const meta = document.createElement("div");
    meta.className = "analysis-meta";
    meta.textContent = formatTaskTime(task.startTs);
    header.appendChild(title);
    header.appendChild(meta);
    card.appendChild(header);

    if (!record) {
      const empty = document.createElement("div");
      empty.className = "analysis-empty";
      empty.textContent = "No analysis found. Run `node dist/cli.js analyze` to generate.";
      card.appendChild(empty);
      container.appendChild(card);
      return;
    }

    const statusRow = document.createElement("div");
    statusRow.className = "analysis-status";
    const status = document.createElement("span");
    status.className = `analysis-pill status-${record.analysis?.status ?? "unknown"}`;
    status.textContent = record.analysis?.status ?? "unknown";
    const confidence = document.createElement("span");
    confidence.className = "analysis-pill";
    confidence.textContent = `confidence ${(record.analysis?.confidence ?? 0).toFixed(2)}`;
    statusRow.appendChild(status);
    statusRow.appendChild(confidence);
    card.appendChild(statusRow);

    if (record.analysis?.summary) {
      const summary = document.createElement("div");
      summary.className = "analysis-summary";
      setMarkdown(summary, record.analysis.summary, "block");
      card.appendChild(summary);
    }

    const detail = document.createElement("div");
    detail.className = "analysis-detail";
    const fields = [
      { label: "Type", value: record.analysis?.task_type },
      { label: "Merge", value: record.analysis?.merge_key },
    ];
    fields.forEach((field) => {
      if (!field.value) {
        return;
      }
      const row = document.createElement("div");
      row.className = "analysis-field";
      const key = document.createElement("span");
      key.className = "analysis-key";
      key.textContent = field.label;
      const value = document.createElement("span");
      value.className = "analysis-value";
      value.textContent = field.value;
      row.appendChild(key);
      row.appendChild(value);
      detail.appendChild(row);
    });
    card.appendChild(detail);

    if (Array.isArray(record.analysis?.issues) && record.analysis.issues.length > 0) {
      const issues = document.createElement("div");
      issues.className = "analysis-section";
      const titleEl = document.createElement("div");
      titleEl.className = "analysis-section-title";
      titleEl.textContent = "Issues";
      issues.appendChild(titleEl);
      record.analysis.issues.forEach((issue) => {
        const item = document.createElement("div");
        item.className = "analysis-item";
        setMarkdown(item, issue);
        issues.appendChild(item);
      });
      card.appendChild(issues);
    }

    if (Array.isArray(record.analysis?.suggestions) && record.analysis.suggestions.length > 0) {
      const suggestions = document.createElement("div");
      suggestions.className = "analysis-section";
      const titleEl = document.createElement("div");
      titleEl.className = "analysis-section-title";
      titleEl.textContent = "Suggestions";
      suggestions.appendChild(titleEl);
      record.analysis.suggestions.forEach((suggestion) => {
        const item = document.createElement("div");
        item.className = "analysis-item";
        setMarkdown(item, suggestion);
        suggestions.appendChild(item);
      });
      card.appendChild(suggestions);
    }

    if (Array.isArray(record.analysis?.steps) && record.analysis.steps.length > 0) {
      const steps = document.createElement("div");
      steps.className = "analysis-section";
      const titleEl = document.createElement("div");
      titleEl.className = "analysis-section-title";
      titleEl.textContent = "Steps";
      steps.appendChild(titleEl);
      record.analysis.steps.forEach((step) => {
        const item = document.createElement("div");
        item.className = "analysis-item";
        setMarkdown(item, step.evidence ? `${step.what} (${step.evidence})` : step.what);
        steps.appendChild(item);
      });
      card.appendChild(steps);
    }

    if (record.parseError) {
      const error = document.createElement("div");
      error.className = "analysis-error";
      error.textContent = `Parse error: ${record.parseError}`;
      card.appendChild(error);
    }

    container.appendChild(card);
  });

  evolutionContentEl.appendChild(container);
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

  const filtered = state.events.filter((event) => {
    if (!state.filters.has(event.kind)) {
      return false;
    }
    if (focusRange) {
      if (event.ts < focusRange.start || event.ts > focusRange.end) {
        return false;
      }
    }
    if (!search) {
      return true;
    }
    const target = `${event.summary ?? ""} ${JSON.stringify(event.details ?? {})}`.toLowerCase();
    return target.includes(search);
  });

  state.filteredEventIds = new Set(filtered.map((event) => getEventKey(event)));

  if (filtered.length > 0 && !state.filteredEventIds.has(state.selectedEventId)) {
    state.selectedEventId = getEventKey(filtered[0]);
  }

  if (!filtered.length) {
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
    setMarkdown(summary, event.summary || "(no summary)");

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

async function loadTimeline(sessionKey) {
  state.activeSessionKey = sessionKey;
  updateActiveSessionCard();
  setSessionExpanded(sessionKey, true);
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

viewTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const key = tab.getAttribute("data-view");
    if (key === "task" || key === "evolution") {
      setMainView(key);
    }
  });
});

if (mainEl) {
  mainEl.setAttribute("data-view", state.mainView);
}

wireFilters();
loadSessions();
loadTasks();
loadAnalyses();
renderTimeline();
