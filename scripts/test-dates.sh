#!/usr/bin/env bash
# Runs the server tests as if it were a few tricky moments: around New Year (when the Dutch date and
# the UTC date differ), the first and last day of a month, the daylight saving switches and a leap
# day, in UTC and in Dutch time. Finds code and tests that only work on some days of the year.
#
#   scripts/test-dates.sh                              # all moments below (about 10 minutes)
#   scripts/test-dates.sh 2027-01-01T00:30:00+01:00    # just these
#   TZS=UTC scripts/test-dates.sh                      # just these process time zones
#
# The clock is set by server/test/clock.setup.ts and runs on from the moment given.
set -u

moments=("$@")
if [ ${#moments[@]} -eq 0 ]; then
  moments=(
    2026-12-31T23:30:00+01:00 # New Year's Eve, late
    2027-01-01T00:30:00+01:00 # New Year in the Netherlands, still 31 December in UTC
    2027-01-02T09:00:00+01:00
    2027-02-28T12:00:00+01:00 # last day of February
    2027-03-01T00:30:00+01:00 # first of a month, still the last of the previous one in UTC
    2027-03-28T03:30:00+02:00 # just after summer time starts
    2027-03-31T12:00:00+02:00 # a 31st
    2027-10-31T02:30:00+01:00 # the repeated hour when summer time ends
    2028-02-29T12:00:00+01:00 # leap day
    2028-12-31T12:00:00+01:00 # day 366
  )
fi
read -r -a zones <<<"${TZS:-UTC Europe/Amsterdam}"

cd "$(dirname "$0")/../server" || exit 1
logs=$(mktemp -d)
failed=0
for tz in "${zones[@]}"; do
  for m in "${moments[@]}"; do
    log="$logs/$(echo "$m $tz" | tr -c 'A-Za-z0-9\n' '_').log"
    if FAKE_NOW="$m" TZ="$tz" npx vitest run --reporter=dot >"$log" 2>&1; then
      echo "ok    $m  TZ=$tz"
    else
      failed=$((failed + 1))
      echo "FAIL  $m  TZ=$tz  ($log)"
      grep -E '^ (FAIL|×)|AssertionError' "$log" | sort -u | head -10 | sed 's/^/        /'
    fi
  done
done
[ "$failed" -eq 0 ] && echo "All runs passed." || echo "$failed run(s) failed; logs in $logs"
[ "$failed" -eq 0 ]
