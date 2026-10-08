#!/usr/bin/env bash
# Install Ubuntu build dependencies without refreshing unrelated runner vendors.
# Repository signature and package hash verification remain enabled.
set -euo pipefail

if [[ -f /etc/apt/sources.list.d/ubuntu.sources ]]; then
  source_list=/etc/apt/sources.list.d/ubuntu.sources
elif [[ -s /etc/apt/sources.list ]]; then
  source_list=/etc/apt/sources.list
else
  echo 'No Ubuntu APT source list found; refusing an unverified fallback.' >&2
  exit 1
fi

apt_options=(-o "Dir::Etc::sourcelist=$source_list" -o 'Dir::Etc::sourceparts=-')

# NOTE: measured over the last 40 tauri-build runs, this step takes 30s median /
# 482s worst — but 2 of 40 (5%) hung on it indefinitely and, with no
# timeout-minutes on the job, held a BLOCKING auto-merge check for the 6-hour
# GitHub default (observed: 113 and 35 minutes before intervention). apt-get has
# no default network timeout, so a stalled mirror connection never returns.
# Bound each attempt above the 482s worst case and retry, so the normal flake
# resolves itself instead of turning into a red gate that triggers CI repair.
ATTEMPT_TIMEOUT_SECONDS="${CI_APT_TIMEOUT_SECONDS:-600}"
# Two attempts, not three: the whole retry budget has to finish inside the
# timeout-minutes of every job that calls this, or the job is killed mid-retry
# and its blocking check goes red — a false ci_repair bounce for an apt outage.
# 2 x 600s = 20 min leaves room for the slowest caller's own work
# (Build (ubuntu-latest), ~14 min) under a 45-min job bound. A third attempt was
# unreachable there anyway, and a mirror that fails twice in a row is not fixed
# by asking again. 2026-10-07 measured the real case: attempt 1 hit the 600s cap
# in Quick Build Check and attempt 2 succeeded.
ATTEMPTS="${CI_APT_ATTEMPTS:-2}"
# Backoff multiplier between attempts; overridable so the test suite does not
# have to spend the real 10s+15s wait to exercise the retry path.
RETRY_BACKOFF_SECONDS="${CI_APT_RETRY_BACKOFF_SECONDS:-5}"

# Acquire timeouts make apt itself give up on a dead mirror rather than relying
# solely on the outer `timeout`, so a retry starts from a clean state.
apt_options+=(
  -o 'Acquire::http::Timeout=30'
  -o 'Acquire::https::Timeout=30'
  -o 'Acquire::Retries=3'
)

run_apt_with_retry() {
  local description="$1"
  shift
  local attempt=1
  local status
  while true; do
    status=0
    # DEBIAN_FRONTEND is passed as a command prefix rather than exported with
    # `sudo -E`, which a restrictive sudoers policy can refuse outright. Without
    # it a package whose postinst opens a debconf prompt waits on stdin forever.
    # `|| status=$?` instead of `if`: a failed `if` condition with no else leaves
    # $? at 0, which would report every failure as a success.
    sudo DEBIAN_FRONTEND=noninteractive timeout "${ATTEMPT_TIMEOUT_SECONDS}" "$@" || status=$?
    if [[ $status -eq 0 ]]; then
      return 0
    fi
    # 124 is `timeout`'s own exit code for "killed at the deadline".
    if [[ $status -eq 124 ]]; then
      echo "::warning::${description} exceeded ${ATTEMPT_TIMEOUT_SECONDS}s (attempt ${attempt}/${ATTEMPTS})" >&2
    else
      echo "::warning::${description} failed with exit ${status} (attempt ${attempt}/${ATTEMPTS})" >&2
    fi
    if [[ $attempt -ge $ATTEMPTS ]]; then
      echo "${description} failed after ${ATTEMPTS} attempts." >&2
      return "$status"
    fi
    attempt=$((attempt + 1))
    sleep $((attempt * RETRY_BACKOFF_SECONDS))
  done
}

run_apt_with_retry 'apt-get update' apt-get "${apt_options[@]}" update
run_apt_with_retry 'apt-get install' apt-get "${apt_options[@]}" install -y "$@"
