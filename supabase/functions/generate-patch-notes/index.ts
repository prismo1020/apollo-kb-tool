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
  const apolloBotId = Deno.env.get("CHATBASE_APOLLO_BOT_ID");

  if (!chatbaseApiKey) {
    return json({ ok: false, error: "Missing CHATBASE_API_KEY secret." }, 500);
  }
  if (!apolloBotId) {
    return json({ ok: false, error: "Missing CHATBASE_APOLLO_BOT_ID secret." }, 500);
  }

  const body = await request.json();
  const corrections = body.corrections as Array<Record<string, unknown>>;

  if (!corrections || corrections.length === 0) {
    return json({ ok: false, error: "No corrections provided." }, 400);
  }

  // Chatbase rejects any single message longer than 8000 characters, so we
  // split the corrections into batches whose built message stays under the
  // limit, call Chatbase once per batch, then stitch the results together.
  const batches = batchCorrections(corrections);
  const dateRange = getDateRange(corrections);
  const sections: string[] = [];

  for (let b = 0; b < batches.length; b++) {
    const userMessage = buildPatchNotesMessage(
      batches[b],
      dateRange,
      corrections.length,
      batches.length > 1 ? { part: b + 1, total: batches.length } : undefined,
    );

    const chatbaseResponse = await fetch("https://www.chatbase.co/api/v1/chat", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${chatbaseApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chatbotId: apolloBotId,
        messages: [{ role: "user", content: userMessage }],
        stream: false,
      }),
    });

    if (!chatbaseResponse.ok) {
      const errorText = await chatbaseResponse.text();
      return json(
        {
          ok: false,
          error: `Chatbase API error (batch ${b + 1}/${batches.length}, ${userMessage.length} chars): ${chatbaseResponse.status} ${errorText}`,
        },
        502,
      );
    }

    const chatbaseData = await chatbaseResponse.json();
    const text = (chatbaseData.text || "").trim();
    if (text) sections.push(text);
  }

  const patchNotesText = sections.join(
    "\n\n────────────────────────────────────────────────────────────────────────────────\n\n",
  );

  return json({ ok: true, patch_notes: patchNotesText });
});

// Max characters for a single Chatbase message. Chatbase's hard limit is 8000;
// we leave headroom for the header/framing lines added per batch.
const MAX_MSG_CHARS = 7000;
// Cap on any single free-text field so one huge correction can't blow the budget.
const FIELD_CAP = 500;

function truncate(value: unknown, cap = FIELD_CAP): string {
  const s = String(value ?? "").trim();
  return s.length > cap ? s.slice(0, cap) + " […]" : s;
}

function buildCorrectionBlock(c: Record<string, unknown>, index: number): string {
  const analysis = (c.analysis as Record<string, unknown>) || {};
  const lines = [
    `--- Correction #${index + 1} ---`,
    `File: ${c.target_file || "Unknown"}`,
    `Applied: ${formatDate(c.applied_at as string)}`,
  ];
  if (c.question) lines.push(`Question that exposed the error: ${truncate(c.question)}`);
  if (c.wrong_answer) lines.push(`Wrong answer Apollo gave: ${truncate(c.wrong_answer)}`);
  if (c.approved_answer) lines.push(`Correct guidance: ${truncate(c.approved_answer)}`);
  if (analysis.llm_reasoning) lines.push(`KB Editor reasoning: ${truncate(analysis.llm_reasoning)}`);
  if (analysis.current_problem) lines.push(`Problem identified: ${truncate(analysis.current_problem)}`);
  const doNotRules = analysis.do_not_rules_added as string[] | undefined;
  if (doNotRules && doNotRules.length > 0) {
    lines.push(`New DO NOT rules added: ${truncate(doNotRules.join("; "))}`);
  }
  if (analysis.multi_file) {
    lines.push(`Note: This was a multi-file correction affecting ${analysis.target_count || "multiple"} files.`);
  }
  return lines.join("\n");
}

// Group corrections so each batch's rendered message stays under MAX_MSG_CHARS.
function batchCorrections(
  corrections: Array<Record<string, unknown>>,
): Array<Array<Record<string, unknown>>> {
  const HEADER_BUDGET = 400; // rough allowance for the framing lines per batch
  const batches: Array<Array<Record<string, unknown>>> = [];
  let current: Array<Record<string, unknown>> = [];
  let currentLen = HEADER_BUDGET;

  for (const c of corrections) {
    const blockLen = buildCorrectionBlock(c, 0).length + 2;
    if (current.length > 0 && currentLen + blockLen > MAX_MSG_CHARS) {
      batches.push(current);
      current = [];
      currentLen = HEADER_BUDGET;
    }
    current.push(c);
    currentLen += blockLen;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function buildPatchNotesMessage(
  corrections: Array<Record<string, unknown>>,
  dateRange: string,
  totalCount: number,
  part?: { part: number; total: number },
): string {
  const partNote = part
    ? ` (part ${part.part} of ${part.total} — write patch notes only for the corrections in this batch; another part covers the rest)`
    : "";
  const lines = [
    `ROLE: PATCH_NOTES_WRITER`,
    ``,
    `Generate patch notes for the following ${corrections.length} correction${corrections.length === 1 ? "" : "s"} applied to the Apollo Knowledge Base${partNote}.`,
    `Date range: ${dateRange}`,
    ``,
    `CORRECTIONS:`,
    ``,
  ];

  corrections.forEach((c, i) => {
    lines.push(buildCorrectionBlock(c, i));
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
