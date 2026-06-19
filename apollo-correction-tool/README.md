# Apollo Correction Console

A local approval tool for updating the Apollo Chatbase knowledge base.

## What It Does

- Scans the `.docx` knowledge-base files in the parent Apollo KB folder.
- Accepts a bad Apollo answer, optional approved answer, notes, category, and reviewer.
- Recommends the closest matching KB file and section.
- Shows the current section beside an editable proposed replacement.
- Replaces the approved section in the selected `.docx` file after confirmation.
- Supports a small batch queue for reviewing 5-10 corrections in one sitting.
- Creates a timestamped backup before modifying an existing document.
- Creates a new `.docx` file when the correction has no good existing home.
- Logs approved changes in `apollo-correction-tool/data/`.
- Excludes `Master List/` from editable targets so reference rollups do not outrank source KB files.

## Branding

The portal looks for this logo file:

```text
apollo-correction-tool/static/sandbox-logo-black.png
```

If that image is not present yet, it falls back to a simple black `SANDBOX VR` wordmark.

## Run Locally

Open PowerShell in this folder and run:

```powershell
.\Start-Apollo-Correction-Console.ps1
```

Or run the server directly:

Use the Python runtime that has `python-docx` installed:

```powershell
C:\Users\danie\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe .\apollo-correction-tool\server.py --port 8787
```

Then open:

```text
http://127.0.0.1:8787
```

## Write Behavior

Batch workflow:

- Fill out one correction.
- Select `Add to Batch`.
- Repeat for the remaining corrections.
- Select `Analyze Batch`.
- Review and approve each analyzed correction one at a time.

Existing-file approvals:

- Back up the original file into `_apollo_backups/YYYYMMDD/`.
- Replace the selected KB section with the reviewed replacement section.
- Store the old section and new section in the JSONL audit log.
- Record the approval in JSONL and CSV logs.

New-file approvals:

- Create a numbered `.docx` file in the KB root.
- Add Apollo formatting rules, a purpose section, usage guidance, and the approved correction.
- Record the approval in JSONL and CSV logs.

## Hosted Team Version

GitHub Pages can host the front end, but it cannot write `.docx` files directly. The production version should use:

- GitHub Pages for the interface.
- Supabase for submitted corrections, user identity, review state, and audit history.
- GitHub Actions for approved KB writes and pull requests.
- The KB files stored in a GitHub repository.

The local app is intentionally shaped around the same approve-and-write workflow so it can be upgraded to the hosted version without changing how the team uses it.
