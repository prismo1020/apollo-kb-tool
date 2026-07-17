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

// Manually-entered weekly metrics (from Chatbase analytics). Auto metrics
// (corrections applied, new KB files) are computed from the portal database.
const WEEKLY_METRICS = [
  { key: "apollo_interactions", label: "Apollo interactions", hint: "Total conversations this week", color: "#4c7df0" },
  { key: "reliability_tags", label: "Reliability tags", hint: "Reliability tags logged", color: "#7c5cff" },
  { key: "thumbs_up", label: "Thumbs up", hint: "Positive feedback", color: "#30a46c" },
  { key: "thumbs_down", label: "Thumbs down", hint: "Negative feedback", color: "#e5484d" },
];

// Derived metrics computed from the raw weekly numbers (turn counts into rates).
const DERIVED_METRICS = [
  {
    key: "thumbs_up_rate",
    label: "Thumbs-up rate",
    suffix: "%",
    color: "#30a46c",
    compute: (row) => {
      const up = numOrNull(row.thumbs_up);
      const dn = numOrNull(row.thumbs_down);
      if (up == null && dn == null) return null;
      const total = (up || 0) + (dn || 0);
      return total > 0 ? Math.round(((up || 0) / total) * 100) : null;
    },
  },
  {
    key: "tags_per_100",
    label: "Reliability tags / 100 chats",
    suffix: "",
    color: "#7c5cff",
    compute: (row) => {
      const tags = numOrNull(row.reliability_tags);
      const inter = numOrNull(row.apollo_interactions);
      if (tags == null || inter == null || inter === 0) return null;
      return Math.round((tags / inter) * 1000) / 10; // per 100 chats, 1 decimal
    },
  },
];
const METRIC_WEEKS = 8; // how many weeks of history to show in charts

// Goal thresholds — editable in the UI, persisted per browser. `max` breaches
// when the value goes above it; `min` breaches when it drops below.
const GOALS_STORAGE_KEY = "apolloMetricGoals";
const DEFAULT_GOALS = {
  apollo_interactions: { min: null },
  reliability_tags: { max: null },
  thumbs_up: { min: null },
  thumbs_down: { max: 15 },
  thumbs_up_rate: { min: 85 },
  tags_per_100: { max: null },
};

function numOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function loadGoals() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(GOALS_STORAGE_KEY) || "{}");
    return { ...DEFAULT_GOALS, ...stored };
  } catch {
    return { ...DEFAULT_GOALS };
  }
}

function saveGoals(goals) {
  try { window.localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(goals)); } catch { /* ignore */ }
}

// Returns true if `value` breaches the goal for `key`.
function goalBreached(key, value) {
  if (value == null) return false;
  const goal = loadGoals()[key] || {};
  if (goal.max != null && value > goal.max) return true;
  if (goal.min != null && value < goal.min) return true;
  return false;
}

function goalText(key) {
  const goal = loadGoals()[key] || {};
  if (goal.max != null) return `Goal: ≤ ${goal.max}`;
  if (goal.min != null) return `Goal: ≥ ${goal.min}`;
  return "";
}

const state = {
  drafts: [],
  corrections: [],
  maintenanceRecords: [],
  maintenanceLogSource: "browser",
  weeklyMetrics: [],       // rows from apollo_weekly_metrics, newest first
  autoWeekActivity: {},    // { weekKey: { applied, newFiles } } from corrections
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
  metricCards: document.getElementById("metricCards"),
  metricTrend: document.getElementById("metricTrend"),
  metricComparison: document.getElementById("metricComparison"),
  activityChart: document.getElementById("activityChart"),
  metricNotes: document.getElementById("metricNotes"),
  patchNotesStatus: document.getElementById("patchNotesStatus"),
  saveMetricsBtn: document.getElementById("saveMetricsBtn"),
  goalsEditor: document.getElementById("goalsEditor"),
  saveGoalsBtn: document.getElementById("saveGoalsBtn"),
  metricsHistory: document.getElementById("metricsHistory"),
  exportMetricsCsv: document.getElementById("exportMetricsCsv"),
  maintenanceAlert: document.getElementById("maintenanceAlert"),
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
  const baseCols = "id,status,updated_at,applied_at,target_file,question,github_commit_url,failure_reason,targets,chatbase_synced,chatbase_synced_at,gdrive_synced,gdrive_synced_at";
  const statuses = ["applied", "failed", "rejected", "processing"];

  // Prefer per-file sync state, but fall back gracefully if the file_sync
  // column hasn't been added to the database yet.
  let { data, error } = await supabaseClient
    .from("apollo_corrections")
    .select(`${baseCols},file_sync`)
    .in("status", statuses)
    .order("updated_at", { ascending: false })
    .limit(50);

  if (error && /file_sync/.test(error.message || "")) {
    ({ data, error } = await supabaseClient
      .from("apollo_corrections")
      .select(baseCols)
      .in("status", statuses)
      .order("updated_at", { ascending: false })
      .limit(50));
  }
  if (error) throw error;
  renderActivity(data || []);
}

