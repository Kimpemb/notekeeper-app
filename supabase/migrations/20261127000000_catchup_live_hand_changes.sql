-- supabase/migrations/20261127000000_catchup_live_hand_changes.sql
--
-- DRAFT (M2.0). Captures changes that were made by hand in the live project and
-- are in no earlier migration, so a fresh `supabase db reset` equals live.
-- Idempotent: a no-op on live (apart from adding search_path to is_note_owner).
-- Apply to the LOCAL stack only for now. Never push to live before the security
-- checks pass.

-- 1. Ownership helper (exists in live, not in migrations). Added: search_path.
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

-- 2. note_shares_owner_manage as it is in live. The helper runs as its owner and
--    bypasses RLS on notes, which breaks the notes <-> note_shares policy
--    recursion (notes_team_read reads note_shares; the old version of this
--    policy read notes).
drop policy if exists note_shares_owner_manage on public.note_shares;
create policy note_shares_owner_manage on public.note_shares
  for all
  using (public.is_note_owner(note_id, auth.uid()))
  with check (public.is_note_owner(note_id, auth.uid()));
