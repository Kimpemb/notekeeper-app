-- supabase/migrations/20261021000000_note_purge.sql
--
-- Stage 4d tombstones, step 3. Adds notes.purged_at and purge_note(), the only
-- way a client purges a note. Purged rows are KEPT (never physically deleted),
-- because notes.parent_id is ON DELETE SET NULL and a real delete would
-- reparent children without bumping their revisions.
--
-- purge_note is SECURITY DEFINER because block_revision_snapshots has no
-- delete policy. It checks ownership itself (owner_id = auth.uid()).
--
-- Returns the new server revision, or NULL when nothing was purged
-- (wrong expected revision, already purged, not found, or not the owner).

alter table public.notes add column if not exists purged_at timestamptz;

drop function if exists public.purge_note(uuid, integer);

create or replace function public.purge_note(p_id text, p_expected_revision integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rev integer;
begin
  update public.notes set
    purged_at          = now(),
    revision           = revision + 1,
    title              = 'Untitled',
    content            = '{}',
    plaintext          = '',
    tags               = null,
    frontmatter        = null,
    is_published       = false,
    publish_visibility = null,
    publish_token      = null
  where id = p_id
    and owner_id = auth.uid()
    and revision = p_expected_revision
    and purged_at is null
  returning revision into v_rev;

  if v_rev is null then
    return null;
  end if;

  -- Old versions of the text and any share grants go with the purge.
  delete from public.block_revision_snapshots where note_id = p_id;
  delete from public.note_shares where note_id = p_id;

  return v_rev;
end;
$$;

revoke all on function public.purge_note(text, integer) from public, anon;
grant execute on function public.purge_note(text, integer) to authenticated;
