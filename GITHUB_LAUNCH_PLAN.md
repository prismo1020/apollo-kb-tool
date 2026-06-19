# Apollo KB Tool - GitHub Launch Plan

This folder is being prepared to move from a local-only correction console to a team-accessible workflow.

## Current Local Tool

- `apollo-correction-tool/` runs a local Python server.
- It scans the `.docx` KB files.
- It supports single corrections and batch review.
- Approved existing-file edits replace matched KB sections and create backups.

## Recommended Hosted Architecture

GitHub Pages cannot edit `.docx` files directly, so the hosted version should split responsibilities:

1. **GitHub repository**
   - Stores the Apollo KB `.docx` files.
   - Stores the hosted portal source.
   - Runs GitHub Actions.

2. **GitHub Pages**
   - Hosts the team-facing correction portal.
   - Lets staff submit and review corrections.

3. **Supabase**
   - Stores correction submissions, approval state, reviewer metadata, and audit history.
   - Provides login/auth for team users.

4. **GitHub Actions**
   - Runs the trusted `.docx` updater after approval.
   - Commits updated KB files or opens a pull request.
   - Keeps GitHub write tokens out of the browser.

## Authorization Needed

One of these needs to happen before Codex can publish this repo:

- Authorize the GitHub connector in Codex so it can see at least one installed account/repo.
- Or sign in locally with GitHub CLI:

```powershell
gh auth login --hostname github.com --git-protocol https --web --scopes repo,workflow
```

The current sandbox blocked direct network access to GitHub, so this login must be allowed by Codex permissions or completed manually outside the sandbox.

## Next Implementation Step

After GitHub auth is working:

1. Create a private GitHub repo, likely `apollo-kb-tool`.
2. Push this folder to the repo.
3. Create a Supabase project.
4. Add Supabase environment values to the hosted frontend.
5. Add the GitHub Action that applies approved corrections.
6. Enable GitHub Pages for the portal.