// Sync state is tracked per file in the `file_sync` jsonb column, keyed by
// filename: { "<file>": { chatbase_synced, chatbase_synced_at, gdrive_synced,
// gdrive_synced_at } }. This lets each file of a multi-file correction be
// marked synced independently.
async function setFileSync(id, file, kind, checked) {
  const rowKey = `${id}::${file}`;
  const row = document.querySelector(`.activity-sync-row[data-key="${cssEscape(rowKey)}"]`);
  if (row) row.classList.add("saving");
  try {
    // Read-modify-write the file_sync object so we don't clobber other files.
    const { data, error: readErr } = await supabaseClient
      .from("apollo_corrections")
      .select("file_sync")
      .eq("id", id)
      .single();
    if (readErr) throw readErr;
    const fileSync = (data && data.file_sync) || {};
    const entry = { ...(fileSync[file] || {}) };
    const nowIso = new Date().toISOString();
    if (kind === "chatbase") {
      entry.chatbase_synced = checked;
      entry.chatbase_synced_at = checked ? nowIso : null;
    } else {
      entry.gdrive_synced = checked;
      entry.gdrive_synced_at = checked ? nowIso : null;
    }
    fileSync[file] = entry;

    const { error } = await supabaseClient
      .from("apollo_corrections")
      .update({ file_sync: fileSync })
      .eq("id", id);
    if (error) throw error;

    const chipClass = kind === "chatbase" ? "chatbase-sync-chip" : "gdrive-sync-chip";
    const label = kind === "chatbase" ? "Chatbase" : "Drive";
    const chip = document.querySelector(`.${chipClass}[data-key="${cssEscape(rowKey)}"]`);
    if (chip) {
      chip.className = `status-chip ${checked ? "applied" : ""} ${chipClass}`;
      chip.textContent = checked ? `✓ Synced to ${label}` : `Not synced to ${label}`;
    }
  } catch (err) {
    showToast(`Sync save failed: ${err.message}`);
    const cbClass = kind === "chatbase" ? "chatbase-sync-cb" : "gdrive-sync-cb";
    const cb = document.querySelector(`.${cbClass}[data-key="${cssEscape(rowKey)}"]`);
    if (cb) cb.checked = !checked;
  } finally {
    if (row) row.classList.remove("saving");
  }
}

// Escape a string for safe use inside a CSS attribute selector.
function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}

