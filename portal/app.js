const config = window.APOLLO_CONFIG || {};
const supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);

const state = {
  user: null,
  profile: null,
  drafts: [],
  corrections: [],
  selectedId: null,
  mode: "existing",
};

const els = {
  authPanel: document.getElementById("authPanel"),
  emailInput: document.getElementById("emailInput"),
  sendMagicLink: document.getElementById("sendMagicLink"),
  userEmail: document.getElementById("userEmail"),
  userRole: document.getElementById("userRole"),
  syncState: document.getElementById("syncState"),
  form: document.getElementById("correctionForm"),
  question: document.getElementById("question"),
  wrongAnswer: document.getElementById("wrongAnswer"),
  approvedAnswer: document.getElementById("approvedAnswer"),
  category: document.getElementById("category"),
  reviewerLabel: document.getElementById("reviewerLabel"),
  reviewerNotes: document.getElementById("reviewerNotes"),
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
  commitLink: document.getElementById("commitLink"),
  activityList: document.getElementById("activityList"),
  confirmLayer: document.getElementById("confirmLayer"),
  confirmText: document.getElementById("confirmText"),
  reviewedCheck: document.getElementById("reviewedCheck"),
  confirmApprove: document.getElementById("confirmApprove"),
  cancelConfirm: document.getElementById("cancelConfirm"),
  toast: document.getElementById("toast"),
};

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.add("hidden"), 4200);
}

function setSync(text) {
  els.syncState.textContent = text;
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

function isReviewer() {
  return ["reviewer", "admin"].includes(state.profile?.role);
}

function formPayload() {
  return {
    question: els.question.value.trim(),
    wrong_answer: els.wrongAnswer.value.trim(),
    approved_answer: els.approvedAnswer.value.trim(),
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
  els.reviewerNotes.value = "";
  if (!keepMeta) {
    els.category.value = "";
    els.reviewerLabel.value = "";
  }
}

function renderBatch() {
  els.batchCount.textContent = `${state.drafts.length} pending`;
  els.submitBatch.disabled = !state.drafts.length || !state.user;
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
    submitted_by: state.user.id,
    submitter_email: state.user.email || "",
    status: "submitted",
    mode: "existing",
  };
}

async function submitRows(rows) {
  if (!state.user) {
    showToast("Sign in before submitting corrections.");
    return;
  }
  setSync("Submitting");
  const { error } = await supabaseClient.from("apollo_corrections").insert(rows);
  if (error) throw error;
  setSync("Ready");
  showToast(rows.length === 1 ? "Correction submitted." : `${rows.length} corrections submitted.`);
  await loadCorrections();
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

function statusLabel(status) {
  return String(status || "submitted").replaceAll("_", " ");
}

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

function renderActivity() {
  const applied = state.corrections.filter((item) => ["applied", "failed", "processing"].includes(item.status));
  if (!applied.length) {
    els.activityList.innerHTML = '<div class="recent-item muted">No applied updates yet.</div>';
    return;
  }
  els.activityList.innerHTML = applied
    .map((item) => `
      <div class="recent-item">
        <span>${escapeHtml(new Date(item.updated_at).toLocaleString())}</span>
        <strong>${escapeHtml(item.target_file || "No target file")}</strong>
        <span>${escapeHtml(statusLabel(item.status))}</span>
      </div>
    `)
    .join("");
}

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

  els.commitLink.classList.toggle("hidden", !item.github_commit_url);
  if (item.github_commit_url) {
    els.commitLink.href = item.github_commit_url;
  }

  const canApprove = isReviewer() && ["analysis_ready", "needs_review", "failed"].includes(item.status);
  els.openConfirm.disabled = !canApprove;
  els.saveDraft.disabled = !isReviewer();
}

async function loadCorrections() {
  if (!state.user) return;
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
  renderActivity();
  setSync("Ready");
}

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
  setSync("Ready");
  showToast(statusOverride === "approved" ? "Correction approved." : "Draft saved.");
  await loadCorrections();
}

