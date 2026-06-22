const config = window.APOLLO_CONFIG || {};
const supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);

const GITHUB_RAW_BASE = "https://raw.githubusercontent.com/prismo1020/apollo-kb-tool/main/";

const state = {
  drafts: [],
  corrections: [],
  selectedId: null,
  mode: "existing",
  pendingMultiTargets: null,
};

const els = {
  syncState: document.getElementById("syncState"),
  form: document.getElementById("correctionForm"),
  question: document.getElementById("question"),
  wrongAnswer: document.getElementById("wrongAnswer"),
  approvedAnswer: document.getElementById("approvedAnswer"),
  oasisLink: document.getElementById("oasisLink"),
  category: document.getElementById("category"),
  reviewerLabel: document.getElementById("reviewerLabel"),
  reviewerNotes: document.getElementById("reviewerNotes"),
  runAutomation: document.getElementById("runAutomation"),
  addToBatch: document.getElementById("addToBatch"),
  submitBatch: document.getElementById("submitBatch"),
  clearBatch: document.getElementById("clearBatch"),
  clearForm: document.getElementById("clearForm"),
  batchList: document.getElementById("batchList"),
  batchCount: document.getElementById("batchCount"),
  statusFilter: document.getElementById("statusFilter"),
  refreshQueue: document.getElementById("refreshQueue"),
  queueList: document.getElementById("queueList"),
  emptyDetail: document.getElementById("emptyDetail"),
  detailContent: document.getElementById("detailContent"),
  detailStatus: document.getElementById("detailStatus"),
  detailTitle: document.getElementById("detailTitle"),
  oasisWarning: document.getElementById("oasisWarning"),
  reasoningBlock: document.getElementById("reasoningBlock"),
  reasoningText: document.getElementById("reasoningText"),
  modeExisting: document.getElementById("modeExisting"),
  modeNew: document.getElementById("modeNew"),
  targetFile: document.getElementById("targetFile"),
  targetSection: document.getElementById("targetSection"),
  newTopic: document.getElementById("newTopic"),
  newPurpose: document.getElementById("newPurpose"),
  currentSection: document.getElementById("currentSection"),
  proposedReplacement: document.getElementById("proposedReplacement"),
  saveDraft: document.getElementById("saveDraft"),
  openConfirm: document.getElementById("openConfirm"),
  rejectBtn: document.getElementById("rejectBtn"),
  rejectNote: document.getElementById("rejectNote"),
  rejectNoteRow: document.getElementById("rejectNoteRow"),
  resubmitBtn: document.getElementById("resubmitBtn"),
  copyForChatbase: document.getElementById("copyForChatbase"),
  downloadFile: document.getElementById("downloadFile"),
  commitLink: document.getElementById("commitLink"),
  activityList: document.getElementById("activityList"),
  confirmLayer: document.getElementById("confirmLayer"),
  confirmText: document.getElementById("confirmText"),
  reviewedCheck: document.getElementById("reviewedCheck"),
  confirmApprove: document.getElementById("confirmApprove"),
  cancelConfirm: document.getElementById("cancelConfirm"),
  toast: document.getElementById("toast"),
};

// ── UTILS ──────────────────────────────────────────────────────────────────

function showToast(message, type = "default") {
  els.toast.textContent = message;
  els.toast.className = `toast toast-${type}`;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.add("hidden"), 4200);
}

