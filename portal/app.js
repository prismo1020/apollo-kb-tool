const config = window.APOLLO_CONFIG || {};
const supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);

const GITHUB_RAW_BASE = "https://raw.githubusercontent.com/prismo1020/apollo-kb-tool/main/";
const MAINTENANCE_STORAGE_KEY = "apolloWeeklyMaintenance";
const MAINTENANCE_TASKS = [
  {
    key: "review_queue",
    label: "Review the correction queue",
    detail: "Clear anything marked analysis ready or needs review, and note anything waiting on clarification.",
  },
  {
    key: "check_failures",
    label: "Check for failed or stuck automation",
    detail: "Look for failed, processing, or approved items that need manual follow-up.",
  },
  {
    key: "drive_backup",
    label: "Confirm Google Drive backup",
    detail: "Make sure applied KB files have been downloaded and uploaded to the Drive backup folder.",
  },
  {
    key: "chatbase_sync",
    label: "Confirm Chatbase retraining",
    detail: "Replace updated files in Chatbase, retrain Apollo, and mark the Activity Log sync checkbox.",
  },
  {
    key: "patch_notes",
    label: "Generate weekly patch notes when needed",
    detail: "Download patch notes for the last 7 days if any corrections were applied this week.",
  },
];

const state = {
  drafts: [],
  corrections: [],
  maintenanceRecords: [],
  maintenanceLogSource: "browser",
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
  // Create KB File
  createFileForm: document.getElementById("createFileForm"),
  cfTopic: document.getElementById("cfTopic"),
  cfCategory: document.getElementById("cfCategory"),
  cfReviewer: document.getElementById("cfReviewer"),
  cfDescription: document.getElementById("cfDescription"),
  cfOasisLink: document.getElementById("cfOasisLink"),
  cfClear: document.getElementById("cfClear"),
  cfFilenamePreview: document.getElementById("cfFilenamePreview"),
  fileCreationBanner: document.getElementById("fileCreationBanner"),
  fcFilename: document.getElementById("fcFilename"),
  fcRelatedChips: document.getElementById("fcRelatedChips"),
  fcRelatedWrap: document.getElementById("fcRelatedWrap"),
  maintenanceChecklist: document.getElementById("maintenanceChecklist"),
  maintenanceSummary: document.getElementById("maintenanceSummary"),
  maintenanceLog: document.getElementById("maintenanceLog"),
  maintenanceCompletedBy: document.getElementById("maintenanceCompletedBy"),
  maintenanceWeekInput: document.getElementById("maintenanceWeekInput"),
  maintenanceNotes: document.getElementById("maintenanceNotes"),
  maintenanceWeekStatus: document.getElementById("maintenanceWeekStatus"),
  maintenanceWeekLabel: document.getElementById("maintenanceWeekLabel"),
  maintenanceLastDone: document.getElementById("maintenanceLastDone"),
  maintenanceSaveHint: document.getElementById("maintenanceSaveHint"),
  confirmMaintenance: document.getElementById("confirmMaintenance"),
  refreshMaintenance: document.getElementById("refreshMaintenance"),
};

// â”€â”€ UTILS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€ FORM â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€ BATCH â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€ CREATE KB FILE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function updateCfFilenamePreview() {
  const topic = (els.cfTopic.value || "").trim().toUpperCase();
  const category = (els.cfCategory.value || "").trim().toUpperCase() || "TECH";
  const slug = topic.replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  if (!els.cfFilenamePreview) return;
  if (slug) {
    els.cfFilenamePreview.textContent = `â†’ Will be saved as: _???_${category}__${slug}.docx`;
    els.cfFilenamePreview.classList.add("has-preview");
  } else {
    els.cfFilenamePreview.textContent = "";
    els.cfFilenamePreview.classList.remove("has-preview");
  }
}

function clearCreateFileForm() {
  els.cfTopic.value = "";
  els.cfCategory.value = "";
  els.cfReviewer.value = "";
  els.cfDescription.value = "";
  els.cfOasisLink.value = "";
  updateCfFilenamePreview();
}

