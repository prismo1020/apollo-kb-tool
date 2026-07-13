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

// ── CREATE KB FILE ────────────────────────────────────────────────────────

function updateCfFilenamePreview() {
  const topic = (els.cfTopic.value || "").trim().toUpperCase();
  const category = (els.cfCategory.value || "").trim().toUpperCase() || "TECH";
  const slug = topic.replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  if (!els.cfFilenamePreview) return;
  if (slug) {
    els.cfFilenamePreview.textContent = `→ Will be saved as: _???_${category}__${slug}.docx`;
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
  if (!topic) { showToast("Add a file topic — it becomes the filename."); els.cfTopic.focus(); return; }
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
  showToast("New file request submitted — the AI will draft it shortly.", "success");
  clearCreateFileForm();
  await loadCorrections();
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
    .select("id,status,updated_at,applied_at,target_file,question,github_commit_url,failure_reason,targets,chatbase_synced,chatbase_synced_at,gdrive_synced,gdrive_synced_at")
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
      chip.textContent = checked ? "✓ Synced to Chatbase" : "Not synced to Chatbase";
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
      chip.textContent = checked ? "✓ Synced to Drive" : "Not synced to Drive";
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

  // Expand multi-file corrections to show each applied target file
  const expandedItems = [];
  for (const item of items) {
    const isMultiFile = Array.isArray(item.targets) && item.targets.length > 1;
    if (isMultiFile && item.status === "applied") {
      // Show each approved target as a separate row
      const approvedTargets = item.targets.filter(t => t.status === "approved");
      for (const target of approvedTargets) {
        expandedItems.push({ ...item, target_file: target.file, _isExpandedMultiFile: true });
      }
    } else {
      // Single file or not yet applied
      expandedItems.push(item);
    }
  }

  els.activityList.innerHTML = expandedItems
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
            <span class="status-chip ${escapeHtml(item.status)}">${escapeHtml(statusLabel(item.status))}</span>
            <span class="status-chip ${gdSynced ? "applied" : ""} gdrive-sync-chip" data-id="${escapeHtml(item.id)}">${gdSynced ? `✓ Synced to Drive${gdSyncedAt ? ` · ${gdSyncedAt}` : ""}` : "Not synced to Drive"}</span>
            <span class="status-chip ${cbSynced ? "applied" : ""} chatbase-sync-chip" data-id="${escapeHtml(item.id)}">${cbSynced ? `✓ Synced to Chatbase${cbSyncedAt ? ` · ${cbSyncedAt}` : ""}` : "Not synced to Chatbase"}</span>
            ${item.github_commit_url ? `<a href="${escapeHtml(item.github_commit_url)}" target="_blank" rel="noreferrer" class="commit-link" style="font-size:12px">View Commit →</a>` : ""}
          </div>
          ${isApplied && item.target_file ? `
            <div class="activity-sync-row" data-id="${escapeHtml(item.id)}">
              <div class="button-row" style="margin-bottom:10px">
                <button class="button secondary compact activity-dl-btn" data-file="${escapeHtml(item.target_file)}" type="button">Download .txt</button>
                <button class="button quiet compact activity-copy-btn" data-file="${escapeHtml(item.target_file)}" type="button">Copy for Chatbase</button>
              </div>
              <label class="sync-checkbox-label">
                <input type="checkbox" class="gdrive-sync-cb" data-id="${escapeHtml(item.id)}" ${gdSynced ? "checked" : ""} />
                <span>Synced to Google Drive backup</span>
              </label>
              <label class="sync-checkbox-label" style="margin-top:6px">
                <input type="checkbox" class="chatbase-sync-cb" data-id="${escapeHtml(item.id)}" ${cbSynced ? "checked" : ""} />
                <span>Synced to Chatbase</span>
              </label>
            </div>
          ` : ""}
          ${item.failure_reason && item.status !== "rejected" ? `<span style="font-size:12px;color:var(--danger);margin-top:4px;display:block">${escapeHtml(item.failure_reason)}</span>` : ""}
          ${item.status === "rejected" && item.failure_reason ? `<span style="font-size:12px;color:var(--text-muted);margin-top:4px;display:block">Rejection reason: ${escapeHtml(item.failure_reason)}</span>` : ""}
        </div>
      `;
    })
    .join("");

  els.activityList.querySelectorAll(".gdrive-sync-cb").forEach((cb) => {
    cb.addEventListener("change", () => toggleGdriveSync(cb.dataset.id, cb.checked));
  });
  els.activityList.querySelectorAll(".chatbase-sync-cb").forEach((cb) => {
    cb.addEventListener("change", () => toggleChatbaseSync(cb.dataset.id, cb.checked));
  });
  els.activityList.querySelectorAll(".activity-dl-btn").forEach((btn) => {
    btn.addEventListener("click", () => downloadFileByPath(btn.dataset.file, btn));
  });
  els.activityList.querySelectorAll(".activity-copy-btn").forEach((btn) => {
    btn.addEventListener("click", () => copyFileByPath(btn.dataset.file, btn));
  });
}

// ── DETAIL PANEL ──────────────────────────────────────────────────────────

// WEEKLY MAINTENANCE

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function currentMaintenanceWeek() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const mondayOffset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - mondayOffset);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return {
    start,
    end,
    key: localDateKey(start),
    endKey: localDateKey(end),
  };
}

function displayDate(date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function displayMaintenanceWeek(week = currentMaintenanceWeek()) {
  return `${displayDate(week.start)} - ${displayDate(week.end)}`;
}

function readMaintenanceStore() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(MAINTENANCE_STORAGE_KEY) || "{}");
    return {
      weeks: parsed.weeks || {},
      records: Array.isArray(parsed.records) ? parsed.records : [],
    };
  } catch {
    return { weeks: {}, records: [] };
  }
}

function writeMaintenanceStore(store) {
  try {
    window.localStorage.setItem(MAINTENANCE_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Local storage can be unavailable in private browser modes. The shared save path still runs.
  }
}

function currentMaintenanceCheckedKeys() {
  if (!els.maintenanceChecklist) return [];
  return Array.from(els.maintenanceChecklist.querySelectorAll("input[type='checkbox']:checked"))
    .map((input) => input.dataset.maintenanceKey);
}

function persistMaintenanceDraft() {
  const week = currentMaintenanceWeek();
  const store = readMaintenanceStore();
  store.weeks[week.key] = {
    checkedKeys: currentMaintenanceCheckedKeys(),
    completedBy: els.maintenanceCompletedBy?.value || "Kenneth",
    notes: els.maintenanceNotes?.value || "",
  };
  writeMaintenanceStore(store);
  syncMaintenanceConfirmButton();
}

function syncMaintenanceConfirmButton() {
  if (!els.confirmMaintenance || !els.maintenanceSaveHint) return;
  const checked = currentMaintenanceCheckedKeys().length;
  const remaining = MAINTENANCE_TASKS.length - checked;
  const hasName = Boolean((els.maintenanceCompletedBy?.value || "").trim());
  els.confirmMaintenance.disabled = remaining > 0 || !hasName;
  if (!hasName) {
    els.maintenanceSaveHint.textContent = "Enter who completed the maintenance before confirming.";
  } else if (remaining > 0) {
    els.maintenanceSaveHint.textContent = `Check ${remaining} more routine${remaining === 1 ? "" : "s"} before confirming the week.`;
  } else {
    els.maintenanceSaveHint.textContent = "All routines are checked. Ready to confirm this week.";
  }
}

function renderMaintenanceChecklist() {
  if (!els.maintenanceChecklist) return;
  const week = currentMaintenanceWeek();
  const store = readMaintenanceStore();
  const draft = store.weeks[week.key] || {};
  const checkedKeys = new Set(draft.checkedKeys || []);
  if (els.maintenanceWeekInput) els.maintenanceWeekInput.value = displayMaintenanceWeek(week);
  if (els.maintenanceCompletedBy && draft.completedBy) els.maintenanceCompletedBy.value = draft.completedBy;
  if (els.maintenanceNotes && draft.notes) els.maintenanceNotes.value = draft.notes;

  els.maintenanceChecklist.innerHTML = MAINTENANCE_TASKS
    .map((task) => `
      <label class="maintenance-check">
        <input type="checkbox" data-maintenance-key="${escapeHtml(task.key)}" ${checkedKeys.has(task.key) ? "checked" : ""} />
        <span>
          <strong>${escapeHtml(task.label)}</strong>
          <small>${escapeHtml(task.detail)}</small>
        </span>
      </label>
    `)
    .join("");

  els.maintenanceChecklist.querySelectorAll("input[type='checkbox']").forEach((input) => {
    input.addEventListener("change", persistMaintenanceDraft);
  });
  syncMaintenanceConfirmButton();
}

function renderMaintenanceWeekStatus(records = []) {
  if (!els.maintenanceWeekStatus || !els.maintenanceWeekLabel || !els.maintenanceLastDone) return;
  const week = currentMaintenanceWeek();
  const currentRecord = records.find((record) => record.week_start === week.key);
  els.maintenanceWeekLabel.textContent = displayMaintenanceWeek(week);
  if (currentRecord) {
    els.maintenanceWeekStatus.className = "status-chip applied";
    els.maintenanceWeekStatus.textContent = "Complete this week";
    const completedAt = currentRecord.completed_at ? new Date(currentRecord.completed_at) : null;
    const by = currentRecord.completed_by || "Kenneth";
    els.maintenanceLastDone.textContent = completedAt && !isNaN(completedAt)
      ? `Confirmed by ${by} on ${completedAt.toLocaleString()}`
      : `Confirmed by ${by}`;
    return;
  }

  els.maintenanceWeekStatus.className = "status-chip submitted";
  els.maintenanceWeekStatus.textContent = "Due this week";
  const lastRecord = records[0];
  if (lastRecord?.completed_at) {
    const completedAt = new Date(lastRecord.completed_at);
    els.maintenanceLastDone.textContent = `Last confirmed ${displayDate(completedAt)} by ${lastRecord.completed_by || "Kenneth"}.`;
  } else {
    els.maintenanceLastDone.textContent = "No confirmation logged yet.";
  }
}

function renderMaintenanceSummary(items = []) {
  if (!els.maintenanceSummary) return;
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const activeStatuses = new Set(["submitted", "analysis_ready", "needs_review", "approved", "processing", "failed"]);
  const ready = items.filter((item) => ["analysis_ready", "needs_review"].includes(item.status)).length;
  const active = items.filter((item) => activeStatuses.has(item.status)).length;
  const failed = items.filter((item) => item.status === "failed").length;
  const appliedThisWeek = items.filter((item) => item.status === "applied" && item.applied_at && new Date(item.applied_at).getTime() >= since).length;
  const driveOutstanding = items.filter((item) => item.status === "applied" && item.target_file && item.gdrive_synced !== true).length;
  const chatbaseOutstanding = items.filter((item) => item.status === "applied" && item.target_file && item.chatbase_synced !== true).length;

  const stats = [
    { label: "Ready for review", value: ready, hint: "Needs Kenneth's attention", tone: ready ? "warning" : "good" },
    { label: "Active corrections", value: active, hint: "Open or in progress", tone: active ? "warning" : "good" },
    { label: "Failed items", value: failed, hint: "Investigate first", tone: failed ? "danger" : "good" },
    { label: "Applied this week", value: appliedThisWeek, hint: "Use for patch notes", tone: appliedThisWeek ? "info" : "muted" },
    { label: "Drive not marked synced", value: driveOutstanding, hint: "Activity Log checkbox", tone: driveOutstanding ? "warning" : "good" },
    { label: "Chatbase not marked synced", value: chatbaseOutstanding, hint: "Replace and retrain", tone: chatbaseOutstanding ? "warning" : "good" },
  ];

  els.maintenanceSummary.innerHTML = stats
    .map((stat) => `
      <div class="maintenance-stat ${escapeHtml(stat.tone)}">
        <span>${escapeHtml(stat.label)}</span>
        <strong>${escapeHtml(stat.value)}</strong>
        <small>${escapeHtml(stat.hint)}</small>
      </div>
    `)
    .join("");
}

async function loadMaintenanceSummary() {
  if (!els.maintenanceSummary) return;
  try {
    const { data, error } = await supabaseClient
      .from("apollo_corrections")
      .select("id,status,updated_at,applied_at,target_file,question,chatbase_synced,gdrive_synced")
      .order("updated_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    renderMaintenanceSummary(data || []);
  } catch (err) {
    els.maintenanceSummary.innerHTML = `<div class="maintenance-stat danger"><span>Snapshot unavailable</span><strong>!</strong><small>${escapeHtml(err.message)}</small></div>`;
  }
}

function saveMaintenanceRecordLocal(record) {
  const store = readMaintenanceStore();
  store.records = [
    record,
    ...(store.records || []).filter((item) => item.week_start !== record.week_start),
  ].slice(0, 12);
  store.weeks[record.week_start] = {
    checkedKeys: record.checklist.map((task) => task.key),
    completedBy: record.completed_by,
    notes: record.notes,
  };
  writeMaintenanceStore(store);
}

function renderMaintenanceLog(records = [], source = "browser") {
  if (!els.maintenanceLog) return;
  if (!records.length) {
    els.maintenanceLog.innerHTML = '<div class="recent-item muted">No maintenance confirmations yet.</div>';
    renderMaintenanceWeekStatus([]);
    return;
  }
  els.maintenanceLog.innerHTML = records
    .map((record) => {
      const completedAt = record.completed_at ? new Date(record.completed_at) : null;
      const checklist = Array.isArray(record.checklist) ? record.checklist : [];
      const weekLabel = record.week_start && record.week_end
        ? `${escapeHtml(record.week_start)} to ${escapeHtml(record.week_end)}`
        : escapeHtml(record.week_start || "Unknown week");
      return `
        <div class="recent-item maintenance-log-item">
          <span class="recent-time">${completedAt && !isNaN(completedAt) ? escapeHtml(completedAt.toLocaleString()) : "Confirmation logged"}</span>
          <strong>${weekLabel}</strong>
          <span>Completed by ${escapeHtml(record.completed_by || "Kenneth")} - ${checklist.length} of ${MAINTENANCE_TASKS.length} routines checked</span>
          ${record.notes ? `<span class="maintenance-log-note">${escapeHtml(record.notes)}</span>` : ""}
        </div>
      `;
    })
    .join("");
  if (els.maintenanceSaveHint && source === "browser") {
    els.maintenanceSaveHint.textContent += " Shared history is not connected yet, so confirmations are saved in this browser.";
  }
}

async function loadMaintenanceLog() {
  let records = readMaintenanceStore().records || [];
  let source = "browser";
  try {
    const { data, error } = await supabaseClient
      .from("apollo_maintenance_runs")
      .select("*")
      .order("completed_at", { ascending: false })
      .limit(8);
    if (error) throw error;
    records = data || records;
    source = "shared";
  } catch {
    source = "browser";
  }
  state.maintenanceRecords = records;
  state.maintenanceLogSource = source;
  renderMaintenanceLog(records, source);
  renderMaintenanceWeekStatus(records);
}

async function loadMaintenance() {
  renderMaintenanceChecklist();
  renderMaintenanceWeekStatus(state.maintenanceRecords);
  await Promise.all([loadMaintenanceSummary(), loadMaintenanceLog()]);
}

async function confirmWeeklyMaintenance() {
  const checkedKeys = currentMaintenanceCheckedKeys();
  if (checkedKeys.length !== MAINTENANCE_TASKS.length) {
    syncMaintenanceConfirmButton();
    showToast("Check every maintenance routine before confirming.");
    return;
  }
  const week = currentMaintenanceWeek();
  const completedBy = (els.maintenanceCompletedBy?.value || "").trim() || "Kenneth";
  const record = {
    week_start: week.key,
    week_end: week.endKey,
    completed_at: new Date().toISOString(),
    completed_by: completedBy,
    checklist: MAINTENANCE_TASKS.filter((task) => checkedKeys.includes(task.key)).map((task) => ({
      key: task.key,
      label: task.label,
    })),
    notes: (els.maintenanceNotes?.value || "").trim(),
    source: "portal",
  };

  saveMaintenanceRecordLocal(record);
  let savedShared = false;
  try {
    const { error } = await supabaseClient
      .from("apollo_maintenance_runs")
      .upsert(record, { onConflict: "week_start" });
    if (error) throw error;
    savedShared = true;
  } catch {
    savedShared = false;
  }

  showToast(
    savedShared
      ? "Weekly maintenance confirmed and saved to the shared log."
      : "Weekly maintenance confirmed on this browser. Shared log table is not connected yet.",
    savedShared ? "success" : "default"
  );
  await loadMaintenance();
}

function setMode(mode) {
  state.mode = mode;
  els.modeExisting.classList.toggle("active", mode === "existing");
  els.modeNew.classList.toggle("active", mode === "new");
  document.querySelector(".new-fields").classList.toggle("hidden", mode !== "new");

  const isNew = mode === "new";
  document.getElementById("newFileBanner").classList.toggle("hidden", !isNew);
  document.getElementById("existingFileFields").classList.toggle("hidden", isNew);
  document.getElementById("existingFileFieldsGhost").classList.toggle("hidden", !isNew);
  updateFilenamePreview();
}

function updateFilenamePreview() {
  if (state.mode !== "new") return;
  const topic = els.newTopic.value.trim().toUpperCase();
  const category = (els.category?.value || "").trim().toUpperCase() || "TECH";
  const slug = topic.replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  const el = document.getElementById("filenamePreview");
  if (!el) return;
  if (slug) {
    el.textContent = `→ Will be saved as: _???_${category}__${slug}.docx`;
    el.classList.add("has-preview");
  } else {
    el.textContent = "";
    el.classList.remove("has-preview");
  }
}

function applyFileCreationView(item, isFileCreation) {
  const decisionStrip = document.querySelector(".decision-strip");
  const newFields = document.querySelector(".new-fields");
  const existingFields = document.getElementById("existingFileFields");
  const ghostFields = document.getElementById("existingFileFieldsGhost");
  const newFileBanner = document.getElementById("newFileBanner");
  const currentSectionField = els.currentSection.closest(".field");

  // Toggle the dedicated banner
  els.fileCreationBanner.classList.toggle("hidden", !isFileCreation);

  if (isFileCreation) {
    // Hide all the correction-mode chrome — this is a pure generated file
    if (decisionStrip) decisionStrip.classList.add("hidden");
    if (newFields) newFields.classList.add("hidden");
    if (existingFields) existingFields.classList.add("hidden");
    if (ghostFields) ghostFields.classList.add("hidden");
    if (newFileBanner) newFileBanner.classList.add("hidden");
    // No "current section" for a brand new file — hide that column
    if (currentSectionField) currentSectionField.classList.add("hidden");

    // Populate filename + related-file chips
    const filename = (item.target_file || "").replace(/.*\//, "");
    els.fcFilename.textContent = filename || "(pending)";
    const related = item.analysis?.cross_references?.length
      ? item.analysis.cross_references
      : (item.analysis?.related_files || []);
    if (related.length) {
      els.fcRelatedWrap.style.display = "";
      els.fcRelatedChips.innerHTML = related
        .map((f) => `<span class="status-chip">${escapeHtml((f || "").replace(/.*\//, ""))}</span>`)
        .join("");
    } else {
      els.fcRelatedWrap.style.display = "none";
    }

    // Relabel the proposed column and give it more room
    const proposedLabel = els.proposedReplacement.closest(".field")?.querySelector("span");
    if (proposedLabel) proposedLabel.textContent = "Generated KB file — edit before approving";
    els.proposedReplacement.rows = 28;
  } else {
    // Restore correction-mode chrome
    if (decisionStrip) decisionStrip.classList.remove("hidden");
    if (currentSectionField) currentSectionField.classList.remove("hidden");
    const proposedLabel = els.proposedReplacement.closest(".field")?.querySelector("span");
    if (proposedLabel) proposedLabel.textContent = "Proposed replacement — edit before approving";
    els.proposedReplacement.rows = 16;
  }
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

  // File-creation requests get a dedicated presentation
  const isFileCreation = item.request_type === "file_creation";
  applyFileCreationView(item, isFileCreation);

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

  let update;
  if (item.request_type === "file_creation") {
    // For generated files, only the content is editable — keep filename/topic intact
    update = {
      proposed_replacement: els.proposedReplacement.value.trim(),
    };
  } else {
    update = {
      mode: state.mode,
      target_file: els.targetFile.value.trim() || null,
      target_section_heading: els.targetSection.value.trim() || null,
      current_section: els.currentSection.value,
      proposed_replacement: els.proposedReplacement.value.trim(),
      new_topic: els.newTopic.value.trim(),
      new_purpose: els.newPurpose.value.trim(),
    };
  }
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

  // File-creation approval — simplest path
  if (item.request_type === "file_creation") {
    if (!els.proposedReplacement.value.trim()) {
      showToast("The generated file is empty — nothing to approve.");
      return;
    }
    state.pendingMultiTargets = null;
    const filename = (item.target_file || "the new file").replace(/.*\//, "");
    els.confirmText.textContent = `This will create ${filename} and commit it to GitHub. It will be indexed so future corrections can route to it.`;
    els.reviewedCheck.checked = false;
    els.confirmApprove.disabled = true;
    els.confirmLayer.classList.remove("hidden");
    return;
  }

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
    if (state.mode === "new" && !els.newTopic.value.trim()) {
      showToast("Add a 'New file topic' before approving — this becomes the filename.");
      els.newTopic.focus();
      return;
    }
    const target = state.mode === "new"
      ? `a new KB file: ${els.newTopic.value.trim()}`
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

// ── SINGLE FILE DOWNLOAD / COPY (from Activity tab) ──────────────────────

async function downloadFileByPath(filePath, btn) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Fetching…";
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
  btn.textContent = "Copying…";
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
renderMaintenanceChecklist();
renderMaintenanceWeekStatus(readMaintenanceStore().records || []);
loadLastEdited();
loadCorrections().catch((error) => {
  setSync("Needs attention");
  showToast(error.message);
});