function openConfirm() {
  const item = selectedCorrection();
  if (!item) return;
  if (!isReviewer()) {
    showToast("Only reviewers can approve KB updates.");
    return;
  }
  if (!els.proposedReplacement.value.trim()) {
    showToast("Add proposed replacement guidance before approving.");
    return;
  }
  if (state.mode === "existing" && (!els.targetFile.value.trim() || !els.targetSection.value.trim())) {
    showToast("Existing file updates need a target file and section heading.");
    return;
  }

  const target = state.mode === "new" ? "a new KB file" : `${els.targetFile.value.trim()} (${els.targetSection.value.trim()})`;
  els.confirmText.textContent = `This will mark the correction approved. GitHub Actions will update ${target} and commit the changed KB file.`;
  els.reviewedCheck.checked = false;
  els.confirmApprove.disabled = true;
  els.confirmLayer.classList.remove("hidden");
}

async function loadProfile() {
  const { data: sessionData } = await supabaseClient.auth.getSession();
  state.user = sessionData.session?.user || null;
  if (!state.user) {
    els.authPanel.classList.remove("hidden");
    els.userEmail.textContent = "Not yet";
    els.userRole.textContent = "Use email login to start.";
    setSync("Sign in");
    return;
  }

  els.authPanel.classList.add("hidden");
  els.userEmail.textContent = state.user.email || "Signed in";

  let { data, error } = await supabaseClient
    .from("apollo_profiles")
    .select("*")
    .eq("user_id", state.user.id)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    await new Promise((resolve) => window.setTimeout(resolve, 900));
    const retry = await supabaseClient
      .from("apollo_profiles")
      .select("*")
      .eq("user_id", state.user.id)
      .maybeSingle();
    data = retry.data;
    error = retry.error;
    if (error) throw error;
  }

  state.profile = data || { role: "submitter" };
  els.userRole.textContent = state.profile.role || "submitter";
  await loadCorrections();
}

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
    button.classList.add("active");
    document.getElementById(`${button.dataset.view}View`).classList.add("active");
  });
});

els.sendMagicLink.addEventListener("click", async () => {
  try {
    const email = els.emailInput.value.trim();
    if (!email) {
      showToast("Enter your email first.");
      return;
    }
    setSync("Sending");
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const { error } = await supabaseClient.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) throw error;
    setSync("Check email");
    showToast("Magic link sent.");
  } catch (error) {
    setSync("Sign in");
    showToast(error.message);
  }
});

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const payload = formPayload();
    if (!hasContent(payload)) {
      showToast("Add a question, wrong answer, or approved guidance first.");
      return;
    }
    await submitRows([rowForInsert(payload)]);
    clearCorrectionFields(true);
  } catch (error) {
    setSync("Ready");
    showToast(error.message);
  }
});

els.addToBatch.addEventListener("click", addToBatch);
els.submitBatch.addEventListener("click", async () => {
  try {
    await submitRows(state.drafts.map(rowForInsert));
    state.drafts = [];
    renderBatch();
  } catch (error) {
    setSync("Ready");
    showToast(error.message);
  }
});
els.clearBatch.addEventListener("click", () => {
  state.drafts = [];
  renderBatch();
});
els.clearForm.addEventListener("click", () => clearCorrectionFields(false));
els.refreshQueue.addEventListener("click", () => loadCorrections().catch((error) => showToast(error.message)));
els.statusFilter.addEventListener("change", () => loadCorrections().catch((error) => showToast(error.message)));
els.modeExisting.addEventListener("click", () => setMode("existing"));
els.modeNew.addEventListener("click", () => setMode("new"));
els.saveDraft.addEventListener("click", () => saveSelected().catch((error) => showToast(error.message)));
els.openConfirm.addEventListener("click", openConfirm);
els.cancelConfirm.addEventListener("click", () => els.confirmLayer.classList.add("hidden"));
els.reviewedCheck.addEventListener("change", () => {
  els.confirmApprove.disabled = !els.reviewedCheck.checked;
});
els.confirmApprove.addEventListener("click", () => {
  saveSelected("approved")
    .then(() => {
      els.confirmLayer.classList.add("hidden");
    })
    .catch((error) => showToast(error.message));
});

supabaseClient.auth.onAuthStateChange(() => {
  loadProfile().catch((error) => showToast(error.message));
});

renderBatch();
loadProfile().catch((error) => {
  setSync("Needs attention");
  showToast(error.message);
});