// Render one file's block: name, sync chips, download/copy buttons, and the
// per-file sync checkboxes. Shared by single-file and grouped multi-file cards.
function activityFileBlock(item, targetFile) {
  const isApplied = item.status === "applied";
  const fileSync = (item.file_sync && item.file_sync[targetFile]) || null;
  const cbSynced = fileSync ? fileSync.chatbase_synced === true : item.chatbase_synced === true;
  const cbSyncedAtRaw = fileSync ? fileSync.chatbase_synced_at : item.chatbase_synced_at;
  const cbSyncedAt = cbSyncedAtRaw
    ? new Date(cbSyncedAtRaw).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;
  const gdSynced = fileSync ? fileSync.gdrive_synced === true : item.gdrive_synced === true;
  const gdSyncedAtRaw = fileSync ? fileSync.gdrive_synced_at : item.gdrive_synced_at;
  const gdSyncedAt = gdSyncedAtRaw
    ? new Date(gdSyncedAtRaw).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;
  const rowKey = `${item.id}::${targetFile || ""}`;

  return `
    <div class="activity-file">
      <strong>${escapeHtml(targetFile || shortText(item.question, "No target file"))}</strong>
      <div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap">
        <span class="status-chip ${gdSynced ? "applied" : ""} gdrive-sync-chip" data-key="${escapeHtml(rowKey)}">${gdSynced ? `✓ Synced to Drive${gdSyncedAt ? ` · ${gdSyncedAt}` : ""}` : "Not synced to Drive"}</span>
        <span class="status-chip ${cbSynced ? "applied" : ""} chatbase-sync-chip" data-key="${escapeHtml(rowKey)}">${cbSynced ? `✓ Synced to Chatbase${cbSyncedAt ? ` · ${cbSyncedAt}` : ""}` : "Not synced to Chatbase"}</span>
      </div>
      ${isApplied && targetFile ? `
        <div class="activity-sync-row" data-key="${escapeHtml(rowKey)}">
          <div class="button-row" style="margin-bottom:10px">
            <button class="button secondary compact activity-dl-btn" data-file="${escapeHtml(targetFile)}" type="button">Download .txt</button>
            <button class="button quiet compact activity-copy-btn" data-file="${escapeHtml(targetFile)}" type="button">Copy for Chatbase</button>
          </div>
          <label class="sync-checkbox-label">
            <input type="checkbox" class="gdrive-sync-cb" data-key="${escapeHtml(rowKey)}" data-id="${escapeHtml(item.id)}" data-file="${escapeHtml(targetFile)}" ${gdSynced ? "checked" : ""} />
            <span>Synced to Google Drive backup</span>
          </label>
          <label class="sync-checkbox-label" style="margin-top:6px">
            <input type="checkbox" class="chatbase-sync-cb" data-key="${escapeHtml(rowKey)}" data-id="${escapeHtml(item.id)}" data-file="${escapeHtml(targetFile)}" ${cbSynced ? "checked" : ""} />
            <span>Synced to Chatbase</span>
          </label>
        </div>
      ` : ""}
    </div>
  `;
}

function renderActivity(items) {
  if (!items.length) {
    els.activityList.innerHTML = '<div class="recent-item muted">No activity yet.</div>';
    return;
  }

  els.activityList.innerHTML = items
    .map((item) => {
      const time = escapeHtml(new Date(item.updated_at).toLocaleString());
      const statusChip = `<span class="status-chip ${escapeHtml(item.status)}">${escapeHtml(statusLabel(item.status))}</span>`;
      const commitLink = item.github_commit_url
        ? `<a href="${escapeHtml(item.github_commit_url)}" target="_blank" rel="noreferrer" class="commit-link" style="font-size:12px">View Commit →</a>`
        : "";
      const failureNote = item.failure_reason && item.status !== "rejected"
        ? `<span style="font-size:12px;color:var(--danger);margin-top:4px;display:block">${escapeHtml(item.failure_reason)}</span>`
        : (item.status === "rejected" && item.failure_reason
          ? `<span style="font-size:12px;color:var(--text-muted);margin-top:4px;display:block">Rejection reason: ${escapeHtml(item.failure_reason)}</span>`
          : "");

      const approvedTargets = (Array.isArray(item.targets) ? item.targets : []).filter(t => t.status === "approved");
      const isGroupedMultiFile = item.status === "applied" && approvedTargets.length > 1;

      if (isGroupedMultiFile) {
        // One correction that updated several files — show a group header naming
        // the correction, then each file nested beneath it.
        return `
          <div class="recent-item recent-group">
            <span class="recent-time">${time}</span>
            <div style="display:flex;align-items:center;gap:8px;margin-top:2px;flex-wrap:wrap">
              ${statusChip}
              <span class="status-chip">${approvedTargets.length} files updated by this correction</span>
              ${commitLink}
            </div>
            <div style="font-size:13px;color:var(--text-muted);margin-top:8px">
              From correction: <em>${escapeHtml(shortText(item.question || item.target_file, "correction"))}</em>
            </div>
            <div class="activity-file-group">
              ${approvedTargets.map(t => activityFileBlock(item, t.file)).join("")}
            </div>
            ${failureNote}
          </div>
        `;
      }

      // Single-file correction (or not yet applied) — one card.
      return `
        <div class="recent-item">
          <span class="recent-time">${time}</span>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px;flex-wrap:wrap">
            ${statusChip}
            ${commitLink}
          </div>
          ${activityFileBlock(item, item.target_file)}
          ${failureNote}
        </div>
      `;
    })
    .join("");

  els.activityList.querySelectorAll(".gdrive-sync-cb").forEach((cb) => {
    cb.addEventListener("change", () => setFileSync(cb.dataset.id, cb.dataset.file, "gdrive", cb.checked));
  });
  els.activityList.querySelectorAll(".chatbase-sync-cb").forEach((cb) => {
    cb.addEventListener("change", () => setFileSync(cb.dataset.id, cb.dataset.file, "chatbase", cb.checked));
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
  await Promise.all([
    loadMaintenanceSummary(),
    loadMaintenanceLog(),
    loadWeeklyMetrics(),
    loadAutoWeekActivity(),
  ]);
  renderMetricsDashboard();
}

// ── WEEKLY METRICS: week helpers ──────────────────────────────────────────

function weekStartFor(date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const mondayOffset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - mondayOffset);
  return start;
}

// Returns the last N Monday week-start dates, oldest first.
function lastNWeekStarts(n) {
  const thisMonday = weekStartFor(new Date());
  const weeks = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(thisMonday);
    d.setDate(thisMonday.getDate() - i * 7);
    weeks.push(d);
  }
  return weeks;
}

