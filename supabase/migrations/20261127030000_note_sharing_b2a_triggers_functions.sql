-- supabase/migrations/20261127030000_note_sharing_b2a_triggers_functions.sql
--
-- M2.2 (part 2 of file B): share state is server-owned. Guard trigger, consequence trigger,
-- share_note, unshare_note, unshare_branch.
-- Grants, handle lookup and verify_shares follow in B2b.
--
-- Model (plan sections 3 and 4):
--   * A note is "shared" when is_published = true, publish_visibility = 'team' and
--     share_root_id is not null. The root points at itself; every other shared note points
--     at its root. Grants (note_shares) live only on the root.
--   * Share state changes ONLY through the functions below (decision 160). For a signed-in
--     API user, notes_share_guard freezes the three share columns on UPDATE and recomputes
--     them on INSERT. A push from a stale local row therefore cannot change share state,
--     even if a future client bug sends the columns again (SC6).
--   * Direct SQL with no signed-in user (migrations, dashboard, tests) is not guarded.
--   * Consequences are applied by notes_share_after: trash, purge, AI exclusion, a change of
--     source_type away from 'note', or a move out of the note's own share all unshare that
--     note and everything below it (decision 162, section 3.2).
--
-- Deliberate differences from the plan text (to record in v1.4):
--   * A note moved INTO a shared tree is NOT auto-shared (a private note dragged in by
--     accident must not become readable). A new note INSERTED under a shared parent owned
--     by the same user is shared at once, so Publish all needs no extra call.
--   * share_note requires source_type = 'note' exactly (not just "not null"): pdf, docx and
--     pptx rows are never copies in Tier 1.
--   * share_note takes user ids only. Team targets arrive with M9.
--   * The 1,000-note cap is enforced in share_note only. Notes inserted under a full share
--     are not capped yet (M11).
--
-- Internal switch: functions set the transaction-local setting idemora.share_op = '1' while
-- they write share columns, and restore the previous value afterwards. PostgREST clients
-- cannot call set_config, so they cannot set it.
--
-- Idempotent: create or replace / drop trigger if exists.