async function submitCreateFile() {
  const topic = els.cfTopic.value.trim();
  const category = els.cfCategory.value.trim();
  const description = els.cfDescription.value.trim();
  if (!topic) { showToast("Add a file topic â€” it becomes the filename."); els.cfTopic.focus(); return; }
  if (!category) { showToast("Pick a category."); els.cfCategory.focus(); return; }
  if (!description) { showToast("Describe what the file should cover."); els.cfDescription.focus(); return; }

  const row = {
    request_type: "file_creation",
    status: "submitted",
    mode: "new",
    new_topic: topic,
    category,
    new_purpose: description,
    oasis_link: els.cfOasisLink.value.trim(),
    reviewer_label: els.cfReviewer.value.trim(),
    // reuse the question field so it renders nicely in the queue list
    question: `New KB file: ${topic}`,
  };

  setSync("Submitting");
  const { error } = await supabaseClient.from("apollo_corrections").insert([row]);
  if (error) throw error;
  setSync("Ready", true);
  showToast("New file request submitted â€” the AI will draft it shortly.", "success");
  clearCreateFileForm();
  await loadCorrections();
}

// â”€â”€ QUEUE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€ ACTIVITY â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function loadActivity() {
  const { data, error } = await supabaseClient
    .from("apollo_corrections")
    .select("id,status,updated_at,applied_at,target_file,question,github_commit_url,failure_reason,chatbase_synced,chatbase_synced_at,gdrive_synced,gdrive_synced_at")
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
    const { error } = await supabaseClient.from("apollo_corrections").update(update).eq("id", id);
    if (error) throw error;
    const chip = document.querySelector(`.chatbase-sync-chip[data-id="${id}"]`);
    if (chip) {
      chip.className = `status-chip ${checked ? "applied" : ""} chatbase-sync-chip`;
      chip.dataset.id = id;
      chip.textContent = checked ? "âœ“ Synced to Chatbase" : "Not synced to Chatbase";
    }
  } catch (err) {
    showToast(`Sync save failed: ${err.message}`);
    const cb = document.querySelector(`.chatbase-sync-cb[data-id="${id}"]`);
    if (cb) cb.checked = !checked;
  } finally {
    if (row) row.classList.remove("saving");
  }
}