function shortWeekLabel(dateOrKey) {
  const d = dateOrKey instanceof Date ? dateOrKey : new Date(`${dateOrKey}T00:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── WEEKLY METRICS: data ──────────────────────────────────────────────────

async function loadWeeklyMetrics() {
  try {
    const { data, error } = await supabaseClient
      .from("apollo_weekly_metrics")
      .select("*")
      .order("week_start", { ascending: false })
      .limit(26);
    if (error) throw error;
    state.weeklyMetrics = data || [];
  } catch {
    // Table may not exist yet — dashboard still renders with empty history.
    state.weeklyMetrics = [];
  }
}

// Build a { weekKey: { applied, newFiles } } map from applied corrections.
async function loadAutoWeekActivity() {
  const activity = {};
  try {
    const earliest = lastNWeekStarts(METRIC_WEEKS)[0];
    const { data, error } = await supabaseClient
      .from("apollo_corrections")
      .select("id,status,applied_at,request_type,targets")
      .eq("status", "applied")
      .gte("applied_at", earliest.toISOString())
      .limit(500);
    if (error) throw error;
    for (const row of data || []) {
      if (!row.applied_at) continue;
      const key = localDateKey(weekStartFor(new Date(row.applied_at)));
      const bucket = activity[key] || { applied: 0, newFiles: 0, filesTouched: 0 };
      bucket.applied += 1;
      if (row.request_type === "file_creation") bucket.newFiles += 1;
      const approved = Array.isArray(row.targets) ? row.targets.filter((t) => t.status === "approved").length : 0;
      bucket.filesTouched += approved > 0 ? approved : 1;
      activity[key] = bucket;
    }
  } catch {
    // Non-fatal: activity chart just shows zeros.
  }
  state.autoWeekActivity = activity;
}

function metricsForWeek(weekKey) {
  return state.weeklyMetrics.find((m) => m.week_start === weekKey) || null;
}

// Auto-mark that patch notes were generated for the current week.
async function stampPatchNotesGenerated() {
  const week = currentMaintenanceWeek();
  const nowIso = new Date().toISOString();
  const { error } = await supabaseClient
    .from("apollo_weekly_metrics")
    .upsert(
      { week_start: week.key, week_end: week.endKey, patch_notes_posted: true, patch_notes_generated_at: nowIso },
      { onConflict: "week_start" },
    );
  if (error) throw error;
  await loadWeeklyMetrics();
  if (document.getElementById("maintenanceView")?.classList.contains("active")) {
    renderMetricsInputs();
    renderMetricsHistory();
  }
}

async function saveWeeklyMetrics() {
  const week = currentMaintenanceWeek();
  const row = {
    week_start: week.key,
    week_end: week.endKey,
    updated_by: (els.maintenanceCompletedBy?.value || "").trim() || "Kenneth",
    updated_at: new Date().toISOString(),
    notes: (els.metricNotes?.value || "").trim() || null,
  };
  // Note: patch_notes_posted is intentionally omitted — it's auto-set when
  // patch notes are downloaded, so we don't overwrite it here.
  for (const metric of WEEKLY_METRICS) {
    const input = document.getElementById(`metric_${metric.key}`);
    const raw = input ? input.value.trim() : "";
    row[metric.key] = raw === "" ? null : Number(raw);
  }

  if (els.saveMetricsBtn) { els.saveMetricsBtn.disabled = true; els.saveMetricsBtn.textContent = "Saving…"; }
  try {
    const { error } = await supabaseClient
      .from("apollo_weekly_metrics")
      .upsert(row, { onConflict: "week_start" });
    if (error) throw error;
    showToast("Weekly metrics saved.", "success");
    await loadWeeklyMetrics();
    renderMetricsDashboard();
  } catch (err) {
    showToast(`Could not save metrics: ${err.message}`);
  } finally {
    if (els.saveMetricsBtn) { els.saveMetricsBtn.disabled = false; els.saveMetricsBtn.textContent = "Save this week's metrics"; }
  }
}

// ── WEEKLY METRICS: SVG chart helpers ─────────────────────────────────────

// A compact bar-chart sparkline for a metric card (Chatbase-widget style).
// Pass `target` to draw a dashed goal line.
function sparkBars(values, color, { width = 260, height = 90, target = null } = {}) {
  const max = Math.max(1, target || 0, ...values.map((v) => v || 0));
  const n = values.length;
  const gap = 6;
  const barW = (width - gap * (n - 1)) / n;
  const bars = values
    .map((v, i) => {
      const h = Math.max(2, ((v || 0) / max) * (height - 8));
      const x = i * (barW + gap);
      const y = height - h;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${color}"><title>${v ?? 0}</title></rect>`;
    })
    .join("");
  let targetLine = "";
  if (target != null && target > 0) {
    const y = height - (target / max) * (height - 8);
    targetLine = `<line x1="0" y1="${y.toFixed(1)}" x2="${width}" y2="${y.toFixed(1)}" stroke="#e5484d" stroke-width="1.5" stroke-dasharray="4 3" opacity="0.8"><title>Goal: ${target}</title></line>`;
  }
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="none" role="img">${bars}${targetLine}</svg>`;
}

// Multi-series line chart with week labels along the x-axis.
function lineChart(series, labels, { width = 640, height = 220 } = {}) {
  const padL = 34, padR = 12, padT = 12, padB = 26;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const allVals = series.flatMap((s) => s.values.filter((v) => v != null));
  const max = Math.max(1, ...allVals);
  const n = labels.length;
  const xFor = (i) => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yFor = (v) => padT + plotH - ((v || 0) / max) * plotH;

  // horizontal gridlines + y labels (0, mid, max)
  const ticks = [0, Math.round(max / 2), max];
  const grid = ticks
    .map((t) => {
      const y = yFor(t);
      return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${width - padR}" y2="${y.toFixed(1)}" stroke="var(--border-light,#e5e7eb)" stroke-width="1"/>`
        + `<text x="${padL - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--text-muted,#8a8f98)">${t}</text>`;
    })
    .join("");

  const xLabels = labels
    .map((lb, i) => `<text x="${xFor(i).toFixed(1)}" y="${height - 8}" text-anchor="middle" font-size="10" fill="var(--text-muted,#8a8f98)">${escapeHtml(lb)}</text>`)
    .join("");

  const paths = series
    .map((s) => {
      const pts = s.values.map((v, i) => `${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`);
      const line = `<polyline fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="${pts.join(" ")}"/>`;
      const dots = s.values.map((v, i) => `<circle cx="${xFor(i).toFixed(1)}" cy="${yFor(v).toFixed(1)}" r="3" fill="${s.color}"><title>${s.label}: ${v ?? 0}</title></circle>`).join("");
      return line + dots;
    })
    .join("");

  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img">${grid}${paths}${xLabels}</svg>`;
}

