-- Apollo KB Portal public prototype access
-- Run this once in Supabase SQL Editor after schema.sql.
--
-- This removes the sign-in requirement for the prototype portal.
-- Anyone with the portal URL can submit, edit, and approve correction rows.
-- GitHub file writes still happen only in GitHub Actions using repository secrets.

alter table public.apollo_corrections enable row level security;

drop policy if exists "Public prototype can create corrections" on public.apollo_corrections;
create policy "Public prototype can create corrections"
on public.apollo_corrections
for insert
to anon, authenticated
with check (status = 'submitted');

drop policy if exists "Public prototype can read corrections" on public.apollo_corrections;
create policy "Public prototype can read corrections"
on public.apollo_corrections
for select
to anon, authenticated
using (true);

drop policy if exists "Public prototype can update corrections" on public.apollo_corrections;
create policy "Public prototype can update corrections"
on public.apollo_corrections
for update
to anon, authenticated
using (true)
with check (
  status in (
    'submitted',
    'analysis_ready',
    'needs_review',
    'approved',
    'processing',
    'applied',
    'failed',
    'rejected'
  )
);

grant select, insert, update on public.apollo_corrections to anon, authenticated;

alter table public.apollo_maintenance_runs enable row level security;

drop policy if exists "Public prototype can read maintenance runs" on public.apollo_maintenance_runs;
create policy "Public prototype can read maintenance runs"
on public.apollo_maintenance_runs
for select
to anon, authenticated
using (true);

drop policy if exists "Public prototype can log maintenance runs" on public.apollo_maintenance_runs;
create policy "Public prototype can log maintenance runs"
on public.apollo_maintenance_runs
for insert
to anon, authenticated
with check (true);

drop policy if exists "Public prototype can update maintenance runs" on public.apollo_maintenance_runs;
create policy "Public prototype can update maintenance runs"
on public.apollo_maintenance_runs
for update
to anon, authenticated
using (true)
with check (true);

grant select, insert, update on public.apollo_maintenance_runs to anon, authenticated;

