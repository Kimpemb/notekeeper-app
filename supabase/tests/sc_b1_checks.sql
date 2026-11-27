-- supabase/tests/sc_b1_checks.sql
--
-- Checks for migration B1 (policy core). Run in the LOCAL Studio SQL Editor (never live).
-- Needs three users with emails a@test.local, b@test.local, c@test.local.
-- Everything runs in one transaction that is rolled back, so no data is left behind.
-- Result: one table of checks; every row should say PASS.

begin;

create temp table res (check_id text, what text, ok boolean, detail text);
grant all on res to public;

do $$
declare
  a uuid; b uuid; c uuid;
  n1 text := 'sc-root-' || gen_random_uuid();
  n2 text := 'sc-child-' || gen_random_uuid();
  n3 text := 'sc-public-' || gen_random_uuid();
  n4 text := 'sc-private-' || gen_random_uuid();
  v int;
begin
  select id into a from auth.users where email = 'a@test.local';
  select id into b from auth.users where email = 'b@test.local';
  select id into c from auth.users where email = 'c@test.local';
  if a is null or b is null or c is null then
    insert into res values ('SETUP', 'users a, b, c exist', false, format('a=%s b=%s c=%s', a, b, c));
    return;
  end if;

  -- Setup as the database owner: A owns a shared root with a child, a "public"-flagged note
  -- nobody has a grant on, and a private note. B holds a read grant on the root.
  insert into notes (id, owner_id, title, source_type, is_published, publish_visibility, share_root_id)
    values (n1, a, 'sc root', 'note', true, 'team', n1);
  insert into notes (id, owner_id, title, source_type, parent_id, is_published, publish_visibility, share_root_id)
    values (n2, a, 'sc child', 'note', n1, true, 'team', n1);
  insert into notes (id, owner_id, title, source_type, is_published, publish_visibility)
    values (n3, a, 'sc public-flagged', 'note', true, 'public');
  insert into notes (id, owner_id, title, source_type)
    values (n4, a, 'sc private', 'note');
  insert into note_shares (note_id, user_id, role) values (n1, b, 'read');
  insert into block_revision_snapshots (note_id, revision, block_id, content)
    values (n2, 1, 'blk1', '{}');

  -- SC1: B reads root and child; C (no grant) reads neither, and not the snapshot
  perform set_config('request.jwt.claims', json_build_object('sub', b)::text, true);
  set local role authenticated;
  select count(*) into v from notes where id in (n1, n2);
  insert into res values ('SC1', 'B (granted) reads root + child', v = 2, 'count=' || v);
  select count(*) into v from block_revision_snapshots where note_id = n2;
  insert into res values ('SC1', 'B reads the child snapshot', v = 1, 'count=' || v);
  select count(*) into v from notes where id in (n3, n4);
  insert into res values ('SC1', 'B cannot read the public-flagged or private note', v = 0, 'count=' || v);
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', c)::text, true);
  set local role authenticated;
  select count(*) into v from notes where id in (n1, n2, n3, n4);
  insert into res values ('SC1', 'C (no grant) reads nothing, incl. old public-read path', v = 0, 'count=' || v);
  select count(*) into v from block_revision_snapshots where note_id = n2;
  insert into res values ('SC1', 'C cannot read the snapshot', v = 0, 'count=' || v);
  reset role;

  -- SC2: B (read role) cannot write the copy or its snapshots by any path
  perform set_config('request.jwt.claims', json_build_object('sub', b)::text, true);
  set local role authenticated;
  update notes set title = 'hacked' where id = n1;
  get diagnostics v = row_count;
  insert into res values ('SC2', 'B cannot update the root', v = 0, 'rows=' || v);
  delete from notes where id = n2;
  get diagnostics v = row_count;
  insert into res values ('SC2', 'B cannot delete the child', v = 0, 'rows=' || v);
  begin
    insert into block_revision_snapshots (note_id, revision, block_id, content) values (n2, 2, 'blk2', '{}');
    insert into res values ('SC2', 'B cannot insert a snapshot', false, 'insert succeeded');
  exception when others then
    insert into res values ('SC2', 'B cannot insert a snapshot', true, sqlstate);
  end;
  begin
    insert into notes (id, owner_id, title, parent_id) values ('sc-fake-' || gen_random_uuid(), a, 'forged', n1);
    insert into res values ('SC2', 'B cannot insert a note owned by A', false, 'insert succeeded');
  exception when others then
    insert into res values ('SC2', 'B cannot insert a note owned by A', true, sqlstate);
  end;
  reset role;

  -- SC13-ish: B cannot grant themselves anything on A's other note
  perform set_config('request.jwt.claims', json_build_object('sub', b)::text, true);
  set local role authenticated;
  begin
    insert into note_shares (note_id, user_id) values (n4, b);
    insert into res values ('SC13', 'B cannot grant self access to A''s private note', false, 'insert succeeded');
  exception when others then
    insert into res values ('SC13', 'B cannot grant self access to A''s private note', true, sqlstate);
  end;
  reset role;

  -- SC14: owner A keeps normal access: update own note, insert own snapshot, read all own
  perform set_config('request.jwt.claims', json_build_object('sub', a)::text, true);
  set local role authenticated;
  update notes set title = 'sc root renamed' where id = n1;
  get diagnostics v = row_count;
  insert into res values ('SC14', 'A updates own note', v = 1, 'rows=' || v);
  begin
    insert into block_revision_snapshots (note_id, revision, block_id, content) values (n2, 2, 'blk2', '{}');
    insert into res values ('SC14', 'A inserts own snapshot', true, 'ok');
  exception when others then
    insert into res values ('SC14', 'A inserts own snapshot', false, sqlstate || ' ' || sqlerrm);
  end;
  select count(*) into v from notes where id in (n1, n2, n3, n4);
  insert into res values ('SC14', 'A reads all four own notes', v = 4, 'count=' || v);
  select count(*) into v from notes where id = n1 and updated_by = a;
  insert into res values ('DEC180', 'updated_by set to A by trigger on update', v = 1, 'matches=' || v);
  reset role;

  -- anon (signed out) reads nothing
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  begin
    select count(*) into v from notes where id in (n1, n2, n3, n4);
    insert into res values ('ANON', 'anon reads no notes', v = 0, 'count=' || v);
  exception when others then
    insert into res values ('ANON', 'anon reads no notes (permission denied)', true, sqlstate);
  end;
  begin
    select count(*) into v from block_revision_snapshots;
    insert into res values ('ANON', 'anon reads no snapshots', v = 0, 'count=' || v);
  exception when others then
    insert into res values ('ANON', 'anon reads no snapshots (permission denied)', true, sqlstate);
  end;
  reset role;
end
$$;

select * from res order by check_id, what;

rollback;