// ── WEEKLY METRICS: rendering ─────────────────────────────────────────────

function renderMetricsDashboard() {
  renderMaintenanceAlert();
  renderMetricsInputs();
  renderMetricCards();
  renderMetricTrendChart();
  renderMetricComparison();
  renderActivityChart();
  renderGoalsEditor();
  renderMetricsHistory();
}

// Pre-fill the entry form with this week's saved values (if any).
function renderMetricsInputs() {
  const week = currentMaintenanceWeek();
  const saved = metricsForWeek(week.key);
  for (const metric of WEEKLY_METRICS) {
    const input = document.getElementById(`metric_${metric.key}`);
    if (input && document.activeElement !== input) {
      input.value = saved && saved[metric.key] != null ? saved[metric.key] : "";
    }
  }
  if (els.metricNotes && document.activeElement !== els.metricNotes) {
    els.metricNotes.value = (saved && saved.notes) || "";
  }
  // Patch-notes status is auto-detected (stamped when patch notes are downloaded).
  if (els.patchNotesStatus) {
    const posted = Boolean(saved && saved.patch_notes_posted);
    const at = saved && saved.patch_notes_generated_at ? new Date(saved.patch_notes_generated_at) : null;
    els.patchNotesStatus.className = `patch-status ${posted ? "done" : "pending"}`;
    els.patchNotesStatus.textContent = posted
      ? `✓ Patch notes generated this week${at && !isNaN(at) ? ` (${at.toLocaleDateString()})` : ""}`
      : "○ No patch notes generated yet this week";
  }
}

