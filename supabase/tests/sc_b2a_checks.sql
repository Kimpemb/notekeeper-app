-- supabase/tests/sc_b2a_checks.sql
--
-- Checks for migration B2a (share guard, consequence trigger, share_note, unshare_note,
-- unshare_branch). Run in the LOCAL Studio SQL Editor (never live).
-- Needs users a@test.local, b@test.local, c@test.local.
-- Everything runs in one transaction that is rolled back, so no data is left behind.
-- Result: one table; every row should say ok = true.
-- Covers: SC3, SC4, SC6 (stale-row variant), SC8, SC9 and the rules around them.

begin;

create temp table res (check_id text, what text, ok boolean, detail text);
grant all on res to public;

-- run(user, sql, role): executes as that signed-in user. A statement starting with "select"
-- returns its single value as text; anything else returns 'ok'. Errors come back as text.
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

-- how many of these notes can this user read?
create function pg_temp.cnt(u uuid, ids text[]) returns int
language sql as $f$
  select pg_temp.run(u, format('select count(*) from notes where id = any(%L)', ids))::int
$f$;

-- how many of these notes are flagged as shared (read as the database owner)?
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
  v int;
  bs text;
begin
  select id into a from auth.users where email = 'a@test.local';
  select id into b from auth.users where email = 'b@test.local';
  select id into c from auth.users where email = 'c@test.local';
  if a is null or b is null or c is null then
    insert into res values ('SETUP', 'users a, b, c exist', false, format('a=%s b=%s c=%s', a, b, c));
    return;
  end if;

  -- ---------- setup (database owner, no signed-in user, so the guard is not applied) ----------
  perform pg_temp.mk('PRIV', a);
  -- main tree
  perform pg_temp.mk('R', a); perform pg_temp.mk('C1', a, 'R'); perform pg_temp.mk('C1a', a, 'C1');
  perform pg_temp.mk('C2', a, 'R');
  -- unshareable trees
  perform pg_temp.mk('R0', a);  perform pg_temp.mk('K', a, 'R0', null);
  perform pg_temp.mk('R0b', a); perform pg_temp.mk('E', a, 'R0b', 'note', true);
  perform pg_temp.mk('R0c', a); perform pg_temp.mk('P', a, 'R0c', 'pdf');
  -- source exclusion
  perform pg_temp.mk('S', a);
  perform pg_temp.mk('R2', a); perform pg_temp.mk('R2c', a, 'R2'); perform pg_temp.mk('R2cc', a, 'R2c');
  perform pg_temp.mk('R2d', a, 'R2');
  insert into publish_shares (root_copy_id, owner_id, source_root_id) values ('R2', a, 'S');
  insert into publish_links (copy_note_id, root_copy_id, owner_id, source_note_id) values ('R2c', 'R2', a, 'S');
  -- moves, trash, stop, branch, purge, excluded root
  perform pg_temp.mk('R3', a); perform pg_temp.mk('M1', a, 'R3'); perform pg_temp.mk('M2', a, 'R3');
  perform pg_temp.mk('R7', a); perform pg_temp.mk('Q1', a, 'R7'); perform pg_temp.mk('Q2', a, 'R7');
  perform pg_temp.mk('Q2a', a, 'Q2');
  perform pg_temp.mk('R4', a); perform pg_temp.mk('R4c', a, 'R4');
  perform pg_temp.mk('R5', a); perform pg_temp.mk('P1', a, 'R5');
  perform pg_temp.mk('R6', a); perform pg_temp.mk('R6c', a, 'R6');
  perform pg_temp.mk('R8', a); perform pg_temp.mk('T1', a, 'R8'); perform pg_temp.mk('T1a', a, 'T1');
  perform pg_temp.mk('T2', a, 'R8');

  -- ---------- SC8, SC3: trees that must not be shareable ----------
  r := pg_temp.run(a, format('select share_note(%L, array[%L]::uuid[])::text', 'R0', b));
  insert into res values ('SC8', 'tree with a null source_type cannot be shared',
    r like 'ERR P0001 tree_not_shareable%', r);
  insert into res values ('SC8', '...and nothing was flagged or granted',
    pg_temp.flagged(array['R0','K']) = 0 and (select count(*) from note_shares where note_id = 'R0') = 0, '');

  r := pg_temp.run(a, format('select share_note(%L, array[%L]::uuid[])::text', 'R0b', b));
  insert into res values ('SC3', 'tree with an AI-excluded note cannot be shared',
    r like 'ERR P0001 tree_not_shareable%', r);
  insert into res values ('SC3', '...and B reads nothing of it', pg_temp.cnt(b, array['R0b','E']) = 0, '');

  r := pg_temp.run(a, format('select share_note(%L, array[%L]::uuid[])::text', 'R0c', b));
  insert into res values ('SC8', 'tree with a pdf note cannot be shared',
    r like 'ERR P0001 tree_not_shareable%', r);

  -- ---------- ownership and signed-out ----------
  r := pg_temp.run(b, format('select share_note(%L, array[%L]::uuid[])::text', 'R', b));
  insert into res values ('OWN', 'B cannot share A''s note', r like 'ERR 42501%', r);
  r := pg_temp.run(null, format('select share_note(%L, array[%L]::uuid[])::text', 'R', b), 'anon');
  insert into res values ('OWN', 'signed-out role cannot call share_note', r like 'ERR 42501%', r);

  -- ---------- main share ----------
  r := pg_temp.run(a, format('select share_note(%L, array[%L]::uuid[])::text', 'R', b));
  insert into res values ('SHARE', 'A shares R to B: 4 notes flagged, 1 grant',
    r::jsonb ->> 'notes' = '4' and r::jsonb ->> 'grants_added' = '1', r);
  insert into res values ('SC1', 'B reads the tree', pg_temp.cnt(b, array['R','C1','C1a','C2']) = 4, '');
  insert into res values ('SC1', 'C (no grant) reads nothing', pg_temp.cnt(c, array['R','C1','C1a','C2']) = 0, '');
  insert into res values ('SHARE', 'root points at itself, children at the root',
    (select count(*) from notes where id = 'R' and share_root_id = 'R') = 1
    and (select count(*) from notes where id in ('C1','C1a','C2') and share_root_id = 'R') = 3, '');

  -- ---------- SC6: share state cannot be changed by a normal write ----------
  r := pg_temp.run(a, 'update notes set is_published = false, publish_visibility = null, share_root_id = null '
                      || 'where id in (''R'',''C1'',''C1a'',''C2'')');
  insert into res values ('SC6', 'stale-row write cannot clear share state',
    pg_temp.flagged(array['R','C1','C1a','C2']) = 4 and pg_temp.cnt(b, array['R','C1','C1a','C2']) = 4, r);

  r := pg_temp.run(a, 'update notes set is_published = true, publish_visibility = ''team'', share_root_id = ''R'' '
                      || 'where id = ''PRIV''');
  insert into res values ('SC6', 'a write cannot flag a private note as shared',
    pg_temp.flagged(array['PRIV']) = 0 and pg_temp.cnt(b, array['PRIV']) = 0, r);

  r := pg_temp.run(a, format('insert into notes (id, owner_id, title, source_type, is_published, publish_visibility, share_root_id) '
                      || 'values (%L, %L, %L, %L, true, %L, %L)', 'FORGED', a, 'f', 'note', 'team', 'R'));
  insert into res values ('SC6', 'an insert cannot carry share flags',
    pg_temp.flagged(array['FORGED']) = 0 and pg_temp.cnt(b, array['FORGED']) = 0, r);

  -- ---------- new notes under a shared parent ----------
  r := pg_temp.run(a, format('insert into notes (id, owner_id, title, parent_id, source_type) values (%L, %L, %L, %L, %L)',
                      'N1', a, 'n1', 'C2', 'note'));
  insert into res values ('INH', 'a new text note under a shared parent is shared at once',
    pg_temp.flagged(array['N1']) = 1 and pg_temp.cnt(b, array['N1']) = 1, r);

  r := pg_temp.run(a, format('insert into notes (id, owner_id, title, parent_id, source_type) values (%L, %L, %L, %L, null)',
                      'NX', a, 'nx', 'C2'));
  insert into res values ('INH', 'a note with null source_type under a shared parent is not shared',
    pg_temp.flagged(array['NX']) = 0, r);
  delete from notes where id = 'NX';

  r := pg_temp.run(b, format('insert into notes (id, owner_id, title, parent_id, source_type) values (%L, %L, %L, %L, %L)',
                      'BX', b, 'bx', 'R', 'note'));
  insert into res values ('INH', 'B cannot attach their own note to A''s share',
    pg_temp.flagged(array['BX']) = 0 and pg_temp.cnt(c, array['BX']) = 0, r);

  r := pg_temp.run(a, format('select share_note(%L, array[%L, %L]::uuid[])::text', 'R', a, b));
  insert into res values ('SHARE', 're-share: A''s own id and B''s existing grant add nothing; B''s note BX is ignored',
    r::jsonb ->> 'grants_added' = '0' and r::jsonb ->> 'notes' = '5', r);

  -- ---------- SC9: AI exclusion unshares the note and below ----------
  r := pg_temp.run(a, 'update notes set rag_excluded = true where id = ''C1''');
  insert into res values ('SC9', 'excluding a shared note unshares it and its subtree',
    pg_temp.cnt(b, array['C1','C1a']) = 0 and pg_temp.flagged(array['C1','C1a']) = 0, r);
  insert into res values ('SC9', '...the rest of the share is untouched',
    pg_temp.cnt(b, array['R','C2','N1']) = 3, '');

  perform pg_temp.run(a, format('select share_note(%L, array[%L]::uuid[])', 'R6', b));
  r := pg_temp.run(a, 'update notes set rag_excluded = true where id = ''R6''');
  insert into res values ('SC9', 'excluding a share root stops the whole share and removes grants',
    pg_temp.cnt(b, array['R6','R6c']) = 0 and (select count(*) from note_shares where note_id = 'R6') = 0, r);

  perform pg_temp.run(a, format('select share_note(%L, array[%L]::uuid[])', 'R2', b));
  insert into res values ('SC9', 'copy tree R2 is readable before the source is excluded',
    pg_temp.cnt(b, array['R2','R2c','R2cc','R2d']) = 4, '');
  r := pg_temp.run(a, 'update notes set rag_excluded = true where id = ''S''');
  insert into res values ('SC9', 'excluding a SOURCE note unshares its copy branch',
    pg_temp.cnt(b, array['R2c','R2cc']) = 0 and pg_temp.cnt(b, array['R2','R2d']) = 2, r);

  -- ---------- moves, trash, purge ----------
  perform pg_temp.run(a, format('select share_note(%L, array[%L]::uuid[])', 'R3', b));
  r := pg_temp.run(a, 'update notes set parent_id = ''PRIV'' where id = ''M1''');
  insert into res values ('MOVE', 'moving a shared note out of its share unshares it',
    pg_temp.cnt(b, array['M1']) = 0 and pg_temp.cnt(b, array['R3','M2']) = 2, r);
  r := pg_temp.run(a, 'update notes set deleted_at = now() where id = ''M2''');
  insert into res values ('TRASH', 'trashing a shared copy note stops sharing it',
    pg_temp.cnt(b, array['M2']) = 0 and pg_temp.cnt(b, array['R3']) = 1, r);
  r := pg_temp.run(a, 'update notes set deleted_at = now() where id = ''R3''');
  insert into res values ('TRASH', 'trashing the root stops the whole share and removes grants',
    pg_temp.cnt(b, array['R3']) = 0 and (select count(*) from note_shares where note_id = 'R3') = 0, r);

  perform pg_temp.run(a, format('select share_note(%L, array[%L]::uuid[])', 'R7', b));
  r := pg_temp.run(a, 'update notes set parent_id = ''Q1'' where id = ''Q2a''');
  insert into res values ('MOVE', 'moving a note inside its own share keeps it shared',
    pg_temp.cnt(b, array['Q2a']) = 1 and pg_temp.flagged(array['Q2a']) = 1, r);
  r := pg_temp.run(a, 'update notes set parent_id = ''R7'' where id = ''PRIV''');
  insert into res values ('MOVE', 'moving a private note INTO a share does not share it',
    pg_temp.cnt(b, array['PRIV']) = 0 and pg_temp.flagged(array['PRIV']) = 0, r);

  perform pg_temp.run(a, format('select share_note(%L, array[%L]::uuid[])', 'R5', b));
  r := pg_temp.run(a, 'select purge_note(''P1'', 0)::text');
  insert into res values ('PURGE', 'purging a shared copy note stops sharing it',
    pg_temp.cnt(b, array['P1']) = 0 and pg_temp.flagged(array['P1']) = 0 and pg_temp.cnt(b, array['R5']) = 1, r);

  -- ---------- SC4: Stop sharing, then re-share ----------
  perform pg_temp.run(a, format('select share_note(%L, array[%L]::uuid[])', 'R4', b));
  insert into res values ('SC4', 'B reads R4 before Stop sharing', pg_temp.cnt(b, array['R4','R4c']) = 2, '');
  r := pg_temp.run(c, 'select unshare_note(''R4'')::text');
  insert into res values ('SC4', 'C cannot stop A''s share', r like 'ERR 42501%', r);
  r := pg_temp.run(a, 'select unshare_note(''R4'')::text');
  insert into res values ('SC4', 'Stop sharing: B loses access at once', pg_temp.cnt(b, array['R4','R4c']) = 0, r);
  insert into res values ('SC4', '...grants are gone, flags cleared, copy stays for A',
    (select count(*) from note_shares where note_id = 'R4') = 0
    and pg_temp.flagged(array['R4','R4c']) = 0 and pg_temp.cnt(a, array['R4','R4c']) = 2, '');
  r := pg_temp.run(a, format('select share_note(%L, array[%L]::uuid[])::text', 'R4', b));
  insert into res values ('SC4', 're-share with the same ids restores B''s access',
    pg_temp.cnt(b, array['R4','R4c']) = 2, r);

  -- ---------- unshare_branch ----------
  perform pg_temp.run(a, format('select share_note(%L, array[%L]::uuid[])', 'R8', b));
  r := pg_temp.run(a, 'select unshare_branch(''T1'')::text');
  insert into res values ('BRANCH', 'unshare_branch removes one note and its subtree',
    r::jsonb ->> 'notes' = '2' and pg_temp.cnt(b, array['T1','T1a']) = 0 and pg_temp.cnt(b, array['R8','T2']) = 2, r);
  insert into res values ('BRANCH', '...the grant on the root stays',
    (select count(*) from note_shares where note_id = 'R8') = 1, '');
end
$$;

select * from res order by check_id, what;

rollback;
