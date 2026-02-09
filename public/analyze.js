(() => {
  const analyzeButton = document.getElementById("analyze-tasks");
  const analyzeDialog = document.getElementById("analyze-dialog");
  const analyzeOutput = document.getElementById("analyze-output");

  if (!analyzeButton) {
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

  function showAnalyzeDialog(text) {
    if (analyzeOutput) {
      analyzeOutput.textContent = text;
    }
    if (analyzeDialog && typeof analyzeDialog.showModal === "function") {
      analyzeDialog.showModal();
      return;
    }
    window.alert(text);
  }

  function formatAnalyzeResult(result) {
    const record = result && typeof result === "object" ? result : {};
    const duration = formatDuration(record.durationMs);
    const analyzed = Number.isFinite(record.analyzed) ? record.analyzed : "?";
    const selected = Number.isFinite(record.selected) ? record.selected : "?";
    const failed = Number.isFinite(record.failed) ? record.failed : "?";
    const appended = Number.isFinite(record.appended) ? record.appended : "?";

    const lines = [`Analyzed ${analyzed}/${selected} tasks (failed ${failed}).`, `Appended ${appended} analyses.`];
    if (duration) {
      lines.push(`Duration: ${duration}.`);
    }
    if (record.note && typeof record.note === "string") {
      lines.push(record.note);
    }
    return lines.join("\n");
  }

  async function refresh() {
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

  async function runAnalyze() {
    if (running) {
      return;
    }
    running = true;
    const runId = typeof window.startTaskAnalysisRun === "function" ? window.startTaskAnalysisRun() : null;

    const previousLabel = analyzeButton.textContent;
    analyzeButton.disabled = true;
    analyzeButton.textContent = "Analyzing";

    try {
      if (typeof window.showToast === "function") {
        window.showToast("Analyzing tasks...");
      }

      const res = await fetch("/api/tasks/analyze", { method: "POST" });
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
            : `Analyze failed (HTTP ${res.status}).`;
        if (runId && typeof window.finishTaskAnalysisRun === "function") {
          window.finishTaskAnalysisRun(runId, { status: "failed", error: message });
        }
        showAnalyzeDialog(`Analyze failed.\n\n${message}`);
        if (typeof window.showToast === "function") {
          window.showToast("Analyze failed.");
        }
        return;
      }

      if (runId && typeof window.finishTaskAnalysisRun === "function") {
        window.finishTaskAnalysisRun(runId, { status: "success", result: payload?.result });
      }
      try {
        await refresh();
      } catch {
        // ignore refresh failures; analysis run already succeeded.
      }
      const resultText = formatAnalyzeResult(payload?.result);
      showAnalyzeDialog(resultText || "Analyze completed.");
      if (typeof window.showToast === "function") {
        window.showToast("Analyze completed.");
      }
    } catch (err) {
      const message = err && typeof err.message === "string" ? err.message : String(err ?? "unknown error");
      if (runId && typeof window.finishTaskAnalysisRun === "function") {
        window.finishTaskAnalysisRun(runId, { status: "failed", error: message });
      }
      showAnalyzeDialog(`Analyze failed.\n\n${message}`);
      if (typeof window.showToast === "function") {
        window.showToast("Analyze failed.");
      }
    } finally {
      analyzeButton.disabled = false;
      analyzeButton.textContent = previousLabel;
      running = false;
    }
  }

  analyzeButton.addEventListener("click", () => {
    void runAnalyze();
  });
})();
