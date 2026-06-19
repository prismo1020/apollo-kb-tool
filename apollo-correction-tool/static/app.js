const state = {
  matches: [],
  selectedFile: "",
  mode: "existing",
  lastPayload: null,
  draft: "",
  queue: [],
  activeQueueId: null,
};

const els = {
  form: document.getElementById("correctionForm"),
  fileCount: document.getElementById("fileCount"),
  kbRoot: document.getElementById("kbRoot"),
  syncState: document.getElementById("syncState"),
  emptyState: document.getElementById("emptyState"),
  reviewContent: document.getElementById("reviewContent"),
  matchList: document.getElementById("matchList"),
  sectionSummary: document.getElementById("sectionSummary"),
  currentSection: document.getElementById("currentSection"),
  replacementPreview: document.getElementById("replacementPreview"),
  modeExisting: document.getElementById("modeExisting"),
  modeNew: document.getElementById("modeNew"),
  newFileFields: document.getElementById("newFileFields"),
  openConfirm: document.getElementById("openConfirm"),
  confirmLayer: document.getElementById("confirmLayer"),
  confirmText: document.getElementById("confirmText"),
  reviewedCheck: document.getElementById("reviewedCheck"),
  confirmApprove: document.getElementById("confirmApprove"),
  cancelConfirm: document.getElementById("cancelConfirm"),
  toast: document.getElementById("toast"),
  recentList: document.getElementById("recentList"),
  clearForm: document.getElementById("clearForm"),
  refreshStatus: document.getElementById("refreshStatus"),
  sandboxLogo: document.getElementById("sandboxLogo"),
  addToBatch: document.getElementById("addToBatch"),
  analyzeBatch: document.getElementById("analyzeBatch"),
  clearBatch: document.getElementById("clearBatch"),
  batchList: document.getElementById("batchList"),
  batchCount: document.getElementById("batchCount"),
  batchReview: document.getElementById("batchReview"),
  batchReviewList: document.getElementById("batchReviewList"),
  batchReviewCount: document.getElementById("batchReviewCount"),
};

function payloadFromForm() {
  return {
    question: document.getElementById("question").value.trim(),
    wrong_answer: document.getElementById("wrong_answer").value.trim(),
    correct_answer: document.getElementById("correct_answer").value.trim(),
    category: document.getElementById("category").value.trim(),
    submitter: document.getElementById("submitter").value.trim(),
    notes: document.getElementById("notes").value.trim(),
    new_topic: document.getElementById("new_topic").value.trim(),
    new_purpose: document.getElementById("new_purpose").value.trim(),
  };
}

function hasCorrectionContent(payload) {
  return Boolean(payload.question || payload.wrong_answer || payload.correct_answer || payload.notes);
}

function makeQueueId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function shortText(value, fallback = "Untitled correction") {
  const text = (value || "").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  return text.length > 92 ? `${text.slice(0, 89)}...` : text;
}

function activeQueueItem() {
  return state.queue.find((item) => item.id === state.activeQueueId) || null;
}

function persistActiveReviewEdits() {
  const item = activeQueueItem();
  if (!item) return;
  item.mode = state.mode;
  item.selectedFile = state.selectedFile;
  item.replacementText = els.replacementPreview.value.trim();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data.error || "Request failed.");
  }
  return data;
}

function setMode(mode) {
  state.mode = mode;
  const item = activeQueueItem();
  if (item) {
    item.mode = mode;
  }
  els.modeExisting.classList.toggle("active", mode === "existing");
  els.modeNew.classList.toggle("active", mode === "new");
  els.newFileFields.classList.toggle("hidden", mode !== "new");
  renderMatches();
  renderSectionPreview();
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.add("hidden"), 4200);
}

function statusLabel(item) {
  if (item.status === "approved") return "Approved";
  if (item.status === "analyzed") return "Analyzed";
  if (item.status === "error") return "Needs review";
  return "Queued";
}

function renderBatchQueue() {
  const pending = state.queue.filter((item) => item.status !== "approved").length;
  els.batchCount.textContent = `${pending} pending`;
  if (!state.queue.length) {
    els.batchList.innerHTML = '<div class="batch-empty">No queued corrections.</div>';
    els.analyzeBatch.disabled = true;
    els.clearBatch.disabled = true;
    return;
  }

  els.analyzeBatch.disabled = !state.queue.some((item) => item.status !== "approved");
  els.clearBatch.disabled = false;
  els.batchList.innerHTML = state.queue
    .map((item, index) => {
      const label = shortText(item.payload.question || item.payload.correct_answer, `Correction ${index + 1}`);
      return `
        <div class="batch-item">
          <div class="batch-title">
            <span>${index + 1}. ${escapeHtml(label)}</span>
            <span class="status-chip ${escapeHtml(item.status)}">${escapeHtml(statusLabel(item))}</span>
          </div>
          <div class="batch-subtitle">${escapeHtml(item.payload.category || "Auto-detect")}</div>
        </div>
      `;
    })
    .join("");
}

