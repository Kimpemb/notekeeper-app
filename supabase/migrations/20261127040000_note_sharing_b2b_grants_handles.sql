-- supabase/migrations/20261127040000_note_sharing_b2b_grants_handles.sql
--
-- M2.2 (part 3 of file B): owner-only policies for the publish tables (SC12), share_grant,
-- share_revoke, find_profile_by_handle (SC7) and verify_shares.
--
-- Notes for the plan (v1.4):
--   * SC10 (direct 'read' + team 'suggest' = 'suggest') cannot be built yet:
--     note_shares has primary key (note_id, user_id), so a person cannot hold two grants on one
--     root. M9 must change the key (for example add via_team_id, with a unique index on
--     (note_id, user_id, coalesce(via_team_id, ...))). SC10 moves to M9 with SC5 and SC11.
--   * verify_shares only REDUCES exposure: it clears flags that should not be set and reports
--     qualifying notes that are not shared. It never flags a note, because a private note moved
--     into a share is deliberately not shared (B2a).
--   * profiles has no policies yet (deny-all except the functions here); M3 adds the
--     claim-your-handle policies.
--
-- Idempotent: create or replace / drop policy if exists.

-- ============================================================
-- SC12: publish tables are readable and writable only by their owner
-- ============================================================
drop policy if exists publish_shares_owner_all on public.publish_shares;
create policy publish_shares_owner_all on public.publish_shares
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and public.is_note_owner(root_copy_id, auth.uid()));

drop policy if exists publish_links_owner_all on public.publish_links;
create policy publish_links_owner_all on public.publish_links
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and public.is_note_owner(copy_note_id, auth.uid()));

-- No owner_id column: ownership comes from the copy note, through the write gate.
drop policy if exists publish_block_map_owner_all on public.publish_block_map;
create policy publish_block_map_owner_all on public.publish_block_map
  for all to authenticated
  using (public.can_write_note(copy_note_id))
  with check (public.can_write_note(copy_note_id));

-- ============================================================
-- share_grant / share_revoke: manage one person's access on a share root
-- ============================================================
-- Errors: not_signed_in (28000), not_owner (42501), not_a_share_root (P0001),
--         cannot_grant_self (P0001). An invalid role fails the table check (23514),
--         an unknown user fails the foreign key (23503).
create or replace function public.share_grant(p_root_id text, p_user_id uuid, p_role text default 'read')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_root notes%rowtype;
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  select * into v_root from notes where id = p_root_id;
  if not found or v_root.owner_id <> v_uid then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if v_root.share_root_id is distinct from v_root.id or not v_root.is_published then
    raise exception 'not_a_share_root' using errcode = 'P0001';
  end if;
  if p_user_id = v_uid then
    raise exception 'cannot_grant_self' using errcode = 'P0001';
  end if;

  insert into note_shares (note_id, user_id, role)
  values (p_root_id, p_user_id, coalesce(p_role, 'read'))
  on conflict (note_id, user_id) do update set role = excluded.role;

  return jsonb_build_object('grants_total', (select count(*) from note_shares where note_id = p_root_id));
end;
$$;

create or replace function public.share_revoke(p_root_id text, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_n   integer;
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  if not public.is_note_owner(p_root_id, v_uid) then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  delete from note_shares where note_id = p_root_id and user_id = p_user_id;
  get diagnostics v_n = row_count;
  return jsonb_build_object('removed', v_n);
end;
$$;

-- ============================================================
-- find_profile_by_handle: exact match only (SC7)
-- ============================================================
-- Returns at most one row: id, handle, display name. Plain equality, never LIKE, so a partial
-- or wildcard handle finds nothing. Handles are stored lowercase; the lookup does not fold case.
create or replace function public.find_profile_by_handle(p_handle text)
returns table (user_id uuid, handle text, display_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  return query
    select p.user_id, p.handle, p.display_name
      from profiles p
     where p.handle = p_handle;
end;
$$;

-- ============================================================
-- verify_shares: clear drifted flags on one share (owner only)
-- ============================================================
-- Valid shared notes are: the root, then every child that is flagged with this root, is a
-- text note, is not AI-excluded, not trashed or purged, has the same owner, and hangs under a
-- valid parent. Any other note still pointing at this root is cleared. Qualifying notes in
-- the tree that are not shared are only counted ("unflagged_in_tree"), never flagged.
create or replace function public.verify_shares(p_root_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_root      notes%rowtype;
  v_cleared   integer := 0;
  v_unflagged integer := 0;
  v_valid     integer := 0;
  v_prev      text;
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  select * into v_root from notes where id = p_root_id;
  if not found or v_root.owner_id <> v_uid then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if v_root.share_root_id is distinct from v_root.id then
    raise exception 'not_a_share_root' using errcode = 'P0001';
  end if;

  -- A root that no longer qualifies takes the whole share with it.
  if not (v_root.is_published and v_root.source_type = 'note' and not v_root.rag_excluded
          and v_root.deleted_at is null and v_root.purged_at is null) then
    return jsonb_build_object('cleared', public._unshare_branch(p_root_id), 'valid', 0, 'unflagged_in_tree', 0);
  end if;

  v_prev := coalesce(current_setting('idemora.share_op', true), '');
  perform set_config('idemora.share_op', '1', true);

  with recursive valid(id) as (
    select p_root_id
    union
    select c.id from notes c join valid v on c.parent_id = v.id
     where c.owner_id = v_uid
       and c.share_root_id = p_root_id
       and c.is_published and c.publish_visibility = 'team'
       and c.source_type = 'note' and not c.rag_excluded
       and c.deleted_at is null and c.purged_at is null
  )
  update notes
     set share_root_id = null, is_published = false, publish_visibility = null
   where share_root_id = p_root_id
     and id not in (select id from valid);
  get diagnostics v_cleared = row_count;

  perform set_config('idemora.share_op', v_prev, true);

  select count(*) into v_valid from notes where share_root_id = p_root_id and is_published;

  with recursive t(id) as (
    select p_root_id
    union
    select c.id from notes c join t on c.parent_id = t.id
     where c.owner_id = v_uid
       and c.source_type = 'note' and not c.rag_excluded
       and c.deleted_at is null and c.purged_at is null
  )
  select count(*) into v_unflagged
    from notes n
   where n.id in (select id from t)
     and (n.share_root_id is distinct from p_root_id or not n.is_published);

  return jsonb_build_object('cleared', v_cleared, 'valid', v_valid, 'unflagged_in_tree', v_unflagged);
end;
$$;

-- Explicit grants (Q13): signed-in users only.
revoke all on function public.share_grant(text, uuid, text)  from public, anon;
revoke all on function public.share_revoke(text, uuid)       from public, anon;
revoke all on function public.find_profile_by_handle(text)   from public, anon;
revoke all on function public.verify_shares(text)            from public, anon;
grant execute on function public.share_grant(text, uuid, text) to authenticated;
grant execute on function public.share_revoke(text, uuid)      to authenticated;
grant execute on function public.find_profile_by_handle(text)  to authenticated;
grant execute on function public.verify_shares(text)           to authenticated;