function orderedWeekKeys() {
  return lastNWeekStarts(METRIC_WEEKS).map((d) => localDateKey(d));
}

function seriesForMetric(key) {
  return orderedWeekKeys().map((wk) => {
    const row = metricsForWeek(wk);
    return row && row[key] != null ? Number(row[key]) : 0;
  });
}

// Value of a raw or derived metric for a given week (null if unavailable).
function metricValueForWeek(def, weekKey) {
  const row = metricsForWeek(weekKey);
  if (!row) return null;
  if (def.compute) return def.compute(row);
  return row[def.key] != null ? Number(row[def.key]) : null;
}

function seriesForDef(def) {
  return orderedWeekKeys().map((wk) => {
    const v = metricValueForWeek(def, wk);
    return v == null ? 0 : v;
  });
}

function renderMetricCards() {
  if (!els.metricCards) return;
  const weekKeys = orderedWeekKeys();
  const currentKey = weekKeys[weekKeys.length - 1];
  const allDefs = [...WEEKLY_METRICS, ...DERIVED_METRICS];
  els.metricCards.innerHTML = allDefs
    .map((def) => {
      const values = seriesForDef(def);
      const current = metricValueForWeek(def, currentKey);
      const breached = goalBreached(def.key, current);
      const goal = loadGoals()[def.key] || {};
      const target = goal.max != null ? goal.max : (goal.min != null ? goal.min : null);
      const gt = goalText(def.key);
      const displayVal = current == null ? "—" : `${current}${def.suffix || ""}`;
      return `
        <div class="metric-card ${breached ? "breach" : ""}">
          <span class="metric-card-label">${escapeHtml(def.label)}</span>
          <span class="metric-card-value" style="color:${breached ? "var(--danger)" : def.color}">${escapeHtml(displayVal)}</span>
          ${sparkBars(values, def.color, { target })}
          <span class="metric-card-foot">${gt ? `${escapeHtml(gt)}${breached ? " · ⚠ breached" : ""}` : `Last ${METRIC_WEEKS} weeks`}</span>
        </div>
      `;
    })
    .join("");
}

// Warn if a maintenance week was skipped (no confirmation logged for it).
function renderMaintenanceAlert() {
  if (!els.maintenanceAlert) return;
  const records = state.maintenanceRecords || [];
  const confirmedKeys = new Set(records.map((r) => r.week_start));
  const weeks = lastNWeekStarts(METRIC_WEEKS).map((d) => localDateKey(d));
  const currentKey = weeks[weeks.length - 1];
  // Count consecutive most-recent PAST weeks (excluding current) with no confirmation.
  let skipped = 0;
  for (let i = weeks.length - 2; i >= 0; i--) {
    if (confirmedKeys.has(weeks[i])) break;
    skipped++;
  }
  const currentDone = confirmedKeys.has(currentKey);
  if (skipped === 0 && currentDone) {
    els.maintenanceAlert.className = "maintenance-alert ok";
    els.maintenanceAlert.innerHTML = "✓ Maintenance is up to date.";
  } else if (skipped === 0) {
    els.maintenanceAlert.className = "maintenance-alert due";
    els.maintenanceAlert.innerHTML = "This week's maintenance hasn't been confirmed yet.";
  } else {
    els.maintenanceAlert.className = "maintenance-alert warn";
    els.maintenanceAlert.innerHTML = `⚠ ${skipped} week${skipped === 1 ? "" : "s"} of maintenance ${skipped === 1 ? "was" : "were"} skipped. Catch up as soon as possible.`;
  }
}

