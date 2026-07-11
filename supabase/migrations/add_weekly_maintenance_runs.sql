-- Migration: add shared weekly maintenance confirmations.
-- Run this in the Supabase SQL Editor for the existing apollo-kb-tool project.

create extension if not exists pgcrypto;

create table if not exists public.apollo_maintenance_runs (
  id uuid primary key default gen_random_uuid(),
  week_start date not null unique,
  week_end date not null,
  completed_at timestamptz not null default now(),
  completed_by text not null default 'Kenneth',
  checklist jsonb not null default '[]'::jsonb,
  notes text not null default '',
  source text not null default 'portal',
  created_at timestamptz not null default now()
);

create index if not exists apollo_maintenance_runs_completed_at_idx
  on public.apollo_maintenance_runs(completed_at desc);

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

grant select, insert, update on public.apollo_maintenance_runs to anon, authenticated, service_role;

