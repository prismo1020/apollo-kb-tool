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

  const githubToken = Deno.env.get("GITHUB_WORKFLOW_TOKEN");
  const repository = Deno.env.get("GITHUB_REPOSITORY") || "prismo1020/apollo-kb-tool";
  const workflowFile = Deno.env.get("GITHUB_WORKFLOW_FILE") || "apollo-kb-automation.yml";
  const ref = Deno.env.get("GITHUB_WORKFLOW_REF") || "main";

  if (!githubToken) {
    return json({ ok: false, error: "Missing GITHUB_WORKFLOW_TOKEN secret." }, 500);
  }

  const response = await fetch(
    `https://api.github.com/repos/${repository}/actions/workflows/${workflowFile}/dispatches`,
    {
      method: "POST",
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${githubToken}`,
        "Content-Type": "application/json",
        "User-Agent": "apollo-kb-portal",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    return json(
      {
        ok: false,
        error: `GitHub rejected workflow dispatch: ${response.status} ${errorText}`,
      },
      502,
    );
  }

  return json({
    ok: true,
    message: "Apollo KB automation workflow queued.",
    repository,
    workflowFile,
    ref,
  });
});

function json(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