function renderBatchReview() {
  const analyzed = state.queue.filter((item) => item.status === "analyzed" || item.status === "approved" || item.status === "error");
  els.batchReview.classList.toggle("hidden", !state.queue.length);
  els.batchReviewCount.textContent = `${analyzed.length} analyzed`;
  if (!state.queue.length) {
    els.batchReviewList.innerHTML = "";
    return;
  }

  els.batchReviewList.innerHTML = state.queue
    .map((item, index) => {
      const active = item.id === state.activeQueueId ? " active" : "";
      const match = item.matches?.[0];
      const target = item.status === "analyzed" || item.status === "approved"
        ? `${match?.name || "No file"} - ${match?.section_heading || "No section"}`
        : item.error || "Not analyzed";
      const label = shortText(item.payload.question || item.payload.correct_answer, `Correction ${index + 1}`);
      return `
        <button class="batch-review-item${active}" type="button" data-id="${escapeHtml(item.id)}">
          <div class="batch-title">
            <span>${index + 1}. ${escapeHtml(label)}</span>
            <span class="status-chip ${escapeHtml(item.status)}">${escapeHtml(statusLabel(item))}</span>
          </div>
          <div class="batch-subtitle">${escapeHtml(target)}</div>
        </button>
      `;
    })
    .join("");

  els.batchReviewList.querySelectorAll(".batch-review-item").forEach((button) => {
    button.addEventListener("click", () => {
      persistActiveReviewEdits();
      loadQueueItem(button.dataset.id);
    });
  });
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderMatches() {
  if (state.mode === "new") {
    els.matchList.innerHTML = "";
    return;
  }

  if (!state.matches.length) {
    els.matchList.innerHTML = '<div class="empty-state"><strong>No matching file</strong><span>Create a new KB file for this correction.</span></div>';
    return;
  }

  els.matchList.innerHTML = state.matches
    .map((match) => {
      const selected = match.file === state.selectedFile ? " selected" : "";
      return `
        <button class="match${selected}" type="button" data-file="${escapeHtml(match.file)}">
          <div class="match-head">
            <div>
              <div class="match-title">${escapeHtml(match.name)}</div>
              <div class="match-meta">${escapeHtml(match.category)} - ${escapeHtml(match.confidence)} confidence</div>
            </div>
            <div class="match-score">${match.score}</div>
          </div>
          <div class="match-meta">Section: ${escapeHtml(match.section_heading || "No section detected")}</div>
          <div class="match-snippet">${escapeHtml(match.snippet || "No preview text available.")}</div>
        </button>
      `;
    })
    .join("");

  els.matchList.querySelectorAll(".match").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedFile = button.dataset.file;
      const item = activeQueueItem();
      if (item) {
        item.selectedFile = state.selectedFile;
      }
      renderMatches();
      renderSectionPreview();
    });
  });
}

function selectedMatch() {
  return state.matches.find((match) => match.file === state.selectedFile) || null;
}

function renderSectionPreview() {
  if (state.mode === "new") {
    const item = activeQueueItem();
    els.sectionSummary.classList.remove("hidden");
    els.sectionSummary.innerHTML = "<strong>New file mode.</strong> The approved content below will become guidance in a new KB document.";
    els.currentSection.value = "No existing section. A new KB file will be created.";
    els.replacementPreview.value = item?.replacementText || state.draft || "";
    return;
  }

  const match = selectedMatch();
  if (!match) {
    els.sectionSummary.classList.add("hidden");
    els.currentSection.value = "";
    els.replacementPreview.value = "";
    return;
  }

  els.sectionSummary.classList.remove("hidden");
  els.sectionSummary.innerHTML = `<strong>Matched section:</strong> ${escapeHtml(match.section_heading || "Unknown section")} <span class="muted">(${escapeHtml(match.section_confidence || "Low")} section confidence)</span>`;
  els.currentSection.value = match.section_text || "";
  const item = activeQueueItem();
  const savedReplacement = item && item.selectedFile === match.file ? item.replacementText : "";
  els.replacementPreview.value = savedReplacement || match.proposed_text || "";
}

