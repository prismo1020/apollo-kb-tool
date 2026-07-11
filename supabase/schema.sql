-- Apollo KB Correction Portal
-- Run this in Supabase SQL Editor.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'apollo_user_role') then
    create type public.apollo_user_role as enum ('submitter', 'reviewer', 'admin');
  end if;

  if not exists (select 1 from pg_type where typname = 'apollo_correction_status') then
    create type public.apollo_correction_status as enum (
      'submitted',
      'analysis_ready',
      'needs_review',
      'approved',
      'processing',
      'applied',
      'failed',
      'rejected'
    );
  end if;
end $$;

create table if not exists public.apollo_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  role public.apollo_user_role not null default 'submitter',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.apollo_corrections (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  submitted_by uuid references auth.users(id) on delete set null,
  submitter_email text,
  reviewer_label text,

  status public.apollo_correction_status not null default 'submitted',
  mode text not null default 'existing' check (mode in ('existing', 'new')),

  question text not null default '',
  wrong_answer text not null default '',
  approved_answer text not null default '',
  category text not null default '',
  reviewer_notes text not null default '',

  target_file text,
  target_section_heading text,
  current_section text,
  proposed_replacement text,
  new_topic text,
  new_purpose text,
  analysis jsonb not null default '{}'::jsonb,

  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  applied_at timestamptz,
  github_commit_sha text,
  github_commit_url text,
  failure_reason text
);

create table if not exists public.apollo_correction_events (
  id bigserial primary key,
  correction_id uuid not null references public.apollo_corrections(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

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

create index if not exists apollo_corrections_status_idx
  on public.apollo_corrections(status, created_at);

create index if not exists apollo_corrections_submitted_by_idx
  on public.apollo_corrections(submitted_by, created_at desc);

create index if not exists apollo_maintenance_runs_completed_at_idx
  on public.apollo_maintenance_runs(completed_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_apollo_profiles_updated_at on public.apollo_profiles;
create trigger set_apollo_profiles_updated_at
before update on public.apollo_profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_apollo_corrections_updated_at on public.apollo_corrections;
create trigger set_apollo_corrections_updated_at
before update on public.apollo_corrections
for each row execute function public.set_updated_at();

create or replace function public.handle_new_apollo_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.apollo_profiles (user_id, email, display_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'full_name', split_part(coalesce(new.email, ''), '@', 1)),
    'submitter'
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_apollo_profile on auth.users;
create trigger on_auth_user_created_apollo_profile
after insert on auth.users
for each row execute function public.handle_new_apollo_user();

create or replace function public.set_apollo_correction_defaults()
returns trigger
language plpgsql
as $$
begin
  if new.submitted_by is null then
    new.submitted_by = auth.uid();
  end if;

  if nullif(new.submitter_email, '') is null then
    new.submitter_email = coalesce(auth.jwt()->>'email', '');
  end if;

  if TG_OP = 'UPDATE'
    and new.status = 'approved'
    and old.status is distinct from 'approved'
  then
    new.approved_by = auth.uid();
    new.approved_at = now();
  end if;

  return new;
end;
$$;

drop trigger if exists set_apollo_correction_defaults_insert on public.apollo_corrections;
create trigger set_apollo_correction_defaults_insert
before insert on public.apollo_corrections
for each row execute function public.set_apollo_correction_defaults();

drop trigger if exists set_apollo_correction_defaults_update on public.apollo_corrections;
create trigger set_apollo_correction_defaults_update
before update on public.apollo_corrections
for each row execute function public.set_apollo_correction_defaults();

create or replace function public.is_apollo_reviewer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.apollo_profiles
    where user_id = auth.uid()
      and role in ('reviewer', 'admin')
  );
$$;

create or replace function public.is_apollo_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.apollo_profiles
    where user_id = auth.uid()
      and role = 'admin'
  );
$$;

alter table public.apollo_profiles enable row level security;
alter table public.apollo_corrections enable row level security;
alter table public.apollo_correction_events enable row level security;
alter table public.apollo_maintenance_runs enable row level security;

drop policy if exists "Users can read their profile" on public.apollo_profiles;
create policy "Users can read their profile"
on public.apollo_profiles
for select
to authenticated
using (user_id = auth.uid() or public.is_apollo_reviewer());

drop policy if exists "Admins can manage profiles" on public.apollo_profiles;
create policy "Admins can manage profiles"
on public.apollo_profiles
for all
to authenticated
using (public.is_apollo_admin())
with check (public.is_apollo_admin());

drop policy if exists "Authenticated users can create corrections" on public.apollo_corrections;
create policy "Authenticated users can create corrections"
on public.apollo_corrections
for insert
to authenticated
with check (
  submitted_by = auth.uid()
  and status = 'submitted'
);

drop policy if exists "Authenticated users can read corrections" on public.apollo_corrections;
create policy "Authenticated users can read corrections"
on public.apollo_corrections
for select
to authenticated
using (true);

drop policy if exists "Submitters can update their unapproved corrections" on public.apollo_corrections;
create policy "Submitters can update their unapproved corrections"
on public.apollo_corrections
for update
to authenticated
using (
  submitted_by = auth.uid()
  and status in ('submitted', 'analysis_ready', 'needs_review', 'failed')
)
with check (
  submitted_by = auth.uid()
  and status in ('submitted', 'analysis_ready', 'needs_review')
);

drop policy if exists "Reviewers can update correction queue" on public.apollo_corrections;
create policy "Reviewers can update correction queue"
on public.apollo_corrections
for update
to authenticated
using (public.is_apollo_reviewer())
with check (public.is_apollo_reviewer());

drop policy if exists "Authenticated users can read correction events" on public.apollo_correction_events;
create policy "Authenticated users can read correction events"
on public.apollo_correction_events
for select
to authenticated
using (true);

drop policy if exists "Reviewers can create correction events" on public.apollo_correction_events;
create policy "Reviewers can create correction events"
on public.apollo_correction_events
for insert
to authenticated
with check (public.is_apollo_reviewer());

drop policy if exists "Authenticated users can read maintenance runs" on public.apollo_maintenance_runs;
create policy "Authenticated users can read maintenance runs"
on public.apollo_maintenance_runs
for select
to authenticated
using (true);

drop policy if exists "Reviewers can manage maintenance runs" on public.apollo_maintenance_runs;
create policy "Reviewers can manage maintenance runs"
on public.apollo_maintenance_runs
for all
to authenticated
using (public.is_apollo_reviewer())
with check (public.is_apollo_reviewer());

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update on public.apollo_profiles to authenticated, service_role;
grant select, insert, update on public.apollo_corrections to authenticated, service_role;
grant select, insert on public.apollo_correction_events to authenticated, service_role;
grant select, insert, update on public.apollo_maintenance_runs to authenticated, service_role;
grant usage, select on sequence public.apollo_correction_events_id_seq to authenticated, service_role;

-- After your first admin user signs up, run this with their email:
-- update public.apollo_profiles
-- set role = 'admin'
-- where email = 'YOUR_EMAIL_HERE';