// Editable goal thresholds (persisted per browser).
function renderGoalsEditor() {
  if (!els.goalsEditor) return;
  const goals = loadGoals();
  const allDefs = [...WEEKLY_METRICS, ...DERIVED_METRICS];
  els.goalsEditor.innerHTML = allDefs
    .map((def) => {
      const g = goals[def.key] || {};
      const kind = g.min != null ? "min" : "max"; // default editor kind
      const val = g.min != null ? g.min : (g.max != null ? g.max : "");
      return `
        <div class="goal-row">
          <span class="goal-metric">${escapeHtml(def.label)}${def.suffix ? ` (${def.suffix})` : ""}</span>
          <select class="goal-kind" data-key="${escapeHtml(def.key)}">
            <option value="max" ${kind === "max" ? "selected" : ""}>at most</option>
            <option value="min" ${kind === "min" ? "selected" : ""}>at least</option>
          </select>
          <input class="goal-val" type="number" data-key="${escapeHtml(def.key)}" value="${val}" placeholder="none" />
        </div>
      `;
    })
    .join("");
}

function saveGoalsFromEditor() {
  const goals = {};
  document.querySelectorAll("#goalsEditor .goal-row").forEach((row) => {
    const kindSel = row.querySelector(".goal-kind");
    const valInput = row.querySelector(".goal-val");
    const key = kindSel.dataset.key;
    const raw = valInput.value.trim();
    if (raw === "") { goals[key] = {}; return; }
    const num = Number(raw);
    goals[key] = kindSel.value === "min" ? { min: num } : { max: num };
  });
  saveGoals(goals);
  renderMetricCards();
  renderMetricsHistory();
  showToast("Goals saved.", "success");
}

// History table of every stored week + CSV export.
function metricsHistoryRows() {
  // Union of weeks that have metrics or auto activity, newest first.
  const keys = new Set([
    ...state.weeklyMetrics.map((m) => m.week_start),
    ...Object.keys(state.autoWeekActivity),
  ]);
  const sorted = [...keys].sort().reverse();
  return sorted.map((wk) => {
    const row = metricsForWeek(wk) || {};
    const act = state.autoWeekActivity[wk] || {};
    return {
      week: wk,
      apollo_interactions: row.apollo_interactions ?? "",
      reliability_tags: row.reliability_tags ?? "",
      thumbs_up: row.thumbs_up ?? "",
      thumbs_down: row.thumbs_down ?? "",
      thumbs_up_rate: DERIVED_METRICS[0].compute(row) ?? "",
      tags_per_100: DERIVED_METRICS[1].compute(row) ?? "",
      corrections_applied: act.applied ?? 0,
      new_kb_files: act.newFiles ?? 0,
      patch_notes: row.patch_notes_posted ? "yes" : "no",
      notes: row.notes || "",
    };
  });
}

function renderMetricsHistory() {
  if (!els.metricsHistory) return;
  const rows = metricsHistoryRows();
  if (!rows.length) {
    els.metricsHistory.innerHTML = '<div class="recent-item muted">No weekly data yet.</div>';
    return;
  }
  const head = `
    <tr>
      <th>Week</th><th>Interactions</th><th>Rel. tags</th><th>👍</th><th>👎</th>
      <th>👍 %</th><th>Tags/100</th><th>Applied</th><th>New files</th><th>Patch</th><th>Notes</th>
    </tr>`;
  const body = rows
    .map((r) => `
      <tr>
        <td>${escapeHtml(shortWeekLabel(r.week))}</td>
        <td>${escapeHtml(String(r.apollo_interactions))}</td>
        <td>${escapeHtml(String(r.reliability_tags))}</td>
        <td>${escapeHtml(String(r.thumbs_up))}</td>
        <td>${escapeHtml(String(r.thumbs_down))}</td>
        <td>${escapeHtml(String(r.thumbs_up_rate))}</td>
        <td>${escapeHtml(String(r.tags_per_100))}</td>
        <td>${escapeHtml(String(r.corrections_applied))}</td>
        <td>${escapeHtml(String(r.new_kb_files))}</td>
        <td>${escapeHtml(r.patch_notes)}</td>
        <td>${escapeHtml(r.notes)}</td>
      </tr>`)
    .join("");
  els.metricsHistory.innerHTML = `<table class="metrics-table">${head}${body}</table>`;
}