function renderRecent(items = []) {
  if (!items.length) {
    els.recentList.innerHTML = '<div class="muted">No approved updates yet.</div>';
    return;
  }

  els.recentList.innerHTML = items
    .map((item) => {
      const mode = item.mode === "new_file" ? "New file" : "Section edit";
      return `
        <div class="recent-item">
          <span>${escapeHtml(item.timestamp || "")}</span>
          <strong>${escapeHtml(item.target_file || "")}</strong>
          <span>${mode}</span>
        </div>
      `;
    })
    .join("");
}

function applyAnalysisResult(payload, result) {
  state.matches = result.matches || [];
  state.selectedFile = state.matches[0]?.file || "";
  state.lastPayload = payload;
  state.draft = result.draft || "";
  els.emptyState.classList.add("hidden");
  els.reviewContent.classList.remove("hidden");
  setMode(result.suggested_action === "new_file" ? "new" : "existing");
}

function loadQueueItem(id) {
  const item = state.queue.find((entry) => entry.id === id);
  if (!item) return;
  state.activeQueueId = id;

  if (item.status === "queued") {
    els.emptyState.classList.add("hidden");
    els.reviewContent.classList.remove("hidden");
    state.matches = [];
    state.selectedFile = "";
    state.lastPayload = item.payload;
    state.draft = "";
    setMode("existing");
    els.sectionSummary.classList.remove("hidden");
    els.sectionSummary.innerHTML = "<strong>Queued correction.</strong> Analyze the batch before approval.";
    els.currentSection.value = "";
    els.replacementPreview.value = "";
    renderBatchReview();
    return;
  }

  state.matches = item.matches || [];
  state.selectedFile = item.selectedFile || state.matches[0]?.file || "";
  state.lastPayload = item.payload;
  state.draft = item.draft || "";
  els.emptyState.classList.add("hidden");
  els.reviewContent.classList.remove("hidden");
  setMode(item.mode || "existing");
  if (item.replacementText) {
    els.replacementPreview.value = item.replacementText;
  }
  renderBatchReview();
}

async function loadStatus() {
  els.syncState.textContent = "Indexing";
  const status = await api("/api/status");
  els.fileCount.textContent = String(status.file_count);
  els.kbRoot.textContent = status.kb_root;
  els.syncState.textContent = "Ready";
  renderRecent(status.recent);
}