async function toggleGdriveSync(id, checked) {
  const row = document.querySelector(`.activity-sync-row[data-id="${id}"]`);
  if (row) row.classList.add("saving");
  try {
    const update = checked
      ? { gdrive_synced: true, gdrive_synced_at: new Date().toISOString() }
      : { gdrive_synced: false, gdrive_synced_at: null };
    const { error } = await supabaseClient.from("apollo_corrections").update(update).eq("id", id);
    if (error) throw error;
    const chip = document.querySelector(`.gdrive-sync-chip[data-id="${id}"]`);
    if (chip) {
      chip.className = `status-chip ${checked ? "applied" : ""} gdrive-sync-chip`;
      chip.dataset.id = id;
      chip.textContent = checked ? "âœ“ Synced to Drive" : "Not synced to Drive";
    }
  } catch (err) {
    showToast(`Sync save failed: ${err.message}`);
    const cb = document.querySelector(`.gdrive-sync-cb[data-id="${id}"]`);
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
      const cbSynced = item.chatbase_synced === true;
      const cbSyncedAt = item.chatbase_synced_at
        ? new Date(item.chatbase_synced_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
        : null;
      const gdSynced = item.gdrive_synced === true;
      const gdSyncedAt = item.gdrive_synced_at
        ? new Date(item.gdrive_synced_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
        : null;

      return `
        <div class="recent-item">
          <span class="recent-time">${escapeHtml(new Date(item.updated_at).toLocaleString())}</span>
          <strong>${escapeHtml(item.target_file || shortText(item.question, "No target file"))}</strong>
          <div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap">
            <span class="status-chip ${escapeHtml(item.sta…8725 tokens truncated…â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€ RESUBMIT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  showToast("Form pre-filled from rejected correction â€” add your updated guidance and resubmit.");
}

// â”€â”€ COPY FOR CHATBASE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function copyForChatbase() {
  const item = selectedCorrection();
  if (!item?.target_file) {
    showToast("No target file found for this correction.");
    return;
  }
  els.copyForChatbase.disabled = true;
  els.copyForChatbase.textContent = "Fetching fileâ€¦";
  try {
    const url = `${GITHUB_RAW_BASE}${item.target_file}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    const text = result.value.trim();
    if (!text) throw new Error("Extracted text was empty â€” file may not be readable.");
    await navigator.clipboard.writeText(text);
    showToast(`Copied full file (${item.target_file.split("/").pop()}) to clipboard â€” paste into Chatbase.`, "success");
  } catch (err) {
    showToast(`Could not copy file: ${err.message}`);
  } finally {
    els.copyForChatbase.disabled = false;
    els.copyForChatbase.textContent = "Copy for Chatbase";
  }
}

// â”€â”€ DOWNLOAD FILE (single correction's full source file) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function downloadUpdatedFile() {
  const item = selectedCorrection();
  if (!item?.target_file) {
    showToast("No target file found for this correction.");
    return;
  }
  els.downloadFile.disabled = true;
  els.downloadFile.textContent = "Fetching fileâ€¦";
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

// â”€â”€ SINGLE FILE DOWNLOAD / COPY (from Activity tab) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function downloadFileByPath(filePath, btn) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Fetchingâ€¦";
  try {
    const resp = await fetch(`${GITHUB_RAW_BASE}${filePath}`);
    if (!resp.ok) throw new Error(`GitHub returned ${resp.status}`);
    const arrayBuffer = await resp.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    const text = result.value.trim();
    if (!text) throw new Error("File appears empty.");
    const filename = filePath.split("/").pop().replace(/\.docx$/i, ".txt");
    triggerDownload(text, filename);
    showToast(`Downloaded ${filename}.`, "success");
  } catch (err) {
    showToast(`Download failed: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

async function copyFileByPath(filePath, btn) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Copyingâ€¦";
  try {
    const resp = await fetch(`${GITHUB_RAW_BASE}${filePath}`);
    if (!resp.ok) throw new Error(`GitHub returned ${resp.status}`);
    const arrayBuffer = await resp.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    const text = result.value.trim();
    if (!text) throw new Error("File appears empty.");
    await navigator.clipboard.writeText(text);
    showToast(`Copied ${filePath.split("/").pop()} to clipboard.`, "success");
  } catch (err) {
    showToast(`Copy failed: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

// â”€â”€ KB EXPORT HELPERS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€ DOWNLOAD FULL KB AS ZIP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function downloadKBZip() {
  const btn = document.getElementById("downloadKBZip");
  btn.disabled = true;
  btn.textContent = "Preparingâ€¦";
  try {
    setExportProgress(0, 1, "Fetching file list from GitHubâ€¦");
    const files = await getKBFileList();
    const zip = new JSZip();
    const folder = zip.folder("Apollo_KB");
    const results = await fetchExtractBatch(files, 8, (done, total) => {
      setExportProgress(done, total, `Extracting ${done} of ${total} filesâ€¦`);
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

    setExportProgress(1, 1, "Building ZIPâ€¦");
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

// â”€â”€ DOWNLOAD MERGED KB (single .txt) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function downloadKBMerged() {
  const btn = document.getElementById("downloadKBMerged");
  btn.disabled = true;
  btn.textContent = "Preparingâ€¦";
  try {
    setExportProgress(0, 1, "Fetching file list from GitHubâ€¦");
    const files = await getKBFileList();
    const results = await fetchExtractBatch(files, 8, (done, total) => {
      setExportProgress(done, total, `Extracting ${done} of ${total} filesâ€¦`);
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

// â”€â”€ EVENT LISTENERS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => {
    switchToView(button.dataset.view);
    if (button.dataset.view === "activity") {
      loadActivity().catch((err) => showToast(err.message));
    }
    if (button.dataset.view === "maintenance") {
      loadMaintenance().catch((err) => showToast(err.message));
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

els.createFileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await submitCreateFile();
  } catch (error) {
    setSync("Ready", true);
    showToast(error.message);
  }
});
els.cfClear.addEventListener("click", clearCreateFileForm);
els.cfTopic.addEventListener("input", updateCfFilenamePreview);
els.cfCategory.addEventListener("change", updateCfFilenamePreview);

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
els.newTopic.addEventListener("input", updateFilenamePreview);
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
els.confirmMaintenance.addEventListener("click", () => confirmWeeklyMaintenance().catch((err) => showToast(err.message)));
els.refreshMaintenance.addEventListener("click", () => loadMaintenance().catch((err) => showToast(err.message)));
els.maintenanceCompletedBy.addEventListener("input", persistMaintenanceDraft);
els.maintenanceNotes.addEventListener("input", persistMaintenanceDraft);

// â”€â”€ LAST EDITED DATE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    if (el) el.textContent = `Last edited by Danielle Beram Â· ${formatted}`;
  } catch {
    // silently fail â€” label stays as static text
  }
}

// â”€â”€ INIT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

renderBatch();
renderMaintenanceChecklist();
renderMaintenanceWeekStatus(readMaintenanceStore().records || []);
loadLastEdited();
loadCorrections().catch((error) => {
  setSync("Needs attention");
  showToast(error.message);
});

