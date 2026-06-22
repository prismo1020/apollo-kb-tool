const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed." }, 405);
  }

  const chatbaseApiKey = Deno.env.get("CHATBASE_API_KEY");
  const patchNotesBotId = Deno.env.get("CHATBASE_PATCH_NOTES_BOT_ID");

  if (!chatbaseApiKey) {
    return json({ ok: false, error: "Missing CHATBASE_API_KEY secret." }, 500);
  }
  if (!patchNotesBotId) {
    return json({ ok: false, error: "Missing CHATBASE_PATCH_NOTES_BOT_ID secret." }, 500);
  }

  const body = await request.json();
  const corrections = body.corrections as Array<Record<string, unknown>>;

  if (!corrections || corrections.length === 0) {
    return json({ ok: false, error: "No corrections provided." }, 400);
  }

  const userMessage = buildPatchNotesMessage(corrections);

  const chatbaseResponse = await fetch("https://www.chatbase.co/api/v1/chat", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${chatbaseApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chatbotId: patchNotesBotId,
      messages: [{ role: "user", content: userMessage }],
      stream: false,
    }),
  });

  if (!chatbaseResponse.ok) {
    const errorText = await chatbaseResponse.text();
    return json(
      { ok: false, error: `Chatbase API error: ${chatbaseResponse.status} ${errorText}` },
      502,
    );
  }

  const chatbaseData = await chatbaseResponse.json();
  const patchNotesText = (chatbaseData.text || "").trim();

  return json({ ok: true, patch_notes: patchNotesText });
});

function buildPatchNotesMessage(corrections: Array<Record<string, unknown>>): string {
  const dateRange = getDateRange(corrections);
  const lines = [
    `Generate patch notes for the following ${corrections.length} correction${corrections.length === 1 ? "" : "s"} applied to the Apollo Knowledge Base.`,
    `Date range: ${dateRange}`,
    ``,
    `CORRECTIONS:`,
    ``,
  ];

  corrections.forEach((c, i) => {
    const analysis = (c.analysis as Record<string, unknown>) || {};
    lines.push(`--- Correction #${i + 1} ---`);
    lines.push(`File: ${c.target_file || "Unknown"}`);
    lines.push(`Applied: ${formatDate(c.applied_at as string)}`);
    if (c.question) lines.push(`Question that exposed the error: ${c.question}`);
    if (c.wrong_answer) lines.push(`Wrong answer Apollo gave: ${c.wrong_answer}`);
    if (c.approved_answer) lines.push(`Correct guidance: ${c.approved_answer}`);
    if (analysis.llm_reasoning) lines.push(`KB Editor reasoning: ${analysis.llm_reasoning}`);
    if (analysis.current_problem) lines.push(`Problem identified: ${analysis.current_problem}`);
    const doNotRules = analysis.do_not_rules_added as string[] | undefined;
    if (doNotRules && doNotRules.length > 0) {
      lines.push(`New DO NOT rules added: ${doNotRules.join("; ")}`);
    }
    if (analysis.multi_file) {
      lines.push(`Note: This was a multi-file correction affecting ${analysis.target_count || "multiple"} files.`);
    }
    lines.push(``);
  });

  return lines.join("\n");
}

function formatDate(iso: string): string {
  if (!iso) return "Unknown";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function getDateRange(corrections: Array<Record<string, unknown>>): string {
  const timestamps = corrections
    .map((c) => c.applied_at as string)
    .filter(Boolean)
    .map((d) => new Date(d).getTime())
    .filter((t) => !isNaN(t));

  if (timestamps.length === 0) return "Unknown date range";
  const min = new Date(Math.min(...timestamps));
  const max = new Date(Math.max(...timestamps));
  if (min.toDateString() === max.toDateString()) return formatDate(min.toISOString());
  return `${formatDate(min.toISOString())} – ${formatDate(max.toISOString())}`;
}

function json(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}
