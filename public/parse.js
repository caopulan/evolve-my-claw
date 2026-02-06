(() => {
  const parseButton = document.getElementById("parse-tasks");
  const parseDialog = document.getElementById("parse-dialog");
  const parseOutput = document.getElementById("parse-output");

  if (!parseButton) {
    return;
  }

  let running = false;

  function formatDuration(ms) {
    const value = Number(ms);
    if (!Number.isFinite(value) || value < 0) {
      return "";
    }
    if (value < 1000) {
      return `${Math.round(value)}ms`;
    }
    const seconds = value / 1000;
    if (seconds < 60) {
      return `${seconds.toFixed(1)}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remain = Math.round(seconds - minutes * 60);
    return `${minutes}m${String(remain).padStart(2, "0")}s`;
  }

  function showParseDialog(text) {
    if (parseOutput) {
      parseOutput.textContent = text;
    }
    if (parseDialog && typeof parseDialog.showModal === "function") {
      parseDialog.showModal();
      return;
    }
    // Fallback for older browsers/contexts.
    window.alert(text);
  }

  function formatParseResult(result) {
    const record = result && typeof result === "object" ? result : {};
    const duration = formatDuration(record.durationMs);
    const lines = [];
    if (record.message && typeof record.message === "string") {
      lines.push(record.message);
    } else {
      const sessions = Number.isFinite(record.sessionCount) ? record.sessionCount : "?";
      const candidates = Number.isFinite(record.candidateCount) ? record.candidateCount : "?";
      const newTasks = Number.isFinite(record.newCount) ? record.newCount : "?";
      const existing = Number.isFinite(record.existingCount) ? record.existingCount : "?";
      lines.push(
        `Parsed ${sessions} sessions, ${candidates} candidates (${newTasks} new, ${existing} existing).`,
      );
      if (Number.isFinite(record.appended)) {
        lines.push(`Appended ${record.appended} tasks.`);
      }
    }
    if (duration) {
      lines.push(`Duration: ${duration}.`);
    }
    return lines.join("\n");
  }

  async function refreshSessionsAndTasks() {
    if (typeof window.loadSessions === "function") {
      await window.loadSessions();
    }
    if (typeof window.loadTasks === "function") {
      await window.loadTasks();
    }
    if (typeof window.loadAnalyses === "function") {
      await window.loadAnalyses();
    }
  }

  async function runParse() {
    if (running) {
      return;
    }
    running = true;

    const previousLabel = parseButton.textContent;
    parseButton.disabled = true;
    parseButton.textContent = "Parsing";

    try {
      if (typeof window.showToast === "function") {
        window.showToast("Parsing sessions into tasks...");
      }

      const res = await fetch("/api/parse", { method: "POST" });
      let payload = null;
      try {
        payload = await res.json();
      } catch {
        payload = null;
      }

      if (!res.ok) {
        const message =
          payload && typeof payload.error === "string"
            ? payload.error
            : `Parse failed (HTTP ${res.status}).`;
        showParseDialog(`Parse failed.\n\n${message}`);
        if (typeof window.showToast === "function") {
          window.showToast("Parse failed.");
        }
        return;
      }

      await refreshSessionsAndTasks();

      const resultText = formatParseResult(payload?.result);
      showParseDialog(resultText || "Parse completed.");
      if (typeof window.showToast === "function") {
        window.showToast("Parse completed.");
      }
    } catch (err) {
      const message = err && typeof err.message === "string" ? err.message : String(err ?? "unknown error");
      showParseDialog(`Parse failed.\n\n${message}`);
      if (typeof window.showToast === "function") {
        window.showToast("Parse failed.");
      }
    } finally {
      parseButton.disabled = false;
      parseButton.textContent = previousLabel;
      running = false;
    }
  }

  parseButton.addEventListener("click", () => {
    void runParse();
  });
})();

