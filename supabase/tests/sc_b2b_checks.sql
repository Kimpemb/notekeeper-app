-- supabase/tests/sc_b2b_checks.sql
--
-- Checks for migration B2b (publish-table policies, share_grant, share_revoke,
-- find_profile_by_handle, verify_shares). Run in the LOCAL Studio SQL Editor (never live).
-- Needs users a@test.local, b@test.local, c@test.local and migration B2a applied.
-- Everything runs in one transaction that is rolled back, so no data is left behind.
-- Result: one table; every row should say ok = true.
-- Covers: SC7, SC12, SC13. (SC10 waits for M9, see the migration header.)

begin;

create temp table res (check_id text, what text, ok boolean, detail text);
grant all on res to public;

create function pg_temp.run(u uuid, q text, rl text default 'authenticated') returns text
language plpgsql as $f$
declare r text;
begin
  perform set_config('request.jwt.claims',
    case when u is null then '' else json_build_object('sub', u)::text end, true);
  execute format('set local role %I', rl);
  begin
    if q ilike 'select%' then execute q into r; else execute q; r := 'ok'; end if;
  exception when others then
    r := 'ERR ' || sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return r;
end
$f$;

create function pg_temp.cnt(u uuid, ids text[]) returns int
language sql as $f$
  select pg_temp.run(u, format('select count(*) from notes where id = any(%L)', ids))::int
$f$;

create function pg_temp.flagged(ids text[]) returns int
language sql as $f$
  select count(*)::int from notes where id = any(ids) and is_published and share_root_id is not null
$f$;

create function pg_temp.mk(id text, owner uuid, parent text default null,
                           st text default 'note', excl boolean default false) returns void
language sql as $f$
  insert into notes (id, owner_id, title, parent_id, source_type, rag_excluded)
  values (id, owner, id, parent, st, excl)
$f$;

do $$
declare
  a uuid; b uuid; c uuid;
  r text;
