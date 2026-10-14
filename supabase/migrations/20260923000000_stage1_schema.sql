-- Stage 1 — Data Model / Schema Design
-- Idemora Custom Sync Engine
--
-- Mirrors the confirmed local SQLite schema (idemora.db) for notes,
-- calendar_events, goals, goal_milestones, and block_revision_snapshots,
-- then adds what only makes sense server-side: owner_id (multi-tenant),
-- shares/share_members (calendar + goal sharing), note_shares (note team
-- membership), and RLS policies.
--
-- Divergence from the original Note Publishing doc: note_publishes /
-- note_imports were never built as separate tables in the real app —
-- publish/fork state lives directly on `notes`. This migration mirrors
-- that, not the doc's original normalized design.

create extension if not exists "pgcrypto";

-- ============================================================
-- notes
-- ============================================================
create table notes (
  id                    text primary key,
  owner_id              uuid not null references auth.users(id) on delete cascade,
  title                 text not null default 'Untitled',
  content               text not null default '{}',
  plaintext             text not null default '',
  tags                  text,
  parent_id             text references notes(id) on delete set null,
  sort_order            integer not null default 0,
  frontmatter           text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,

  -- sync engine
  revision              integer not null default 0,

  -- publish/fork state (folded onto notes, matching the real local schema —
  -- not split into note_publishes/note_imports as originally doc'd)
  is_published          boolean not null default false,
  publish_visibility    text check (publish_visibility in ('team', 'public')),
  publish_token         text unique,
  forked_from_note_id   text,
  forked_from_owner_id  uuid,
  fork_base_revision    integer
);

create index idx_notes_owner_id on notes(owner_id);
create index idx_notes_parent_id on notes(parent_id);
create index idx_notes_updated_at on notes(updated_at desc);
create index idx_notes_publish_token on notes(publish_token) where publish_token is not null;

-- revision bump on content change (mirrors the SQLite trigger)
create or replace function bump_note_revision()
returns trigger as $$
begin
  if new.content is distinct from old.content then
    new.revision := old.revision + 1;
    new.updated_at := now();
  end if;
  return new;
end;
$$ language plpgsql;

create trigger notes_revision_bump
  before update of content on notes
  for each row
  execute function bump_note_revision();

-- ============================================================
-- calendar_events
-- ============================================================
create table calendar_events (
  id              text primary key,
  owner_id        uuid not null references auth.users(id) on delete cascade,
  title           text not null,
  date            text not null,
  time            text,
  duration_mins   integer,
  category        text not null default 'personal',
  source_id       text,
  source_type     text,
  colour_state    text not null default 'blue',
  recurrence      text,
  recurrence_end  text,
  notes           text,
  linked_note_id  text references notes(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_calendar_events_owner_id on calendar_events(owner_id);
create index idx_calendar_events_date on calendar_events(date);

-- ============================================================
-- goals
-- ============================================================
create table goals (
  id                          text primary key,
  owner_id                    uuid not null references auth.users(id) on delete cascade,
  title                       text not null,
  description                 text,
  start_date                  text not null,
  target_date                 text not null,
  colour_state                text not null default 'blue',
  progress                    integer not null default 0,
  category                    text,
  goal_class                  text check (goal_class in
                                ('deep_work','quick_task','deadline_driven','maintenance','finish_this','flexible'))
                                default 'flexible',
  significance                integer check (significance between 1 and 10) default 5,
  estimated_duration_minutes  integer,
  last_progress_at            timestamptz,
  deep_work_protected         boolean not null default true,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index idx_goals_owner_id on goals(owner_id);

-- ============================================================
-- goal_milestones
-- ============================================================
create table goal_milestones (
  id            text primary key,
  goal_id       text not null references goals(id) on delete cascade,
  title         text not null,
  date          text not null,
  time          text,
  duration_mins integer,
  colour_state  text not null default 'blue',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_milestones_goal on goal_milestones(goal_id);

-- ============================================================
-- block_revision_snapshots  (mirrors local schema + retention trigger)
-- ============================================================
create table block_revision_snapshots (
  note_id       text not null references notes(id) on delete cascade,
  revision      integer not null,
  block_id      text not null,
  content       text not null,
  content_hash  text,
  created_at    timestamptz not null default now(),
  primary key (note_id, revision, block_id)
);

create index idx_block_snapshots_note_revision
  on block_revision_snapshots(note_id, revision desc);

create or replace function prune_block_snapshots()
returns trigger as $$
begin
  delete from block_revision_snapshots
  where note_id = new.note_id
    and revision not in (
      select distinct revision from block_revision_snapshots
      where note_id = new.note_id
      order by revision desc
      limit 20
    );
  return null;
end;
$$ language plpgsql;

create trigger block_snapshots_prune
  after insert on block_revision_snapshots
  for each row
  execute function prune_block_snapshots();

-- ============================================================
-- shares + share_members  (calendar_events / goals — per Sharing & Permissions doc)
-- ============================================================
create table shares (
  id                              uuid primary key default gen_random_uuid(),
  item_type                       text not null check (item_type in ('calendar_event', 'goal')),
  item_id                         text not null,
  owner_id                        uuid not null references auth.users(id) on delete cascade,
  visibility                      text not null check (visibility in ('private', 'team', 'public')) default 'private',
  share_token                     text unique,
  include_linked_calendar_events  boolean not null default false, -- explicit opt-in per §4 of Sharing doc
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),
  unique (item_type, item_id)
);

create index idx_shares_token on shares(share_token) where share_token is not null;

create table share_members (
  share_id  uuid not null references shares(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  added_at  timestamptz not null default now(),
  primary key (share_id, user_id)
);

-- ============================================================
-- note_shares  (per-note team membership — notes use publish_visibility
-- directly rather than the `shares` table, since notes' publish model
-- differs from calendar/goal per the Note Publishing doc §1)
-- ============================================================
create table note_shares (
  note_id   text not null references notes(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  added_at  timestamptz not null default now(),
  primary key (note_id, user_id)
);

-- ============================================================
-- Row-Level Security
-- ============================================================
alter table notes enable row level security;
alter table calendar_events enable row level security;
alter table goals enable row level security;
alter table goal_milestones enable row level security;
alter table block_revision_snapshots enable row level security;
alter table shares enable row level security;
alter table share_members enable row level security;
alter table note_shares enable row level security;

-- notes: owner full access
create policy notes_owner_all on notes
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- notes: team members can read team-visible notes
create policy notes_team_read on notes
  for select using (
    is_published and publish_visibility = 'team'
    and exists (
      select 1 from note_shares
      where note_shares.note_id = notes.id
        and note_shares.user_id = auth.uid()
    )
  );

-- notes: public-visible notes are readable by anyone authenticated
-- (unauthenticated public-token reads are served via the public-read
-- path / service role per the Sharing & Permissions doc §5-6, not RLS)
create policy notes_public_read on notes
  for select using (is_published and publish_visibility = 'public');

-- calendar_events / goals: owner full access
create policy calendar_events_owner_all on calendar_events
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy goals_owner_all on goals
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- calendar_events / goals: shared read (team or public) via shares/share_members
create policy calendar_events_shared_read on calendar_events
  for select using (
    exists (
      select 1 from shares
      where shares.item_type = 'calendar_event'
        and shares.item_id = calendar_events.id
        and (
          shares.visibility = 'public'
          or (shares.visibility = 'team' and exists (
            select 1 from share_members
            where share_members.share_id = shares.id
              and share_members.user_id = auth.uid()
          ))
        )
    )
  );

create policy goals_shared_read on goals
  for select using (
    exists (
      select 1 from shares
      where shares.item_type = 'goal'
        and shares.item_id = goals.id
        and (
          shares.visibility = 'public'
          or (shares.visibility = 'team' and exists (
            select 1 from share_members
            where share_members.share_id = shares.id
              and share_members.user_id = auth.uid()
          ))
        )
    )
  );

-- goal_milestones: inherit visibility from parent goal
create policy goal_milestones_owner_all on goal_milestones
  for all using (
    exists (select 1 from goals where goals.id = goal_milestones.goal_id and goals.owner_id = auth.uid())
  ) with check (
    exists (select 1 from goals where goals.id = goal_milestones.goal_id and goals.owner_id = auth.uid())
  );

create policy goal_milestones_shared_read on goal_milestones
  for select using (
    exists (
      select 1 from goals
      join shares on shares.item_type = 'goal' and shares.item_id = goals.id
      where goals.id = goal_milestones.goal_id
        and (
          shares.visibility = 'public'
          or (shares.visibility = 'team' and exists (
            select 1 from share_members
            where share_members.share_id = shares.id
              and share_members.user_id = auth.uid()
          ))
        )
    )
  );

-- block_revision_snapshots: readable if the parent note is readable
create policy block_snapshots_via_note on block_revision_snapshots
  for select using (
    exists (
      select 1 from notes
      where notes.id = block_revision_snapshots.note_id
        and (
          notes.owner_id = auth.uid()
          or (notes.is_published and notes.publish_visibility = 'public')
          or (notes.is_published and notes.publish_visibility = 'team'
              and exists (select 1 from note_shares where note_shares.note_id = notes.id and note_shares.user_id = auth.uid()))
        )
    )
  );

create policy block_snapshots_owner_write on block_revision_snapshots
  for insert with check (
    exists (select 1 from notes where notes.id = block_revision_snapshots.note_id and notes.owner_id = auth.uid())
  );

-- shares / share_members / note_shares: owner manages, members can see their own membership
create policy shares_owner_all on shares
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy share_members_owner_manage on share_members
  for all using (
    exists (select 1 from shares where shares.id = share_members.share_id and shares.owner_id = auth.uid())
  ) with check (
    exists (select 1 from shares where shares.id = share_members.share_id and shares.owner_id = auth.uid())
  );

create policy share_members_self_read on share_members
  for select using (user_id = auth.uid());

create policy note_shares_owner_manage on note_shares
  for all using (
    exists (select 1 from notes where notes.id = note_shares.note_id and notes.owner_id = auth.uid())
  ) with check (
    exists (select 1 from notes where notes.id = note_shares.note_id and notes.owner_id = auth.uid())
  );

create policy note_shares_self_read on note_shares
  for select using (user_id = auth.uid());