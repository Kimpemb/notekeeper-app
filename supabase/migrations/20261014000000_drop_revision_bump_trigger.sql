-- Stage 4a dropped the hosted revision-bump trigger by hand so local SQLite
-- could be the revision source; Stage 4d now makes the hosted revision
-- SERVER-ASSIGNED by the client's compare-and-swap push (expected + 1), and the
-- trigger would also overwrite updated_at. This migration records the drop so a
-- fresh project (or `supabase db reset`) matches the real hosted state.
-- Idempotent: safe to run on the already-dropped hosted project.

drop trigger if exists notes_revision_bump on notes;
drop function if exists bump_note_revision();
