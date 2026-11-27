#!/usr/bin/env bash
# supabase/tests/run_all.sh
#
# Runs every supabase/tests/sc_*_checks.sql against the LOCAL Supabase database (the Docker
# container started by `npx supabase start`) and prints a summary. Local only: it talks to
# the container through `docker exec`, never to the live project.
#
# Needs: Docker running, the local stack up, users a@test.local, b@test.local and
# c@test.local (Studio, Authentication, Users, Auto Confirm ticked).
#
# Each script runs in its own transaction and rolls back, so nothing is left behind.
# Usage (from the repo root):  bash supabase/tests/run_all.sh
# Exit code: 0 when every check is true, 1 when any check fails or errors, 2 on setup problems.

set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB="$(docker ps --filter "name=supabase_db_" --format '{{.Names}}' | head -n 1)"

if [ -z "$DB" ]; then
  echo "Local Supabase database container not found."
  echo "Start Docker Desktop, then run: npx supabase start"
  exit 2
fi
echo "Using local container: $DB"

shopt -s nullglob
files=("$DIR"/sc_*_checks.sql)
if [ ${#files[@]} -eq 0 ]; then
  echo "No sc_*_checks.sql files found in $DIR"
  exit 2
fi

total_ok=0
total_bad=0
any_error=0

for f in "${files[@]}"; do
  name="$(basename "$f")"
  # -q: no command tags; -A -t -F '|': plain rows "check_id|what|ok|detail"
  out="$(docker exec -i "$DB" psql -U postgres -d postgres -q -A -t -F '|' -P pager=off < "$f" 2>&1)"

  errors="$(printf '%s\n' "$out" | grep -ci '^psql:.*error\|^error')"
  ok="$(printf '%s\n' "$out" | awk -F'|' 'NF>=3 && $3=="t"' | wc -l | tr -d ' ')"
  bad="$(printf '%s\n' "$out" | awk -F'|' 'NF>=3 && $3=="f"' | wc -l | tr -d ' ')"

  printf '%-28s true=%-4s false=%-4s errors=%s\n' "$name" "$ok" "$bad" "$errors"

  if [ "$bad" -gt 0 ]; then
    printf '%s\n' "$out" | awk -F'|' 'NF>=3 && $3=="f" { printf "   FAIL  %s | %s | %s\n", $1, $2, $4 }'
  fi
  if [ "$errors" -gt 0 ]; then
    printf '%s\n' "$out" | grep 'ERROR' | head -5 | sed 's/^/   /'
    any_error=1
  fi
  if [ "$ok" -eq 0 ] && [ "$bad" -eq 0 ]; then
    echo "   no result rows: the script did not run to its final select (see errors above)"
    any_error=1
  fi

  total_ok=$((total_ok + ok))
  total_bad=$((total_bad + bad))
done

echo "----------------------------------------"
echo "TOTAL true=$total_ok false=$total_bad"
if [ "$total_bad" -gt 0 ] || [ "$any_error" -ne 0 ]; then
  echo "SECURITY CHECKS: NOT PASSING"
  exit 1
fi
echo "SECURITY CHECKS: ALL PASS"
exit 0