function setSync(text, live = false) {
  els.syncState.textContent = text;
  els.syncState.classList.toggle("live", live);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function shortText(value, fallback = "Untitled correction") {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  return text.length > 92 ? `${text.slice(0, 89)}...` : text;
}

function statusLabel(status) {
  return String(status || "submitted").replaceAll("_", " ");
}

function switchToView(viewName) {
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
  const btn = document.querySelector(`.nav-item[data-view="${viewName}"]`);
  if (btn) btn.classList.add("active");
  const view = document.getElementById(`${viewName}View`);
  if (view) view.classList.add("active");
}

// ── FORM ──────────────────────────────────────────────────────────────────

function formPayload() {
  return {
    question: els.question.value.trim(),
    wrong_answer: els.wrongAnswer.value.trim(),
    approved_answer: els.approvedAnswer.value.trim(),
    oasis_link: els.oasisLink.value.trim(),
    category: els.category.value.trim(),
    reviewer_label: els.reviewerLabel.value.trim(),
    reviewer_notes: els.reviewerNotes.value.trim(),
  };
}

function hasContent(payload) {
  return Boolean(payload.question || payload.wrong_answer || payload.approved_answer || payload.reviewer_notes);
}

function clearCorrectionFields(keepMeta = false) {
  els.question.value = "";
  els.wrongAnswer.value = "";
  els.approvedAnswer.value = "";
  els.oasisLink.value = "";
  els.reviewerNotes.value = "";
  if (!keepMeta) {
    els.category.value = "";
    els.reviewerLabel.value = "";
  }
}

// ── BATCH ─────────────────────────────────────────────────────────────────

function renderBatch() {
  els.batchCount.textContent = `${state.drafts.length} pending`;
  els.submitBatch.disabled = !state.drafts.length;
  els.clearBatch.disabled = !state.drafts.length;
  if (!state.drafts.length) {
    els.batchList.innerHTML = '<div class="batch-item muted">No queued corrections.</div>';
    return;
  }
  els.batchList.innerHTML = state.drafts
    .map((draft, index) => `
      <div class="batch-item">
        <div class="batch-title">
          <span>${index + 1}. ${escapeHtml(shortText(draft.question || draft.approved_answer))}</span>
          <span class="status-chip">Draft</span>
        </div>
        <div class="batch-subtitle">${escapeHtml(draft.category || "Auto-detect")}</div>
      </div>
    `)
    .join("");
}

function rowForInsert(payload) {
  return {
    ...payload,
    submitter_email: "",
    status: "submitted",
    mode: "existing",
  };
}

async function submitPayloads(payloads) {
  const rows = payloads.map(rowForInsert);
  setSync("Submitting");
  const { error } = await supabaseClient.from("apollo_corrections").insert(rows);
  if (error) throw error;
  setSync("Ready", true);
  showToast(rows.length === 1 ? "Correction submitted." : `${rows.length} corrections submitted.`, "success");
  await loadCorrections();
  return true;
}

function addToBatch() {
  const payload = formPayload();
  if (!hasContent(payload)) {
    showToast("Add correction details before adding to the batch.");
    return;
  }
  state.drafts.push(payload);
  clearCorrectionFields(true);
  renderBatch();
}

// ── QUEUE ─────────────────────────────────────────────────────────────────

function selectedCorrection() {
  return state.corrections.find((item) => item.id === state.selectedId) || null;
}

function renderQueue() {
  if (!state.corrections.length) {
    els.queueList.innerHTML = '<div class="queue-item muted">No corrections in this view.</div>';
    renderDetail();
    return;
  }

  els.queueList.innerHTML = state.corrections
    .map((item) => {
      const active = item.id === state.selectedId ? " active" : "";
      return `
        <button class="queue-item${active}" type="button" data-id="${escapeHtml(item.id)}">
          <div class="queue-title">
            <span>${escapeHtml(shortText(item.question || item.approved_answer))}</span>
            <span class="status-chip ${escapeHtml(item.status)}">${escapeHtml(statusLabel(item.status))}</span>
          </div>
          <div class="queue-subtitle">${escapeHtml(item.target_file || item.category || "Waiting for analysis")}</div>
        </button>
      `;
    })
    .join("");

  els.queueList.querySelectorAll(".queue-item").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedId = button.dataset.id;
      renderQueue();
      renderDetail();
    });
  });

  if (!selectedCorrection()) {
    state.selectedId = state.corrections[0]?.id || null;
    renderDetail();
  }
}

// ── ACTIVITY ──────────────────────────────────────────────────────────────

async function loadActivity() {
  const { data, error } = await supabaseClient
    .from("apollo_corrections")
    .select("id,status,updated_at,applied_at,target_file,question,github_commit_url,failure_reason,chatbase_synced,chatbase_synced_at")
    .in("status", ["applied", "failed", "rejected", "processing"])
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  renderActivity(data || []);
}

