-- supabase/migrations/20261127020000_note_sharing_b1_policies.sql
--
-- M2.2 (part 1 of file B): the policy core. Helpers, new read rules, the write gate for
-- snapshots, removal of the public-read policies, and the updated_by trigger.
-- The share triggers and the share_* functions follow in B2.
--
-- Rules this file keeps (plan sections 4.3, decisions 160, 178, 179):
--   * Read: a shared note is readable when it is flagged shared AND the reader has a
--     note_shares row for coalesce(share_root_id, id). One indexed lookup, no tree walk.
--   * Every cross-table lookup in a policy goes through a SECURITY DEFINER helper with
--     search_path pinned, so policies never evaluate each other's policies (the earlier
--     recursion bug between notes_team_read and note_shares_owner_manage).
--   * Nothing is readable by anon. notes_public_read and the public clause in the snapshot
--     policy are removed (F17).
--
-- Deliberate difference from plan decision 179: notes_owner_all is NOT moved to
-- can_write_note. On INSERT the row does not exist yet, so a lookup by id cannot see it;
-- the row's own owner_id must be checked directly. can_write_note is used for the child
-- table (snapshots). Tier 1b adds its edit-role branch to can_write_note and to
-- notes_owner_all together.
--
-- Idempotent: create or replace / drop policy if exists.

-- ============================================================
-- helpers (SECURITY DEFINER, stable, single lookup, search_path pinned)
-- ============================================================

-- Already exists (M2.0). Restated so this file does not depend on its history.
create or replace function public.is_note_owner(check_note_id text, check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from notes
    where notes.id = check_note_id
      and notes.owner_id = check_user_id
  );
$$;

-- The single write gate for note-owned child rows (decision 179).
create or replace function public.can_write_note(check_note_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_note_owner(check_note_id, auth.uid());
$$;

-- Does the signed-in user hold a grant on this share root?
create or replace function public.has_note_share(check_root_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from note_shares
    where note_shares.note_id = check_root_id
      and note_shares.user_id = auth.uid()
  );
$$;

-- Can the signed-in user read this note (owner, or shared with them)?
create or replace function public.can_read_note(check_note_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from notes n
    where n.id = check_note_id
      and (
        n.owner_id = auth.uid()
        or (
          n.is_published
          and n.publish_visibility = 'team'
          and exists (
            select 1 from note_shares s
            where s.note_id = coalesce(n.share_root_id, n.id)
              and s.user_id = auth.uid()
          )
        )
      )
  );
$$;

-- Explicit grants (Q13): nothing is callable by anon or by default PUBLIC.
revoke all on function public.is_note_owner(text, uuid) from public, anon;
revoke all on function public.can_write_note(text)      from public, anon;
revoke all on function public.has_note_share(text)      from public, anon;
revoke all on function public.can_read_note(text)       from public, anon;
grant execute on function public.is_note_owner(text, uuid) to authenticated, service_role;
grant execute on function public.can_write_note(text)      to authenticated, service_role;
grant execute on function public.has_note_share(text)      to authenticated, service_role;
grant execute on function public.can_read_note(text)       to authenticated, service_role;

-- ============================================================
-- notes: read policy for shared notes; public read removed
-- ============================================================
drop policy if exists notes_team_read on public.notes;
create policy notes_team_read on public.notes
  for select to authenticated
  using (
    is_published
    and publish_visibility = 'team'
    and public.has_note_share(coalesce(share_root_id, id))
  );

drop policy if exists notes_public_read on public.notes;

-- ============================================================
-- block_revision_snapshots: read through can_read_note, write through can_write_note
-- ============================================================
drop policy if exists block_snapshots_via_note on public.block_revision_snapshots;
create policy block_snapshots_via_note on public.block_revision_snapshots
  for select to authenticated
  using (public.can_read_note(note_id));

drop policy if exists block_snapshots_owner_write on public.block_revision_snapshots;
create policy block_snapshots_owner_write on public.block_revision_snapshots
  for insert to authenticated
  with check (public.can_write_note(note_id));

-- ============================================================
-- updated_by: set from the signed-in user, never from the client (decision 180)
-- ============================================================
create or replace function public.set_note_updated_by()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists notes_set_updated_by on public.notes;
create trigger notes_set_updated_by
  before insert or update on public.notes
  for each row
  execute function public.set_note_updated_by();
