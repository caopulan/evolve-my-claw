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

function truncateText(text, max = 80) {
  const trimmed = text.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max)}…`;
}

function stripLeadingTimestamp(text) {
  return text
    .replace(
      /^\s*\[?\(?\d{4}(?:-|\/)\d{1,2}(?:-|\/)\d{1,2}(?:(?:\s|T)\d{1,2}:\d{2}(?::\d{2})?)?\)?\]?\s*(?:-|:|\|)\s*/i,
      "",
    )
    .trim();
}

function taskDisplayTitle(task, max = 80) {
  const base = task.userMessage || task.taskId || "";
  return truncateText(stripLeadingTimestamp(base), max);
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
        item.className = "task-item";
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
        info.appendChild(titleEl);
        info.appendChild(timeEl);
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
    card.classList.toggle("active", key === state.activeSessionKey);
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
  const selectedTasks = getSelectedTasks();
  const selectedCount = selectedTasks.length;
  let activeTask =
    (state.activeTaskId && state.tasksById.get(state.activeTaskId)) ||
    (selectedTasks.length > 0 ? selectedTasks[0] : null);
  if (activeTask && state.activeTaskId !== activeTask.taskId) {
    state.activeTaskId = activeTask.taskId;
  }

  detailTitleEl.textContent = "Task Detail";
  detailSubtitleEl.textContent = selectedCount
    ? `${selectedCount} task${selectedCount > 1 ? "s" : ""} selected`
    : "No tasks selected";

  if (!state.tasksLoaded) {
    detailBodyEl.appendChild(createEmptyState("Loading tasks..."));
    return;
  }

  renderTaskDetail(selectedTasks, activeTask);
}

function renderTaskDetail(selectedTasks, activeTask) {
  if (!selectedTasks.length) {
    detailBodyEl.appendChild(createEmptyState("Select tasks from the left panel to view details."));
    return;
  }

  const list = document.createElement("div");
  list.className = "task-detail-list";

  selectedTasks.forEach((task) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "task-detail-item" + (activeTask?.taskId === task.taskId ? " active" : "");
    const title = document.createElement("div");
    title.className = "task-detail-title";
    title.textContent = taskDisplayTitle(task, 90);
    const meta = document.createElement("div");
    meta.className = "task-detail-meta";
    meta.textContent = `${formatTaskTime(task.startTs)} · ${task.sessionKey}`;
    item.appendChild(title);
    item.appendChild(meta);
    item.addEventListener("click", () => {
      setActiveTask(task.taskId);
      focusTask(task);
    });
    list.appendChild(item);
  });

  detailBodyEl.appendChild(list);

  if (!activeTask) {
    return;
  }

  const meta = document.createElement("dl");
  meta.className = "detail-meta";
  const durationMs =
    typeof activeTask.endTs === "number" ? Math.max(0, activeTask.endTs - activeTask.startTs) : null;
  const metaItems = [
    { label: "Task ID", value: activeTask.taskId },
    { label: "Session", value: activeTask.sessionKey },
    { label: "Agent", value: activeTask.agentId },
    { label: "Start", value: formatTaskTime(activeTask.startTs) },
  ];
  if (activeTask.endTs) {
    metaItems.push({ label: "End", value: formatTaskTime(activeTask.endTs) });
  }
  if (durationMs != null) {
    metaItems.push({ label: "Duration", value: `${(durationMs / 1000).toFixed(2)}s` });
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

  const messageSection = document.createElement("div");
  messageSection.className = "detail-section";
  const messageTitle = document.createElement("div");
  messageTitle.className = "detail-section-title";
  messageTitle.textContent = "User Message";
  const messageText = document.createElement("div");
  messageText.textContent = activeTask.userMessage || "(no message)";
  messageSection.appendChild(messageTitle);
  messageSection.appendChild(messageText);
  detailBodyEl.appendChild(messageSection);

  const toolSummary = new Map();
  activeTask.toolCalls?.forEach((call) => {
    if (!call || !call.toolName) {
      return;
    }
    const entry = toolSummary.get(call.toolName) ?? { tool: call.toolName, count: 0, errors: 0 };
    entry.count += 1;
    if (call.isError) {
      entry.errors += 1;
    }
    toolSummary.set(call.toolName, entry);
  });

  const toolSection = document.createElement("div");
  toolSection.className = "detail-section";
  const toolTitle = document.createElement("div");
  toolTitle.className = "detail-section-title";
  toolTitle.textContent = "Tool Summary";
  toolSection.appendChild(toolTitle);
  if (toolSummary.size === 0) {
    const empty = document.createElement("div");
    empty.className = "json-empty";
    empty.textContent = "(no tool calls)";
    toolSection.appendChild(empty);
  } else {
    const list = document.createElement("div");
    list.className = "summary-list";
    toolSummary.forEach((entry) => {
      const row = document.createElement("div");
      row.className = "summary-row";
      const label = document.createElement("span");
      label.className = "summary-label";
      label.textContent = entry.tool;
      const value = document.createElement("span");
      value.className = "summary-value";
      value.textContent = `x${entry.count}${entry.errors ? ` (errors: ${entry.errors})` : ""}`;
      row.appendChild(label);
      row.appendChild(value);
      list.appendChild(row);
    });
    toolSection.appendChild(list);
  }
  detailBodyEl.appendChild(toolSection);

  if (Array.isArray(activeTask.continuations) && activeTask.continuations.length > 0) {
    const contSection = document.createElement("div");
    contSection.className = "detail-section";
    const contTitle = document.createElement("div");
    contTitle.className = "detail-section-title";
    contTitle.textContent = "Continuations";
    contSection.appendChild(contTitle);
    const list = document.createElement("div");
    list.className = "continuation-list";
    activeTask.continuations.forEach((cont) => {
      const row = document.createElement("div");
      row.className = "continuation-row";
      const kind = document.createElement("span");
      kind.className = "continuation-kind";
      kind.textContent = cont.kind;
      const text = document.createElement("span");
      text.className = "continuation-text";
      text.textContent = truncateText(cont.text, 140);
      row.appendChild(kind);
      row.appendChild(text);
      list.appendChild(row);
    });
    contSection.appendChild(list);
    detailBodyEl.appendChild(contSection);
  }
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
      summary.textContent = record.analysis.summary;
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
        item.textContent = issue;
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
        item.textContent = suggestion;
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
        item.textContent = step.evidence ? `${step.what} (${step.evidence})` : step.what;
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