function exportMetricsCsv() {
  const rows = metricsHistoryRows();
  if (!rows.length) { showToast("No metrics to export yet."); return; }
  const cols = ["week", "apollo_interactions", "reliability_tags", "thumbs_up", "thumbs_down", "thumbs_up_rate", "tags_per_100", "corrections_applied", "new_kb_files", "patch_notes", "notes"];
  const escapeCsv = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(","), ...rows.map((r) => cols.map((c) => escapeCsv(r[c])).join(","))];
  const date = new Date().toISOString().slice(0, 10);
  triggerDownload(lines.join("\n"), `Apollo_Weekly_Metrics_${date}.csv`);
  showToast("Metrics CSV downloaded.", "success");
}

function renderMetricTrendChart() {
  if (!els.metricTrend) return;
  const labels = orderedWeekKeys().map(shortWeekLabel);
  const series = WEEKLY_METRICS.map((m) => ({ label: m.label, color: m.color, values: seriesForMetric(m.key) }));
  const legend = WEEKLY_METRICS
    .map((m) => `<span class="chart-legend-item"><span class="chart-legend-dot" style="background:${m.color}"></span>${escapeHtml(m.label)}</span>`)
    .join("");
  els.metricTrend.innerHTML = `<div class="chart-legend">${legend}</div>${lineChart(series, labels)}`;
}

function renderMetricComparison() {
  if (!els.metricComparison) return;
  const weekKeys = orderedWeekKeys();
  const thisKey = weekKeys[weekKeys.length - 1];
  const lastKey = weekKeys[weekKeys.length - 2];
  const thisWeek = metricsForWeek(thisKey);
  const lastWeek = metricsForWeek(lastKey);

  const allDefs = [...WEEKLY_METRICS, ...DERIVED_METRICS];
  els.metricComparison.innerHTML = allDefs
    .map((def) => {
      const cur = thisWeek ? metricValueForWeek(def, thisKey) : null;
      const prev = lastWeek ? metricValueForWeek(def, lastKey) : null;
      let deltaHtml = '<span class="cmp-delta muted">no prior week</span>';
      if (cur != null && prev != null) {
        const diff = cur - prev;
        const pct = prev === 0 ? (cur === 0 ? 0 : 100) : Math.round((diff / prev) * 100);
        // For thumbs_down (and tags_per_100) a decrease is good; otherwise up is good.
        const goodWhenUp = !["thumbs_down", "tags_per_100"].includes(def.key);
        const isGood = diff === 0 ? null : (diff > 0) === goodWhenUp;
        const tone = diff === 0 ? "muted" : (isGood ? "good" : "bad");
        const arrow = diff > 0 ? "▲" : (diff < 0 ? "▼" : "—");
        deltaHtml = `<span class="cmp-delta ${tone}">${arrow} ${Math.abs(pct)}% vs last week</span>`;
      }
      return `
        <div class="cmp-tile">
          <span class="cmp-label">${escapeHtml(def.label)}</span>
          <span class="cmp-value" style="color:${def.color}">${cur != null ? `${cur}${def.suffix || ""}` : "—"}</span>
          ${deltaHtml}
        </div>
      `;
    })
    .join("");
}

function renderActivityChart() {
  if (!els.activityChart) return;
  const weekKeys = orderedWeekKeys();
  const labels = weekKeys.map(shortWeekLabel);
  const applied = weekKeys.map((wk) => (state.autoWeekActivity[wk] || {}).applied || 0);
  const newFiles = weekKeys.map((wk) => (state.autoWeekActivity[wk] || {}).newFiles || 0);
  const legend = `
    <span class="chart-legend-item"><span class="chart-legend-dot" style="background:#4c7df0"></span>Corrections applied</span>
    <span class="chart-legend-item"><span class="chart-legend-dot" style="background:#30a46c"></span>New KB files</span>`;
  const series = [
    { label: "Corrections applied", color: "#4c7df0", values: applied },
    { label: "New KB files", color: "#30a46c", values: newFiles },
  ];
  els.activityChart.innerHTML = `<div class="chart-legend">${legend}</div>${lineChart(series, labels)}`;
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
    stampPatchNotesGenerated().catch(() => { /* non-fatal */ });
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
if (els.saveMetricsBtn) els.saveMetricsBtn.addEventListener("click", () => saveWeeklyMetrics().catch((err) => showToast(err.message)));
if (els.saveGoalsBtn) els.saveGoalsBtn.addEventListener("click", () => saveGoalsFromEditor());
if (els.exportMetricsCsv) els.exportMetricsCsv.addEventListener("click", () => exportMetricsCsv());

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
