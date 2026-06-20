# Supabase Setup for Apollo KB Correction Portal

This setup keeps the browser safe:

- The portal uses the Supabase anon key only.
- Row Level Security is enabled on all public tables.
- The GitHub Action uses the service role key privately as a GitHub secret.
- The browser never receives a GitHub token or Supabase service role key.

## 1. Create the Supabase Project

1. Go to https://supabase.com/dashboard/projects
2. Click New project.
3. Name it `apollo-kb-tool`.
4. Choose a strong database password and save it somewhere safe.
5. Pick the nearest region.
6. Create the project and wait for it to finish provisioning.

## 2. Run the Database SQL

1. Open the Supabase project.
2. Go to SQL Editor.
3. Create a new query.
4. Paste everything from `supabase/schema.sql`.
5. Click Run.

For the open-link prototype, also run `supabase/public_access.sql`. This removes the sign-in requirement so anyone with the portal URL can submit and approve correction rows.

## 3. Enable Login

The simplest first version is email login.

1. Go to Authentication > Providers.
2. Enable Email.
3. For early testing, magic link login is easiest.
4. After the GitHub Pages URL exists, add it under Authentication > URL Configuration.

Expected URLs later:

- Site URL: `https://prismo1020.github.io/apollo-kb-tool`
- Redirect URL: `https://prismo1020.github.io/apollo-kb-tool/**`

If GitHub Pages is unavailable for the private repo, we will use the deployed frontend URL instead.

## 4. Create Your Admin User

1. Sign into the portal once after we connect the frontend.
2. In Supabase, go to Table Editor > `apollo_profiles`.
3. Confirm your email appears.
4. Or run this SQL, replacing the email:

```sql
update public.apollo_profiles
set role = 'admin'
where email = 'YOUR_EMAIL_HERE';
```

Admins and reviewers can approve corrections. Submitters can create corrections and update their own unapproved items.

## 5. Copy These Values for Codex

Go to Project Settings > Data API.

Send Codex:

- Project URL
- `anon` public key

Do not paste the service role key into chat unless you intentionally want to. We can add it directly as a GitHub Actions secret from the GitHub website.

## 6. Add GitHub Secrets Later

In GitHub:

1. Open `prismo1020/apollo-kb-tool`.
2. Go to Settings > Secrets and variables > Actions.
3. Add these repository secrets:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

The service role key is required only for the GitHub Action that writes applied status and commit metadata back to Supabase.

## 7. Deploy the Force Automation Button

The portal's `Run Automation Now` button uses a Supabase Edge Function so the browser never sees a GitHub token.

Create a GitHub fine-grained personal access token:

1. Go to GitHub > Settings > Developer settings > Personal access tokens > Fine-grained tokens.
2. Create a token for `prismo1020/apollo-kb-tool`.
3. Give it repository permission for Actions: Read and write.
4. Copy the token once.

In Supabase:

1. Go to Edge Functions > Secrets.
2. Add:

```text
GITHUB_WORKFLOW_TOKEN = the GitHub token
GITHUB_REPOSITORY = prismo1020/apollo-kb-tool
GITHUB_WORKFLOW_FILE = apollo-kb-automation.yml
GITHUB_WORKFLOW_REF = main
```

Then deploy the function:

```powershell
supabase functions deploy run-kb-automation --project-ref lexjlvnrqzplxthwkwfp
```

## 8. Hosted Flow

1. Team member submits a correction in the portal.
2. Supabase stores it as `submitted`.
3. GitHub Actions analyzes submitted rows against the KB files and stores a proposed edit.
4. Reviewer checks the before/after text and approves with the confirmation bubble.
5. GitHub Actions applies approved corrections to the `.docx` files and commits the update.
6. Supabase marks the correction as `applied` with the GitHub commit link.

The first automated version will run on a short schedule and by manual button in GitHub Actions. We can later make approval trigger instantly with a Supabase Edge Function.
