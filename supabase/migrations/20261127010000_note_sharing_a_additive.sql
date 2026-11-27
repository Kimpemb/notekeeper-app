-- supabase/migrations/20261127010000_note_sharing_a_additive.sql
--
-- M2.1: note sharing, migration file A (ADDITIVE ONLY). New tables and columns.
-- No policy, trigger or function is changed here (that is file B), so this file
-- can be applied and rolled back on its own. notes_public_read stays in place until B.
--
-- Safe to re-run: every statement is idempotent.
-- Every new table enables RLS explicitly (F22): with no policy yet, it is deny-all
-- for everyone except the service role, which is the safe default until file B.
--
-- Rollback (manual, only if nothing depends on it yet):
--   drop table publish_block_map, publish_links, publish_shares, team_shared_roots,
--              team_members, teams, profiles;
--   alter table notes drop column share_root_id, drop column rag_excluded,
--              drop column source_type, drop column updated_by;
--   alter table note_shares drop column via_team_id, drop column role, drop column trust;

-- ============================================================
-- notes: new columns
-- ============================================================
-- share_root_id: set by server triggers (file B) on every shared note; on the root it
-- points to itself. Never sent by the client (decision 160).
alter table public.notes add column if not exists share_root_id text
  references public.notes(id) on delete set null;

-- rag_excluded / source_type: pushed from the local app (M2.3). Existing rows stay null /
-- false and are corrected on their next push. A note with source_type null is never shareable.
alter table public.notes add column if not exists rag_excluded boolean not null default false;
alter table public.notes add column if not exists source_type text;

-- updated_by: set by a server trigger from auth.uid() in file B (decision 180).
alter table public.notes add column if not exists updated_by uuid
  references auth.users(id) on delete set null;

create index if not exists idx_notes_share_root_id
  on public.notes(share_root_id) where share_root_id is not null;

-- ============================================================
-- note_shares: role, trust, team provenance
-- ============================================================
alter table public.note_shares add column if not exists via_team_id uuid;
alter table public.note_shares add column if not exists role text not null default 'read';
alter table public.note_shares add column if not exists trust text not null default 'review';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'note_shares_role_check') then
    alter table public.note_shares
      add constraint note_shares_role_check check (role in ('read', 'suggest', 'edit'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'note_shares_trust_check') then
    alter table public.note_shares
      add constraint note_shares_trust_check check (trust in ('review', 'trusted'));
  end if;
end
$$;

create index if not exists idx_note_shares_user_id on public.note_shares(user_id);

-- ============================================================
-- profiles (handles)
-- ============================================================
create table if not exists public.profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  handle       text not null unique check (handle ~ '^[a-z0-9_]{3,30}$'),
  display_name text,
  created_at   timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- ============================================================
-- teams
-- ============================================================
create table if not exists public.teams (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_teams_owner_id on public.teams(owner_id);
alter table public.teams enable row level security;

create table if not exists public.team_members (
  team_id  uuid not null references public.teams(id) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index if not exists idx_team_members_user_id on public.team_members(user_id);
alter table public.team_members enable row level security;

create table if not exists public.team_shared_roots (
  team_id   uuid not null references public.teams(id) on delete cascade,
  root_id   text not null references public.notes(id) on delete cascade,
  role      text not null default 'read' check (role in ('read', 'suggest', 'edit')),
  shared_by uuid not null references auth.users(id) on delete cascade,
  added_at  timestamptz not null default now(),
  primary key (team_id, root_id)
);
create index if not exists idx_team_shared_roots_root_id on public.team_shared_roots(root_id);
alter table public.team_shared_roots enable row level security;

-- note_shares.via_team_id now has a table to point at.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'note_shares_via_team_id_fkey') then
    alter table public.note_shares
      add constraint note_shares_via_team_id_fkey
      foreign key (via_team_id) references public.teams(id) on delete cascade;
  end if;
end
$$;

-- ============================================================
-- published copies: share state, per-note links, block map
-- ============================================================
create table if not exists public.publish_shares (
  root_copy_id   text primary key references public.notes(id) on delete cascade,
  owner_id       uuid not null references auth.users(id) on delete cascade,
  source_root_id text,
  state          text not null default 'linked' check (state in ('linked', 'unlinked')),
  created_at     timestamptz not null default now()
);
create index if not exists idx_publish_shares_owner_id on public.publish_shares(owner_id);
alter table public.publish_shares enable row level security;

-- source_note_id has no foreign key on purpose: the source may be trashed or purged,
-- and the app shows "source missing" instead of losing the link.
create table if not exists public.publish_links (
  copy_note_id                  text primary key references public.notes(id) on delete cascade,
  root_copy_id                  text not null references public.publish_shares(root_copy_id) on delete cascade,
  owner_id                      uuid not null references auth.users(id) on delete cascade,
  source_note_id                text not null,
  last_published_source_revision integer not null default 0
);
create index if not exists idx_publish_links_root_copy_id on public.publish_links(root_copy_id);
create index if not exists idx_publish_links_source_note_id on public.publish_links(source_note_id);
create index if not exists idx_publish_links_owner_id on public.publish_links(owner_id);
alter table public.publish_links enable row level security;

-- Block map (Q4 default: hosted, so the author's second device can publish too).
create table if not exists public.publish_block_map (
  copy_note_id    text not null references public.notes(id) on delete cascade,
  source_block_id text not null,
  copy_block_id   text not null,
  primary key (copy_note_id, source_block_id)
);
alter table public.publish_block_map enable row level security;