-- ============================================================
-- internal: unshare a note and everything below it
-- ============================================================
-- Returns the number of notes whose share state was cleared. For a share root this clears
-- the whole tree and removes every grant (Stop sharing); for any other note it clears that
-- note and its descendants inside the same share and leaves the grants alone.
create or replace function public._unshare_branch(p_note_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_root  text;
  v_owner uuid;
  v_cnt   integer := 0;
  v_prev  text;
begin
  select share_root_id, owner_id into v_root, v_owner from notes where id = p_note_id;
  if v_root is null then
    return 0;
  end if;

  v_prev := coalesce(current_setting('idemora.share_op', true), '');
  perform set_config('idemora.share_op', '1', true);

  if v_root = p_note_id then
    update notes
       set share_root_id = null, is_published = false, publish_visibility = null
     where share_root_id = p_note_id;
    get diagnostics v_cnt = row_count;
    delete from note_shares where note_id = p_note_id;
    delete from team_shared_roots where root_id = p_note_id;
  else
    with recursive t(id) as (
      select p_note_id
      union
      select c.id from notes c join t on c.parent_id = t.id
       where c.owner_id = v_owner and c.share_root_id = v_root
    )
    update notes
       set share_root_id = null, is_published = false, publish_visibility = null
     where id in (select id from t);
    get diagnostics v_cnt = row_count;
  end if;

  perform set_config('idemora.share_op', v_prev, true);
  return v_cnt;
end;
$$;

revoke all on function public._unshare_branch(text) from public, anon, authenticated;

-- ============================================================
-- guard: share columns are not writable by API clients
-- ============================================================
create or replace function public.notes_share_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p notes%rowtype;
begin
  -- Trusted paths: our own functions, and direct SQL with no signed-in user.
  if coalesce(current_setting('idemora.share_op', true), '') = '1' or auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.share_root_id := null;
    new.is_published := false;
    new.publish_visibility := null;

    -- A new text note under a shared parent owned by the same user is shared at once.
    if new.parent_id is not null
       and new.source_type = 'note'
       and not new.rag_excluded
       and new.deleted_at is null
       and new.purged_at is null then
      select * into p from notes where id = new.parent_id;
      if found
         and p.owner_id = new.owner_id
         and p.is_published
         and p.publish_visibility = 'team'
         and p.share_root_id is not null then
        new.share_root_id := p.share_root_id;
        new.is_published := true;
        new.publish_visibility := 'team';
      end if;
    end if;
  else
    new.share_root_id := old.share_root_id;
    new.is_published := old.is_published;
    new.publish_visibility := old.publish_visibility;
  end if;

  return new;
end;
$$;

drop trigger if exists notes_share_guard on public.notes;
create trigger notes_share_guard
  before insert or update on public.notes
  for each row
  execute function public.notes_share_guard();

-- ============================================================
-- consequences: events that end sharing for a note and below
-- ============================================================
create or replace function public.notes_share_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent notes%rowtype;
  v_copy   text;
begin
  -- Our own functions write share columns directly; do not react to them.
  if coalesce(current_setting('idemora.share_op', true), '') = '1' then
    return null;
  end if;

  if new.share_root_id is not null then
    if (new.deleted_at is not null and old.deleted_at is null)
       or (new.purged_at is not null and old.purged_at is null)
       or (new.rag_excluded and not old.rag_excluded)
       or (new.source_type is distinct from old.source_type and new.source_type is distinct from 'note') then
      -- Trashed, purged, excluded from AI, or no longer a text note: unshare it and below.
      perform public._unshare_branch(new.id);
    elsif new.parent_id is distinct from old.parent_id and new.share_root_id <> new.id then
      -- A shared note that leaves its own share is unshared. Moving inside the share is fine.
      select * into v_parent from notes where id = new.parent_id;
      if not found
         or v_parent.owner_id <> new.owner_id
         or not v_parent.is_published
         or v_parent.share_root_id is distinct from new.share_root_id then
        perform public._unshare_branch(new.id);
      end if;
    end if;
  end if;

  -- A SOURCE note that becomes AI-excluded takes its copy branch offline (decision 162).
  if new.rag_excluded and not old.rag_excluded then
    for v_copy in
      select pl.copy_note_id from publish_links pl
       where pl.source_note_id = new.id and pl.owner_id = new.owner_id
    loop
      perform public._unshare_branch(v_copy);
    end loop;
  end if;

  return null;
end;
$$;

drop trigger if exists notes_share_after on public.notes;
create trigger notes_share_after
  after update on public.notes
  for each row
  when (
    old.parent_id    is distinct from new.parent_id
    or old.deleted_at  is distinct from new.deleted_at
    or old.purged_at   is distinct from new.purged_at
    or old.rag_excluded is distinct from new.rag_excluded
    or old.source_type is distinct from new.source_type
  )
  execute function public.notes_share_after();

-- ============================================================
-- share_note: flag a copy tree as shared and grant read access
-- ============================================================
-- Errors (all abort the whole call, nothing is changed):
--   not_signed_in (28000), not_owner (42501), inside_another_share (P0001),
--   tree_not_shareable (P0001, detail = counts), too_many_notes (P0001).
create or replace function public.share_note(p_root_id text, p_user_ids uuid[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_root    notes%rowtype;
  v_total   integer;
  v_nosrc   integer;
  v_notnote integer;
  v_excl    integer;
  v_gone    integer;
  v_overlap integer;
  v_added   integer := 0;
  v_flagged integer := 0;
  v_prev    text;
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;

  select * into v_root from notes where id = p_root_id;
  if not found or v_root.owner_id <> v_uid then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if v_root.share_root_id is not null and v_root.share_root_id <> v_root.id then
    raise exception 'inside_another_share' using errcode = 'P0001';
  end if;

  -- Walk the tree (same owner only: a note someone else parked under this root is ignored).
  with recursive t as (
    select id, source_type, rag_excluded, deleted_at, purged_at, share_root_id
      from notes where id = p_root_id
    union
    select c.id, c.source_type, c.rag_excluded, c.deleted_at, c.purged_at, c.share_root_id
      from notes c join t on c.parent_id = t.id
     where c.owner_id = v_uid
  )
  select count(*),
         count(*) filter (where source_type is null),
         count(*) filter (where source_type is not null and source_type <> 'note'),
         count(*) filter (where rag_excluded),
         count(*) filter (where deleted_at is not null or purged_at is not null),
         count(*) filter (where share_root_id is not null and share_root_id <> p_root_id)
    into v_total, v_nosrc, v_notnote, v_excl, v_gone, v_overlap
    from t;

  if v_nosrc + v_notnote + v_excl + v_gone + v_overlap > 0 then
    raise exception 'tree_not_shareable' using errcode = 'P0001',
      detail = jsonb_build_object(
        'total', v_total,
        'source_type_null', v_nosrc,
        'not_a_text_note', v_notnote,
        'ai_excluded', v_excl,
        'trashed_or_purged', v_gone,
        'in_another_share', v_overlap)::text;
  end if;

  if v_total > 1000 then
    raise exception 'too_many_notes' using errcode = 'P0001', detail = v_total::text;
  end if;

  v_prev := coalesce(current_setting('idemora.share_op', true), '');
  perform set_config('idemora.share_op', '1', true);

  with recursive t(id) as (
    select p_root_id
    union
    select c.id from notes c join t on c.parent_id = t.id where c.owner_id = v_uid
  )
  update notes
     set share_root_id = p_root_id, is_published = true, publish_visibility = 'team'
   where id in (select id from t);
  get diagnostics v_flagged = row_count;

  if p_user_ids is not null then
    insert into note_shares (note_id, user_id, role, trust)
    select p_root_id, u, 'read', 'review'
      from unnest(p_user_ids) as u
     where u is not null and u <> v_uid
    on conflict (note_id, user_id) do nothing;
    get diagnostics v_added = row_count;
  end if;

  perform set_config('idemora.share_op', v_prev, true);

  return jsonb_build_object(
    'notes', v_flagged,
    'grants_added', v_added,
    'grants_total', (select count(*) from note_shares where note_id = p_root_id));
end;
$$;

-- ============================================================
-- unshare_note: Stop sharing (all access revoked, copy stays, private)
-- ============================================================
create or replace function public.unshare_note(p_root_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_note notes%rowtype;
  v_cnt  integer;
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  select * into v_note from notes where id = p_root_id;
  if not found or v_note.owner_id <> v_uid then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if v_note.share_root_id is not null and v_note.share_root_id <> v_note.id then
    raise exception 'not_a_share_root' using errcode = 'P0001';
  end if;

  v_cnt := public._unshare_branch(p_root_id);
  -- Also clears any stray grants on a root that was never flagged.
  delete from note_shares where note_id = p_root_id;
  delete from team_shared_roots where root_id = p_root_id;

  return jsonb_build_object('notes', v_cnt);
end;
$$;

-- ============================================================
-- unshare_branch: remove one note and its subtree from a share
-- ============================================================
-- On a share root this is the same as unshare_note.
create or replace function public.unshare_branch(p_note_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  if not public.is_note_owner(p_note_id, v_uid) then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  return jsonb_build_object('notes', public._unshare_branch(p_note_id));
end;
$$;

-- Explicit grants (Q13): signed-in users only.
revoke all on function public.share_note(text, uuid[]) from public, anon;
revoke all on function public.unshare_note(text)       from public, anon;
revoke all on function public.unshare_branch(text)     from public, anon;
grant execute on function public.share_note(text, uuid[]) to authenticated;
grant execute on function public.unshare_note(text)       to authenticated;
grant execute on function public.unshare_branch(text)     to authenticated;