async function toggleChatbaseSync(id, checked) {
  const row = document.querySelector(`.activity-sync-row[data-id="${id}"]`);
  if (row) row.classList.add("saving");
  try {
    const update = checked
      ? { chatbase_synced: true, chatbase_synced_at: new Date().toISOString() }
      : { chatbase_synced: false, chatbase_synced_at: null };
    const { error } = await supabaseClient
      .from("apollo_corrections")
      .update(update)
      .eq("id", id);
    if (error) throw error;
    // Update chip without full reload
    const chip = document.querySelector(`.chatbase-sync-chip[data-id="${id}"]`);
    if (chip) {
      if (checked) {
        chip.className = "status-chip applied chatbase-sync-chip";
        chip.dataset.id = id;
        chip.textContent = "✓ Synced to Chatbase";
      } else {
        chip.className = "status-chip chatbase-sync-chip";
        chip.dataset.id = id;
        chip.textContent = "Not yet synced";
      }
    }
  } catch (err) {
    showToast(`Sync save failed: ${err.message}`);
    // Revert checkbox
    const cb = document.querySelector(`.chatbase-sync-cb[data-id="${id}"]`);
    if (cb) cb.checked = !checked;
  } finally {
    if (row) row.classList.remove("saving");
  }
}

function renderActivity(items) {
  if (!items.length) {
    els.activityList.innerHTML = '<div class="recent-item muted">No activity yet.</div>';
    return;
  }
  els.activityList.innerHTML = items
    .map((item) => {
      const isApplied = item.status === "applied";
      const synced = item.chatbase_synced === true;
      const syncedAt = item.chatbase_synced_at
        ? new Date(item.chatbase_synced_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
        : null;

      return `
        <div class="recent-item">
          <span class="recent-time">${escapeHtml(new Date(item.updated_at).toLocaleString())}</span>
          <strong>${escapeHtml(item.target_file || shortText(item.question, "No target file"))}</strong>
          <div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap">
            <span class="status-chip ${escapeHtml(item.status)}">${escapeHtml(statusLabel(item.status))}</span>
            <span class="status-chip ${synced ? "applied" : ""} chatbase-sync-chip" data-id="${escapeHtml(item.id)}">${synced ? `✓ Synced to Chatbase${syncedAt ? ` · ${syncedAt}` : ""}` : "Not yet synced"}</span>
            ${item.github_commit_url ? `<a href="${escapeHtml(item.github_commit_url)}" target="_blank" rel="noreferrer" class="commit-link" style="font-size:12px">View Commit →</a>` : ""}
          </div>
          ${isApplied ? `
            <div class="activity-sync-row" data-id="${escapeHtml(item.id)}">
              <label class="sync-checkbox-label">
                <input type="checkbox" class="chatbase-sync-cb" data-id="${escapeHtml(item.id)}" ${synced ? "checked" : ""} />
                <span>Mark as synced to Chatbase</span>
              </label>
            </div>
          ` : ""}
          ${item.failure_reason && item.status !== "rejected" ? `<span style="font-size:12px;color:var(--danger);margin-top:4px;display:block">${escapeHtml(item.failure_reason)}</span>` : ""}
          ${item.status === "rejected" && item.failure_reason ? `<span style="font-size:12px;color:var(--text-muted);margin-top:4px;display:block">Rejection reason: ${escapeHtml(item.failure_reason)}</span>` : ""}
        </div>
      `;
    })
    .join("");

  // Wire up checkboxes
  els.activityList.querySelectorAll(".chatbase-sync-cb").forEach((cb) => {
    cb.addEventListener("change", () => toggleChatbaseSync(cb.dataset.id, cb.checked));
  });
}

// ── DETAIL PANEL ──────────────────────────────────────────────────────────

function setMode(mode) {
  state.mode = mode;
  els.modeExisting.classList.toggle("active", mode === "existing");
  els.modeNew.classList.toggle("active", mode === "new");
  document.querySelector(".new-fields").classList.toggle("hidden", mode !== "new");
}

function renderDetail() {
  const item = selectedCorrection();
  if (!item) {
    els.emptyDetail.classList.remove("hidden");
    els.detailContent.classList.add("hidden");
    return;
  }

  els.emptyDetail.classList.add("hidden");
  els.detailContent.classList.remove("hidden");
  els.detailStatus.textContent = statusLabel(item.status);
  els.detailTitle.textContent = shortText(item.question || item.approved_answer, "Correction");
  els.targetFile.value = item.target_file || "";
  els.targetSection.value = item.target_section_heading || "";
  els.newTopic.value = item.new_topic || "";
  els.newPurpose.value = item.new_purpose || "";
  els.currentSection.value = item.current_section || "";
  els.proposedReplacement.value = item.proposed_replacement || item.approved_answer || "";
  setMode(item.mode || "existing");

  // Commit link
  els.commitLink.classList.toggle("hidden", !item.github_commit_url);
  if (item.github_commit_url) els.commitLink.href = item.github_commit_url;

  // Oasis warning
  const oasisMissing = item.analysis?.oasis_link_missing === true;
  els.oasisWarning.classList.toggle("hidden", !oasisMissing);

  // KB Editor reasoning
  const reasoning = item.analysis?.llm_reasoning || item.analysis?.reasoning;
  if (reasoning) {
    els.reasoningBlock.style.display = "flex";
    els.reasoningText.textContent = reasoning;
  } else {
    els.reasoningBlock.style.display = "none";
  }

  // Multi-target vs single-target diff
  const targets = item.targets;
  const isMultiTarget = Array.isArray(targets) && targets.length > 1;
  const singleTargetArea = document.getElementById("singleTargetArea");
  const multiTargetArea = document.getElementById("multiTargetArea");
  if (singleTargetArea) singleTargetArea.classList.toggle("hidden", isMultiTarget);
  if (multiTargetArea) multiTargetArea.classList.toggle("hidden", !isMultiTarget);
  if (isMultiTarget) {
    renderTargetCards(targets);
    els.openConfirm.textContent = `Approve Files →`;
  } else {
    els.openConfirm.textContent = `Approve Update →`;
  }

  // Reject note row — show when reviewing, hide when already rejected
  const isRejected = item.status === "rejected";
  els.rejectNoteRow.classList.toggle("hidden", isRejected);
  els.rejectBtn.classList.toggle("hidden", isRejected);

  // Resubmit — only show on rejected items
  els.resubmitBtn.classList.toggle("hidden", !isRejected);
  if (isRejected && item.failure_reason) {
    els.rejectNote.value = item.failure_reason;
  } else {
    els.rejectNote.value = "";
  }

  // Applied actions — download + copy for chatbase
  const isApplied = item.status === "applied";
  const appliedRow = document.getElementById("copyForChatbaseRow");
  if (appliedRow) appliedRow.classList.toggle("hidden", !isApplied);

  // Button states
  const canApprove = ["analysis_ready", "needs_review", "failed"].includes(item.status);
  const canReject = ["analysis_ready", "needs_review", "submitted", "failed"].includes(item.status);
  els.openConfirm.disabled = !canApprove;
  els.openConfirm.classList.toggle("hidden", isRejected || isApplied);
  els.rejectBtn.disabled = !canReject;
  els.saveDraft.disabled = isRejected || isApplied;
}

// ── MULTI-TARGET REVIEW ───────────────────────────────────────────────────

function renderTargetCards(targets) {
  const container = document.getElementById("targetCardList");
  const countEl = document.getElementById("multiTargetCount");
  if (!container) return;
  if (countEl) countEl.textContent = `${targets.length} files`;

  container.innerHTML = targets.map((t, i) => {
    const conf = t.confidence || "Low";
    const confClass = conf === "High" ? "applied" : conf === "Medium" ? "approved" : "needs_review";
    const isIncluded = t.status !== "skipped";
    const fname = (t.file || "").replace(/.*\//, "");
    return `
      <div class="target-card" data-index="${i}">
        <div class="target-card-header">
          <label class="target-include-label">
            <input type="checkbox" class="target-checkbox" data-index="${i}" ${isIncluded ? "checked" : ""} />
            <span class="target-filename">${escapeHtml(fname)}</span>
          </label>
          <span class="status-chip ${confClass}">${escapeHtml(conf)}</span>
        </div>
        ${t.section_heading ? `<div class="target-section-name">${escapeHtml(t.section_heading)}</div>` : ""}
        ${t.reasoning ? `<div class="target-reasoning">${escapeHtml(t.reasoning)}</div>` : ""}
        <details class="target-diff-toggle">
          <summary>View / edit diff</summary>
          <div class="diff-grid" style="margin-top:10px">
            <div class="field">
              <span class="label" style="display:block;margin-bottom:4px">Current</span>
              <pre class="diff-box readonly-diff">${escapeHtml(t.current_section || "(no content)")}</pre>
            </div>
            <div class="field">
              <span class="label" style="display:block;margin-bottom:4px">Proposed — edit if needed</span>
              <textarea class="diff-box editable-diff" data-target-index="${i}" rows="10">${escapeHtml(t.proposed_replacement || "")}</textarea>
            </div>
          </div>
        </details>
      </div>
    `;
  }).join("");

  updateMultiTargetApproveCount(targets);

  container.querySelectorAll(".target-checkbox").forEach((cb) => {
    cb.addEventListener("change", () => updateMultiTargetApproveCount(targets));
  });
}

function updateMultiTargetApproveCount(targets) {
  const checked = document.querySelectorAll(".target-checkbox:checked").length;
  if (els.openConfirm) {
    els.openConfirm.textContent = `Approve ${checked} of ${targets.length} Files →`;
    els.openConfirm.disabled = checked === 0;
  }
}

async function saveMultiTargetApproval(updatedTargets) {
  const item = selectedCorrection();
  if (!item) return;
  setSync("Saving");
  const { error } = await supabaseClient
    .from("apollo_corrections")
    .update({ targets: updatedTargets, status: "approved" })
    .eq("id", item.id);
  if (error) throw error;
  setSync("Ready", true);
  const count = updatedTargets.filter((t) => t.status === "approved").length;
  showToast(`${count} file${count > 1 ? "s" : ""} approved — automation will apply shortly.`, "success");
  await loadCorrections();
}

// ── PATCH NOTES ───────────────────────────────────────────────────────────

async function downloadPatchNotes() {
  const btn = document.getElementById("patchNotesBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Generating…"; }
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabaseClient
      .from("apollo_corrections")
      .select("*")
      .eq("status", "applied")
      .gte("applied_at", since)
      .order("applied_at", { ascending: true });
    if (error) throw error;
    if (!data || data.length === 0) {
      showToast("No corrections applied in the last 7 days.");
      return;
    }
    const { data: fnData, error: fnError } = await supabaseClient.functions.invoke("generate-patch-notes", {
      body: { corrections: data },
    });
    if (fnError) throw fnError;
    if (!fnData || !fnData.ok) throw new Error((fnData && fnData.error) || "Patch notes generation failed.");
    const date = new Date().toISOString().slice(0, 10);
    triggerDownload(fnData.patch_notes || "", `Apollo_Patch_Notes_${date}.txt`);
    showToast("Patch notes downloaded!", "success");
  } catch (err) {
    showToast(`Patch notes error: ${err.message}`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Download Patch Notes (Last 7 Days)"; }
  }
}

// ── LOAD ──────────────────────────────────────────────────────────────────

async function loadCorrections() {
  setSync("Loading");
  const statuses = els.statusFilter.value.split(",");
  const { data, error } = await supabaseClient
    .from("apollo_corrections")
    .select("*")
    .in("status", statuses)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  state.corrections = data || [];
  renderQueue();
  setSync("Ready", true);
}

// ── AUTOMATION ────────────────────────────────────────────────────────────

async function runAutomationNow() {
  setSync("Triggering");
  els.runAutomation.disabled = true;
  try {
    const { data, error } = await supabaseClient.functions.invoke("run-kb-automation", {
      body: { source: "apollo-portal" },
    });
    if (error) throw error;
    if (data && data.ok === false) throw new Error(data.error || "Automation trigger failed.");
    setSync("Queued");
    showToast("KB automation queued. Refresh in a minute or two.", "success");
  } finally {
    window.setTimeout(() => {
      els.runAutomation.disabled = false;
      setSync("Ready", true);
    }, 2500);
  }
}

// ── SAVE / APPROVE ────────────────────────────────────────────────────────

async function saveSelected(statusOverride = null) {
  const item = selectedCorrection();
  if (!item) return;
  const update = {
    mode: state.mode,
    target_file: els.targetFile.value.trim() || null,
    target_section_heading: els.targetSection.value.trim() || null,
    current_section: els.currentSection.value,
    proposed_replacement: els.proposedReplacement.value.trim(),
    new_topic: els.newTopic.value.trim(),
    new_purpose: els.newPurpose.value.trim(),
  };
  if (statusOverride) update.status = statusOverride;

  setSync("Saving");
  const { error } = await supabaseClient.from("apollo_corrections").update(update).eq("id", item.id);
  if (error) throw error;
  setSync("Ready", true);
  showToast(statusOverride === "approved" ? "Correction approved — automation will apply it shortly." : "Draft saved.", "success");
  await loadCorrections();
}

function openConfirm() {
  const item = selectedCorrection();
  if (!item) return;

  const targets = item.targets;
  const isMultiTarget = Array.isArray(targets) && targets.length > 1;

  if (isMultiTarget) {
    // Build updated targets from current checkbox + textarea state
    const updatedTargets = targets.map((t, i) => {
      const checkbox = document.querySelector(`.target-checkbox[data-index="${i}"]`);
      const textarea = document.querySelector(`[data-target-index="${i}"]`);
      return {
        ...t,
        proposed_replacement: textarea ? textarea.value.trim() : t.proposed_replacement,
        status: checkbox && checkbox.checked ? "approved" : "skipped",
      };
    });
    const approvedCount = updatedTargets.filter((t) => t.status === "approved").length;
    if (approvedCount === 0) {
      showToast("Select at least one file to approve.");
      return;
    }
    state.pendingMultiTargets = updatedTargets;
    els.confirmText.textContent = `This will queue ${approvedCount} file update${approvedCount > 1 ? "s" : ""}. GitHub Actions will apply all changes in one commit.`;
  } else {
    if (!els.proposedReplacement.value.trim()) {
      showToast("Add proposed replacement guidance before approving.");
      return;
    }
    if (state.mode === "existing" && (!els.targetFile.value.trim() || !els.targetSection.value.trim())) {
      showToast("Existing file updates need a target file and section heading.");
      return;
    }
    state.pendingMultiTargets = null;
    const target = state.mode === "new"
      ? "a new KB file"
      : `${els.targetFile.value.trim()} — ${els.targetSection.value.trim()}`;
    els.confirmText.textContent = `This will mark the correction approved. GitHub Actions will update ${target} and commit the changed KB file.`;
  }

  els.reviewedCheck.checked = false;
  els.confirmApprove.disabled = true;
  els.confirmLayer.classList.remove("hidden");
}

// ── REJECT ────────────────────────────────────────────────────────────────

async function rejectSelected() {
  const item = selectedCorrection();
  if (!item) return;
  const note = els.rejectNote.value.trim() || "Rejected by reviewer.";
  setSync("Saving");
  const { error } = await supabaseClient
    .from("apollo_corrections")
    .update({ status: "rejected", failure_reason: note })
    .eq("id", item.id);
  if (error) throw error;
  setSync("Ready", true);
  showToast("Correction rejected and archived.");
  await loadCorrections();
}

// ── RESUBMIT ──────────────────────────────────────────────────────────────

function resubmitSelected() {
  const item = selectedCorrection();
  if (!item) return;
  // Pre-fill the submission form with original data
  els.question.value = item.question || "";
  els.wrongAnswer.value = item.wrong_answer || "";
  els.approvedAnswer.value = "";
  els.oasisLink.value = item.oasis_link || "";
  els.category.value = item.category || "";
  els.reviewerNotes.value = `Resubmission of rejected correction (ID: ${item.id}). Original rejection reason: ${item.failure_reason || "none"}`;
  // Switch to submit tab and focus on approved answer
  switchToView("submit");
  els.approvedAnswer.focus();
  showToast("Form pre-filled from rejected correction — add your updated guidance and resubmit.");
}

// ── COPY FOR CHATBASE ─────────────────────────────────────────────────────

async function copyForChatbase() {
  const item = selectedCorrection();
  if (!item?.target_file) {
    showToast("No target file found for this correction.");
    return;
  }
  els.copyForChatbase.disabled = true;
  els.copyForChatbase.textContent = "Fetching file…";
  try {
    const url = `${GITHUB_RAW_BASE}${item.target_file}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    const text = result.value.trim();
    if (!text) throw new Error("Extracted text was empty — file may not be readable.");
    await navigator.clipboard.writeText(text);
    showToast(`Copied full file (${item.target_file.split("/").pop()}) to clipboard — paste into Chatbase.`, "success");
  } catch (err) {
    showToast(`Could not copy file: ${err.message}`);
  } finally {
    els.copyForChatbase.disabled = false;
    els.copyForChatbase.textContent = "Copy for Chatbase";
  }
}

// ── DOWNLOAD FILE (single correction's full source file) ──────────────────

async function downloadUpdatedFile() {
  const item = selectedCorrection();
  if (!item?.target_file) {
    showToast("No target file found for this correction.");
    return;
  }
  els.downloadFile.disabled = true;
  els.downloadFile.textContent = "Fetching file…";
  try {
    const url = `${GITHUB_RAW_BASE}${item.target_file}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    const text = result.value.trim();
    if (!text) throw new Error("Extracted text was empty.");
    const filename = item.target_file.split("/").pop().replace(/\.docx$/i, ".txt");
    triggerDownload(text, filename);
    showToast(`Downloaded ${filename}.`, "success");
  } catch (err) {
    showToast(`Download failed: ${err.message}`);
  } finally {
    els.downloadFile.disabled = false;
    els.downloadFile.textContent = "Download File";
  }
}

// ── KB EXPORT HELPERS ─────────────────────────────────────────────────────

function triggerDownload(text, filename) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function triggerBlobDownload(blob, filename) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function setExportProgress(current, total, label) {
  const el = document.getElementById("exportProgress");
  const fill = document.getElementById("exportProgressFill");
  const lbl = document.getElementById("exportProgressLabel");
  if (!el) return;
  el.classList.toggle("hidden", total === 0);
  if (total > 0) {
    fill.style.width = `${Math.round((current / total) * 100)}%`;
    lbl.textContent = label;
  }
}

async function getKBFileList() {
  const response = await fetch(
    "https://api.github.com/repos/prismo1020/apollo-kb-tool/git/trees/main?recursive=1"
  );
  if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
  const data = await response.json();
  return data.tree
    .filter((f) =>
      f.type === "blob" &&
      f.path.endsWith(".docx") &&
      !f.path.includes("/") &&
      !f.path.startsWith("~$")
    )
    .map((f) => f.path)
    .sort();
}

async function fetchExtractBatch(paths, batchSize, onProgress) {
  const results = [];
  for (let i = 0; i < paths.length; i += batchSize) {
    const batch = paths.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (path) => {
        try {
          const url = `${GITHUB_RAW_BASE}${path}`;
          const resp = await fetch(url);
          if (!resp.ok) return { path, text: null, error: `HTTP ${resp.status}` };
          const arrayBuffer = await resp.arrayBuffer();
          const extracted = await mammoth.extractRawText({ arrayBuffer });
          return { path, text: extracted.value.trim(), error: null };
        } catch (err) {
          return { path, text: null, error: err.message };
        }
      })
    );
    results.push(...batchResults);
    onProgress(results.length, paths.length);
  }
  return results;
}