begin
  select id into a from auth.users where email = 'a@test.local';
  select id into b from auth.users where email = 'b@test.local';
  select id into c from auth.users where email = 'c@test.local';
  if a is null or b is null or c is null then
    insert into res values ('SETUP', 'users a, b, c exist', false, format('a=%s b=%s c=%s', a, b, c));
    return;
  end if;

  -- ---------- setup (database owner) ----------
  perform pg_temp.mk('PRIV', a);
  perform pg_temp.mk('R', a); perform pg_temp.mk('CC', a, 'R'); perform pg_temp.mk('CC2', a, 'CC');
  perform pg_temp.mk('R2', a);
  perform pg_temp.mk('R9', a); perform pg_temp.mk('D1', a, 'R9'); perform pg_temp.mk('D2', a, 'R9');
  perform pg_temp.mk('D3', a, 'D1');
  perform pg_temp.mk('R10', a); perform pg_temp.mk('R10c', a, 'R10');
  insert into profiles (user_id, handle, display_name) values (a, 'alice_test', 'Alice'), (b, 'bob_test', 'Bob');
  insert into publish_shares (root_copy_id, owner_id, source_root_id) values ('R', a, 'SRC');
  insert into publish_links (copy_note_id, root_copy_id, owner_id, source_note_id) values ('CC', 'R', a, 'SRC');
  insert into publish_block_map (copy_note_id, source_block_id, copy_block_id) values ('CC', 'sb1', 'cb1');

  perform pg_temp.run(a, format('select share_note(%L, array[%L]::uuid[])', 'R', b));

  -- ---------- SC12: publish tables are owner-only ----------
  insert into res values ('SC12', 'A reads own publish_shares, publish_links, publish_block_map',
    pg_temp.run(a, 'select count(*) from publish_shares') = '1'
    and pg_temp.run(a, 'select count(*) from publish_links') = '1'
    and pg_temp.run(a, 'select count(*) from publish_block_map') = '1', '');
  insert into res values ('SC12', 'B (granted on the share) reads none of them',
    pg_temp.run(b, 'select count(*) from publish_shares') = '0'
    and pg_temp.run(b, 'select count(*) from publish_links') = '0'
    and pg_temp.run(b, 'select count(*) from publish_block_map') = '0', '');
  insert into res values ('SC12', 'C (no grant) reads none of them',
    pg_temp.run(c, 'select count(*) from publish_shares') = '0'
    and pg_temp.run(c, 'select count(*) from publish_links') = '0'
    and pg_temp.run(c, 'select count(*) from publish_block_map') = '0', '');
  r := pg_temp.run(null, 'select count(*) from publish_links', 'anon');
  insert into res values ('SC12', 'signed-out reads nothing', r = '0' or r like 'ERR 42501%', r);

  r := pg_temp.run(b, format('insert into publish_links (copy_note_id, root_copy_id, owner_id, source_note_id) values (%L, %L, %L, %L)', 'CC2', 'R', b, 'x'));
  insert into res values ('SC12', 'B cannot link a copy note B does not own', r like 'ERR 42501%', r);
  r := pg_temp.run(b, format('insert into publish_links (copy_note_id, root_copy_id, owner_id, source_note_id) values (%L, %L, %L, %L)', 'CC2', 'R', a, 'x'));
  insert into res values ('SC12', 'B cannot write a link in A''s name', r like 'ERR 42501%', r);
  r := pg_temp.run(b, format('insert into publish_shares (root_copy_id, owner_id) values (%L, %L)', 'R2', b));
  insert into res values ('SC12', 'B cannot create a publish_shares row on A''s note', r like 'ERR 42501%', r);
  r := pg_temp.run(b, format('insert into publish_block_map (copy_note_id, source_block_id, copy_block_id) values (%L, %L, %L)', 'CC', 'sb2', 'cb2'));
  insert into res values ('SC12', 'B cannot write block-map rows for A''s copy', r like 'ERR 42501%', r);
  perform pg_temp.run(b, 'delete from publish_links');
  perform pg_temp.run(b, 'update publish_links set last_published_source_revision = 99');
  insert into res values ('SC12', 'B''s delete and update touch nothing',
    (select count(*) from publish_links) = 1
    and (select last_published_source_revision from publish_links where copy_note_id = 'CC') = 0, '');
  r := pg_temp.run(a, format('insert into publish_block_map (copy_note_id, source_block_id, copy_block_id) values (%L, %L, %L)', 'CC', 'sb2', 'cb2'));
  insert into res values ('SC12', 'A can write block-map rows for own copy', r = 'ok', r);
  r := pg_temp.run(a, 'update publish_links set last_published_source_revision = 5');
  insert into res values ('SC12', 'A can update own link',
    (select last_published_source_revision from publish_links where copy_note_id = 'CC') = 5, r);

  -- ---------- share_grant / share_revoke, SC13 ----------
  r := pg_temp.run(a, format('select share_grant(%L, %L)::text', 'R', c));
  insert into res values ('GRANT', 'A grants C read on the root', r::jsonb ->> 'grants_total' = '2' and pg_temp.cnt(c, array['R','CC','CC2']) = 3, r);

  insert into res values ('SC13', 'B sees only their own grant row',
    pg_temp.run(b, 'select count(*) from note_shares where note_id = ''R''') = '1', '');
  insert into res values ('SC13', 'A sees every grant on the share',
    pg_temp.run(a, 'select count(*) from note_shares where note_id = ''R''') = '2', '');
  perform pg_temp.run(b, format('update note_shares set role = ''edit'' where note_id = ''R'' and user_id = %L', b));
  insert into res values ('SC13', 'B cannot raise their own role',
    (select role from note_shares where note_id = 'R' and user_id = b) = 'read', '');
  r := pg_temp.run(b, format('insert into note_shares (note_id, user_id) values (%L, %L)', 'R2', b));
  insert into res values ('SC13', 'B cannot grant self access to a note B does not own', r like 'ERR 42501%', r);
  r := pg_temp.run(b, format('select share_grant(%L, %L)::text', 'R', b));
  insert into res values ('SC13', 'B cannot call share_grant on A''s root', r like 'ERR 42501%', r);
  r := pg_temp.run(a, format('select share_grant(%L, %L)::text', 'R', a));
  insert into res values ('SC13', 'A cannot grant themselves', r like 'ERR P0001 cannot_grant_self%', r);

  r := pg_temp.run(a, format('select share_grant(%L, %L)::text', 'CC', c));
  insert into res values ('GRANT', 'grants only go on a share root', r like 'ERR P0001 not_a_share_root%', r);
  r := pg_temp.run(a, format('select share_grant(%L, %L, %L)::text', 'R', c, 'admin'));
  insert into res values ('GRANT', 'an unknown role is refused', r like 'ERR 23514%', r);
  r := pg_temp.run(a, format('select share_grant(%L, %L)::text', 'R', gen_random_uuid()));
  insert into res values ('GRANT', 'an unknown user is refused', r like 'ERR 23503%', r);
  r := pg_temp.run(a, format('select share_grant(%L, %L, %L)::text', 'R', c, 'suggest'));
  insert into res values ('GRANT', 'granting again changes the role, no second row',
    (select role from note_shares where note_id = 'R' and user_id = c) = 'suggest'
    and (select count(*) from note_shares where note_id = 'R') = 2, r);

  r := pg_temp.run(b, format('select share_revoke(%L, %L)::text', 'R', c));
  insert into res values ('REVOKE', 'B cannot revoke C''s access', r like 'ERR 42501%' and pg_temp.cnt(c, array['R']) = 1, r);
  r := pg_temp.run(a, format('select share_revoke(%L, %L)::text', 'R', c));
  insert into res values ('REVOKE', 'A revokes C: C loses access at once, B keeps it',
    r::jsonb ->> 'removed' = '1' and pg_temp.cnt(c, array['R','CC','CC2']) = 0 and pg_temp.cnt(b, array['R','CC','CC2']) = 3, r);
  r := pg_temp.run(a, format('select share_revoke(%L, %L)::text', 'R', c));
  insert into res values ('REVOKE', 'revoking again removes nothing and does not fail', r::jsonb ->> 'removed' = '0', r);

  -- ---------- SC7: exact handle lookup only ----------
  r := pg_temp.run(a, 'select user_id::text from find_profile_by_handle(''bob_test'')');
  insert into res values ('SC7', 'exact handle finds B', r = b::text, r);
  insert into res values ('SC7', 'partial handle finds nothing',
    pg_temp.run(a, 'select count(*) from find_profile_by_handle(''bob'')') = '0', '');
  insert into res values ('SC7', 'wildcards find nothing',
    pg_temp.run(a, 'select count(*) from find_profile_by_handle(''bob%'')') = '0'
    and pg_temp.run(a, 'select count(*) from find_profile_by_handle(''%'')') = '0'
    and pg_temp.run(a, 'select count(*) from find_profile_by_handle(''_ob_test'')') = '0', '');
  insert into res values ('SC7', 'other case or null finds nothing',
    pg_temp.run(a, 'select count(*) from find_profile_by_handle(''BOB_TEST'')') = '0'
    and pg_temp.run(a, 'select count(*) from find_profile_by_handle(null)') = '0', '');
  r := pg_temp.run(null, 'select count(*) from find_profile_by_handle(''bob_test'')', 'anon');
  insert into res values ('SC7', 'signed-out cannot look up handles', r like 'ERR 42501%', r);
  insert into res values ('SC7', 'the profiles table itself is not readable by others',
    pg_temp.run(c, 'select count(*) from profiles') = '0', '');

  -- ---------- verify_shares ----------
  perform pg_temp.run(a, format('select share_note(%L, array[%L]::uuid[])', 'R9', b));
  perform pg_temp.run(a, format('select share_note(%L, array[%L]::uuid[])', 'R10', b));
  -- make drift on purpose: change notes while our own triggers are switched off
  perform set_config('idemora.share_op', '1', true);
  update notes set rag_excluded = true where id = 'D1';
  update notes set deleted_at = now() where id = 'R10';
  perform set_config('idemora.share_op', '', true);
  perform pg_temp.mk('U1', a, 'R9');   -- qualifying note in the tree that is not shared

  insert into res values ('VERIFY', 'drift exists before the check (D1, D3 still readable by B)',
    pg_temp.cnt(b, array['D1','D3']) = 2, '');
  r := pg_temp.run(b, format('select verify_shares(%L)::text', 'R9'));
  insert into res values ('VERIFY', 'B cannot verify A''s share', r like 'ERR 42501%', r);
  r := pg_temp.run(a, format('select verify_shares(%L)::text', 'R9'));
  insert into res values ('VERIFY', 'verify clears the drifted notes and reports the unshared one',
    r::jsonb ->> 'cleared' = '2' and r::jsonb ->> 'valid' = '2' and r::jsonb ->> 'unflagged_in_tree' = '1', r);
  insert into res values ('VERIFY', '...B loses D1 and D3, keeps R9 and D2; U1 is not flagged',
    pg_temp.cnt(b, array['D1','D3']) = 0 and pg_temp.cnt(b, array['R9','D2']) = 2 and pg_temp.flagged(array['U1']) = 0, '');
  r := pg_temp.run(a, format('select verify_shares(%L)::text', 'D2'));
  insert into res values ('VERIFY', 'verify on a non-root is refused', r like 'ERR P0001 not_a_share_root%', r);
  r := pg_temp.run(a, format('select verify_shares(%L)::text', 'R10'));
  insert into res values ('VERIFY', 'a trashed root takes the whole share and its grants with it',
    pg_temp.cnt(b, array['R10','R10c']) = 0 and (select count(*) from note_shares where note_id = 'R10') = 0, r);
end
$$;

select * from res order by check_id, what;

rollback;