async function analyze(event) {
  event.preventDefault();
  persistActiveReviewEdits();
  state.activeQueueId = null;
  const payload = payloadFromForm();
  if (!hasCorrectionContent(payload)) {
    showToast("Add a question, wrong answer, or approved guidance first.");
    return;
  }

  els.syncState.textContent = "Scanning";
  const result = await api("/api/analyze", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  applyAnalysisResult(payload, result);
  renderBatchReview();
  els.syncState.textContent = "Ready";
}

function clearCorrectionFields(keepMeta = false) {
  document.getElementById("question").value = "";
  document.getElementById("wrong_answer").value = "";
  document.getElementById("correct_answer").value = "";
  document.getElementById("notes").value = "";
  document.getElementById("new_topic").value = "";
  document.getElementById("new_purpose").value = "";
  if (!keepMeta) {
    document.getElementById("category").value = "";
    document.getElementById("submitter").value = "";
  }
}

function addCurrentToBatch() {
  const payload = payloadFromForm();
  if (!hasCorrectionContent(payload)) {
    showToast("Add correction details before adding to the batch.");
    return;
  }
  state.queue.push({
    id: makeQueueId(),
    payload,
    status: "queued",
    matches: [],
    selectedFile: "",
    mode: "existing",
    draft: "",
    replacementText: "",
  });
  renderBatchQueue();
  renderBatchReview();
  clearCorrectionFields(true);
  showToast("Correction added to batch.");
}

async function analyzeBatch() {
  const targets = state.queue.filter((item) => item.status === "queued" || item.status === "error");
  if (!targets.length) {
    showToast("No queued corrections need analysis.");
    return;
  }

  persistActiveReviewEdits();
  els.syncState.textContent = "Batch scanning";
  for (let index = 0; index < targets.length; index += 1) {
    const item = targets[index];
    try {
      els.syncState.textContent = `Scanning ${index + 1}/${targets.length}`;
      const result = await api("/api/analyze", {
        method: "POST",
        body: JSON.stringify(item.payload),
      });
      item.matches = result.matches || [];
      item.selectedFile = item.matches[0]?.file || "";
      item.mode = result.suggested_action === "new_file" ? "new" : "existing";
      item.draft = result.draft || "";
      item.replacementText = item.matches[0]?.proposed_text || item.draft;
      item.status = "analyzed";
      item.error = "";
    } catch (error) {
      item.status = "error";
      item.error = error.message;
    }
  }

  const firstReady = state.queue.find((item) => item.status === "analyzed");
  if (firstReady) {
    loadQueueItem(firstReady.id);
  }
  renderBatchQueue();
  renderBatchReview();
  els.syncState.textContent = "Ready";
}

function clearBatch() {
  const hadActiveBatchItem = Boolean(state.activeQueueId);
  state.queue = [];
  state.activeQueueId = null;
  if (hadActiveBatchItem) {
    state.matches = [];
    state.selectedFile = "";
    state.lastPayload = null;
    state.draft = "";
    els.emptyState.classList.remove("hidden");
    els.reviewContent.classList.add("hidden");
    els.currentSection.value = "";
    els.replacementPreview.value = "";
    els.sectionSummary.classList.add("hidden");
  }
  renderBatchQueue();
  renderBatchReview();
  showToast("Batch cleared.");
}

function openConfirm() {
  if (!state.lastPayload) {
    showToast("Analyze a correction before approving it.");
    return;
  }
  if (state.mode === "existing" && !state.selectedFile) {
    showToast("Select a KB file or switch to new file.");
    return;
  }
  if (!els.replacementPreview.value.trim()) {
    showToast("Review or add replacement section text before approving.");
    return;
  }
  const item = activeQueueItem();
  if (item && item.status !== "analyzed") {
    showToast("Analyze this queued correction before approving it.");
    return;
  }

  const target =
    state.mode === "new"
      ? "a new Apollo KB file"
      : `${state.selectedFile} (${selectedMatch()?.section_heading || "selected section"})`;
  els.confirmText.textContent = `This will write the proposed replacement to ${target}. The original file is backed up before any existing document is changed.`;
  els.reviewedCheck.checked = false;
  els.confirmApprove.disabled = true;
  els.confirmLayer.classList.remove("hidden");
}

function closeConfirm() {
  els.confirmLayer.classList.add("hidden");
}

async function approve() {
  const payload = {
    ...payloadFromForm(),
    mode: state.mode,
    target_file: state.selectedFile,
    section_heading: selectedMatch()?.section_heading || "",
    replacement_text: els.replacementPreview.value.trim(),
  };
  els.confirmApprove.disabled = true;
  els.confirmApprove.textContent = "Updating...";
  const result = await api("/api/approve", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const item = activeQueueItem();
  if (item) {
    item.status = "approved";
    item.result = result.result;
    item.replacementText = payload.replacement_text;
  }
  closeConfirm();
  els.confirmApprove.textContent = "Update Knowledge Base";
  showToast(`KB updated: ${result.result.target_file}`);
  await loadStatus();
  renderBatchQueue();
  renderBatchReview();
  const nextItem = state.queue.find((entry) => entry.status === "analyzed");
  if (nextItem) {
    loadQueueItem(nextItem.id);
  }
}

function clearForm() {
  els.form.reset();
  state.matches = [];
  state.selectedFile = "";
  state.lastPayload = null;
  state.draft = "";
  state.activeQueueId = null;
  els.emptyState.classList.remove("hidden");
  els.reviewContent.classList.add("hidden");
  els.currentSection.value = "";
  els.replacementPreview.value = "";
  els.sectionSummary.classList.add("hidden");
  renderBatchReview();
}

els.form.addEventListener("submit", (event) => {
  analyze(event).catch((error) => {
    els.syncState.textContent = "Ready";
    showToast(error.message);
  });
});

els.modeExisting.addEventListener("click", () => {
  persistActiveReviewEdits();
  setMode("existing");
});
els.modeNew.addEventListener("click", () => {
  persistActiveReviewEdits();
  setMode("new");
});
els.openConfirm.addEventListener("click", openConfirm);
els.cancelConfirm.addEventListener("click", closeConfirm);
els.reviewedCheck.addEventListener("change", () => {
  els.confirmApprove.disabled = !els.reviewedCheck.checked;
});
els.confirmApprove.addEventListener("click", () => {
  approve().catch((error) => {
    els.confirmApprove.disabled = false;
    els.confirmApprove.textContent = "Update Knowledge Base";
    showToast(error.message);
  });
});
els.clearForm.addEventListener("click", clearForm);
els.addToBatch.addEventListener("click", addCurrentToBatch);
els.analyzeBatch.addEventListener("click", () => {
  analyzeBatch().catch((error) => {
    els.syncState.textContent = "Ready";
    showToast(error.message);
  });
});
els.clearBatch.addEventListener("click", clearBatch);
els.refreshStatus.addEventListener("click", () => {
  loadStatus().catch((error) => showToast(error.message));
});
els.sandboxLogo.addEventListener("error", () => {
  els.sandboxLogo.classList.add("missing");
});

loadStatus().catch((error) => {
  els.syncState.textContent = "Needs attention";
  showToast(error.message);
});
renderBatchQueue();
renderBatchReview();