// ── DOWNLOAD FULL KB AS ZIP ───────────────────────────────────────────────

async function downloadKBZip() {
  const btn = document.getElementById("downloadKBZip");
  btn.disabled = true;
  btn.textContent = "Preparing…";
  try {
    setExportProgress(0, 1, "Fetching file list from GitHub…");
    const files = await getKBFileList();
    const zip = new JSZip();
    const folder = zip.folder("Apollo_KB");
    const results = await fetchExtractBatch(files, 8, (done, total) => {
      setExportProgress(done, total, `Extracting ${done} of ${total} files…`);
    });

    let extracted = 0;
    let failed = 0;
    for (const { path, text, error } of results) {
      const name = path.replace(/\.docx$/i, ".txt");
      if (text) {
        folder.file(name, text);
        extracted++;
      } else {
        folder.file(name + ".ERROR.txt", `Could not extract: ${error}`);
        failed++;
      }
    }

    setExportProgress(1, 1, "Building ZIP…");
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    const date = new Date().toISOString().slice(0, 10);
    triggerBlobDownload(blob, `Apollo_KB_${date}.zip`);
    setExportProgress(0, 0, "");
    showToast(`Downloaded ZIP with ${extracted} KB files${failed ? ` (${failed} failed)` : ""}.`, "success");
  } catch (err) {
    setExportProgress(0, 0, "");
    showToast(`ZIP export failed: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "Download Full KB (ZIP)";
  }
}

// ── DOWNLOAD MERGED KB (single .txt) ─────────────────────────────────────

async function downloadKBMerged() {
  const btn = document.getElementById("downloadKBMerged");
  btn.disabled = true;
  btn.textContent = "Preparing…";
  try {
    setExportProgress(0, 1, "Fetching file list from GitHub…");
    const files = await getKBFileList();
    const results = await fetchExtractBatch(files, 8, (done, total) => {
      setExportProgress(done, total, `Extracting ${done} of ${total} files…`);
    });

    const divider = "=".repeat(80);
    const sections = results
      .filter(({ text }) => text)
      .map(({ path, text }) => `${divider}\nFILE: ${path}\n${divider}\n\n${text}`);

    const merged = sections.join("\n\n\n");
    const date = new Date().toISOString().slice(0, 10);
    triggerDownload(merged, `Apollo_KB_Merged_${date}.txt`);
    setExportProgress(0, 0, "");
    const failed = results.filter((r) => !r.text).length;
    showToast(`Downloaded merged KB (${sections.length} files${failed ? `, ${failed} failed` : ""}).`, "success");
  } catch (err) {
    setExportProgress(0, 0, "");
    showToast(`Merged export failed: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "Download Merged KB (single file)";
  }
}

// ── EVENT LISTENERS ───────────────────────────────────────────────────────

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => {
    switchToView(button.dataset.view);
    if (button.dataset.view === "activity") {
      loadActivity().catch((err) => showToast(err.message));
    }
  });
});

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const payload = formPayload();
    if (!hasContent(payload)) {
      showToast("Add a question, wrong answer, or approved guidance first.");
      return;
    }
    const submitted = await submitPayloads([payload]);
    if (submitted) clearCorrectionFields(true);
  } catch (error) {
    setSync("Ready", true);
    showToast(error.message);
  }
});

els.addToBatch.addEventListener("click", addToBatch);
els.submitBatch.addEventListener("click", async () => {
  try {
    const submitted = await submitPayloads(state.drafts);
    if (submitted) { state.drafts = []; renderBatch(); }
  } catch (error) {
    setSync("Ready", true);
    showToast(error.message);
  }
});
els.clearBatch.addEventListener("click", () => { state.drafts = []; renderBatch(); });
els.clearForm.addEventListener("click", () => clearCorrectionFields(false));
els.runAutomation.addEventListener("click", () => {
  runAutomationNow().catch((error) => {
    els.runAutomation.disabled = false;
    setSync("Ready", true);
    showToast(error.message);
  });
});
els.refreshQueue.addEventListener("click", () => loadCorrections().catch((error) => showToast(error.message)));
els.statusFilter.addEventListener("change", () => loadCorrections().catch((error) => showToast(error.message)));
els.modeExisting.addEventListener("click", () => setMode("existing"));
els.modeNew.addEventListener("click", () => setMode("new"));
els.saveDraft.addEventListener("click", () => saveSelected().catch((error) => showToast(error.message)));
els.openConfirm.addEventListener("click", openConfirm);
els.cancelConfirm.addEventListener("click", () => els.confirmLayer.classList.add("hidden"));
els.reviewedCheck.addEventListener("change", () => { els.confirmApprove.disabled = !els.reviewedCheck.checked; });
els.confirmApprove.addEventListener("click", () => {
  if (state.pendingMultiTargets) {
    saveMultiTargetApproval(state.pendingMultiTargets)
      .then(() => { state.pendingMultiTargets = null; els.confirmLayer.classList.add("hidden"); })
      .catch((error) => showToast(error.message));
  } else {
    saveSelected("approved")
      .then(() => els.confirmLayer.classList.add("hidden"))
      .catch((error) => showToast(error.message));
  }
});
els.rejectBtn.addEventListener("click", () => rejectSelected().catch((error) => showToast(error.message)));
els.resubmitBtn.addEventListener("click", resubmitSelected);
els.copyForChatbase.addEventListener("click", () => copyForChatbase().catch((error) => showToast(error.message)));
els.downloadFile.addEventListener("click", () => downloadUpdatedFile().catch((err) => showToast(err.message)));
document.getElementById("downloadKBZip").addEventListener("click", () => downloadKBZip().catch((err) => showToast(err.message)));
document.getElementById("downloadKBMerged").addEventListener("click", () => downloadKBMerged().catch((err) => showToast(err.message)));
document.getElementById("patchNotesBtn").addEventListener("click", () => downloadPatchNotes().catch((err) => showToast(err.message)));

// ── LAST EDITED DATE ──────────────────────────────────────────────────────

async function loadLastEdited() {
  try {
    const response = await fetch(
      "https://api.github.com/repos/prismo1020/apollo-kb-tool/commits/main?per_page=1"
    );
    if (!response.ok) return;
    const data = await response.json();
    const date = new Date(data.commit?.committer?.date || data.commit?.author?.date);
    if (isNaN(date)) return;
    const formatted = date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const el = document.getElementById("lastEditedLabel");
    if (el) el.textContent = `Last edited by Danielle Beram · ${formatted}`;
  } catch {
    // silently fail — label stays as static text
  }
}

// ── INIT ──────────────────────────────────────────────────────────────────

renderBatch();
loadLastEdited();
loadCorrections().catch((error) => {
  setSync("Needs attention");
  showToast(error.message);
});
