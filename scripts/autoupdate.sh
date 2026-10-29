#!/data/data/com.termux/files/usr/bin/bash
# ~/artificial-life/scripts/autoupdate.sh
# Auto-update + restart for the artificial-life Node server on Termux.
#
# - Checks origin/main for new commits
# - On change: stop server, pull, build, restart
# - On build failure: roll back to the previous commit, rebuild it, restart
# - Safe to run from cron (sets its own PATH/HOME, uses a lock, never hangs)

# NOTE: no `set -e` on purpose: we handle every failure explicitly so the
# rollback/restart path always runs.
set -u
set -o pipefail

# ---------- config ----------
# Every value can be overridden from the environment. The defaults are what you
# want in production; test-autoupdate.sh overrides them to run in a sandbox.
REPO_DIR="${ALIFE_REPO_DIR:-$HOME/artificial-life}"
BRANCH="${ALIFE_BRANCH:-main}"
REMOTE="origin"
UPDATE_LOG="${ALIFE_UPDATE_LOG:-$HOME/alife-autoupdate.log}"
SERVER_LOG="${ALIFE_SERVER_LOG:-$HOME/alife-server.log}"
SERVER_ENTRY="${ALIFE_SERVER_ENTRY:-dist-server/main.js}"
SERVER_MATCH="node $SERVER_ENTRY"
MAX_SPEED=30
WATCH_ONLY="${ALIFE_WATCH_ONLY:-1}"
CONTROL_PORT="${ALIFE_CONTROL_PORT:-8081}"
CONTROL_TOKEN_FILE="${ALIFE_CONTROL_TOKEN_FILE:-$HOME/.alife-control-token}"
LOCK_DIR="${ALIFE_LOCK_DIR:-$HOME/.alife-autoupdate.lock}"
BUILT_SHA_FILE="$REPO_DIR/.git/alife-built-sha"
RUNNING_SHA_FILE="$REPO_DIR/.git/alife-running-sha"
MAX_LOG_BYTES=1048576   # rotate logs above ~1 MB
# ----------------------------

# cron has a minimal environment; make sure Termux binaries are found.
export PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
export PATH="$PREFIX/bin:$PREFIX/bin/applets:$PATH"
export HOME="${HOME:-/data/data/com.termux/files/home}"
export GIT_TERMINAL_PROMPT=0   # never block waiting for credentials

log() { printf '%s [autoupdate] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$UPDATE_LOG"; }

rotate_log() {
  local f="$1" size
  [ -f "$f" ] || return 0
  size=$(wc -c < "$f" 2>/dev/null || echo 0)
  if [ "$size" -gt "$MAX_LOG_BYTES" ]; then
    tail -n 2000 "$f" > "$f.tmp" 2>/dev/null && mv "$f.tmp" "$f"
  fi
}

# ---------- single-instance lock (mkdir is atomic) ----------
acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo $$ > "$LOCK_DIR/pid"
    return 0
  fi
  local old
  old=$(cat "$LOCK_DIR/pid" 2>/dev/null || true)
  if [ -n "$old" ] && kill -0 "$old" 2>/dev/null; then
    log "Another update run (pid $old) is active; exiting."
    return 1
  fi
  log "Removing stale lock (pid ${old:-unknown})."
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR" 2>/dev/null || return 1
  echo $$ > "$LOCK_DIR/pid"
}
release_lock() { rm -rf "$LOCK_DIR"; }

# ---------- server helpers ----------
server_running() { pgrep -f "$SERVER_MATCH" >/dev/null 2>&1; }

stop_server() {
  if ! server_running; then
    log "Server not running; nothing to stop."
    return 0
  fi
  log "Stopping server..."
  pkill -f "$SERVER_MATCH"
  local i
  for i in $(seq 1 50); do
    server_running || { log "Server stopped."; return 0; }
    sleep 0.2
  done
  log "Server ignored SIGTERM; sending SIGKILL."
  pkill -9 -f "$SERVER_MATCH"
  sleep 1
}

hold_wake_lock() {
  if command -v termux-wake-lock >/dev/null 2>&1; then
    termux-wake-lock >/dev/null 2>&1 && log "Wake lock acquired." || log "WARNING: termux-wake-lock failed."
  else
    log "WARNING: termux-wake-lock not found (pkg install termux-api, and install the Termux:API app)."
  fi
}

start_server() {
  hold_wake_lock
  if server_running; then
    log "Server already running; not starting a second copy."
    return 0
  fi
  if [ ! -f "$REPO_DIR/$SERVER_ENTRY" ]; then
    log "ERROR: $SERVER_ENTRY missing; cannot start server."
    return 1
  fi
  cd "$REPO_DIR" || return 1
  local control_token="${ALIFE_CONTROL_TOKEN:-}"
  if [ -z "$control_token" ] && [ -f "$CONTROL_TOKEN_FILE" ]; then
    control_token=$(tr -d '\r\n' < "$CONTROL_TOKEN_FILE")
  fi
  log "Starting server (ALIFE_MAX_SPEED=$MAX_SPEED ALIFE_WATCH_ONLY=$WATCH_ONLY ALIFE_CONTROL_PORT=$CONTROL_PORT)..."
  if command -v setsid >/dev/null 2>&1; then
    ALIFE_MAX_SPEED=$MAX_SPEED ALIFE_WATCH_ONLY=$WATCH_ONLY ALIFE_CONTROL_PORT=$CONTROL_PORT ALIFE_CONTROL_TOKEN="$control_token" setsid nohup node "$SERVER_ENTRY" </dev/null >> "$SERVER_LOG" 2>&1 &
  else
    ALIFE_MAX_SPEED=$MAX_SPEED ALIFE_WATCH_ONLY=$WATCH_ONLY ALIFE_CONTROL_PORT=$CONTROL_PORT ALIFE_CONTROL_TOKEN="$control_token" nohup node "$SERVER_ENTRY" </dev/null >> "$SERVER_LOG" 2>&1 &
  fi
  sleep 1
  if server_running; then
    local head_sha
    head_sha=$(git -C "$REPO_DIR" rev-parse HEAD 2>/dev/null || true)
    if [ -n "$head_sha" ]; then
      echo "$head_sha" > "$RUNNING_SHA_FILE"
      [ -f "$BUILT_SHA_FILE" ] || echo "$head_sha" > "$BUILT_SHA_FILE"
    fi
    log "Server is up."
    return 0
  fi
  log "ERROR: server exited right after launch. Check $SERVER_LOG."
  return 1
}

# ---------- build ----------
# Runs all three steps; returns non-zero on the first failure.
# Skips `npm install` when node_modules exists and package manifests are unchanged.
build_all() {
  cd "$REPO_DIR" || return 1
  local prev_sha="${1:-}" step
  for step in "npm install" "npm run build" "npm run build:server"; do
    if [ "$step" = "npm install" ] && [ -d "$REPO_DIR/node_modules" ] && [ -n "$prev_sha" ] \
       && git diff --quiet "$prev_sha" HEAD -- package.json package-lock.json 2>/dev/null; then
      log "Skipping npm install (package.json and package-lock.json unchanged)."
      continue
    fi
    log "Running: $step"
    if ! $step >> "$UPDATE_LOG" 2>&1; then
      log "ERROR: '$step' failed."
      return 1
    fi
  done
  git -C "$REPO_DIR" rev-parse HEAD > "$BUILT_SHA_FILE" 2>/dev/null || true
  return 0
}

# ---------- main ----------
rotate_log "$UPDATE_LOG"
rotate_log "$SERVER_LOG"

if [ ! -d "$REPO_DIR/.git" ]; then
  log "ERROR: $REPO_DIR is not a git repository."
  exit 1
fi

acquire_lock || exit 0
trap release_lock EXIT

cd "$REPO_DIR" || { log "ERROR: cannot cd to $REPO_DIR"; exit 1; }

# 1. Check for updates (lightweight ls-remote first; only fetch when SHA differs)
LOCAL=$(git rev-parse HEAD)
BUILT_SHA=$(cat "$BUILT_SHA_FILE" 2>/dev/null || true)
RUNNING_SHA=$(cat "$RUNNING_SHA_FILE" 2>/dev/null || true)

REMOTE_SHA=$(git ls-remote --heads "$REMOTE" "refs/heads/$BRANCH" 2>>"$UPDATE_LOG" | awk '{print $1}')
if [ -z "$REMOTE_SHA" ]; then
  log "git fetch failed (offline?). Will retry next run."
  # Watchdog: keep the server alive even when the network is down.
  server_running || start_server
  exit 0
fi

if [ "$LOCAL" != "$REMOTE_SHA" ]; then
  if ! git fetch "$REMOTE" "$BRANCH" >> "$UPDATE_LOG" 2>&1; then
    log "git fetch failed (offline?). Will retry next run."
    server_running || start_server
    exit 0
  fi
  REMOTE_SHA=$(git rev-parse "$REMOTE/$BRANCH")
fi

# Up to date, or local is somehow ahead of remote.
if [ "$LOCAL" = "$REMOTE_SHA" ] || git merge-base --is-ancestor "$REMOTE_SHA" "$LOCAL" 2>/dev/null; then
  # If someone ran `git pull` manually without building, or dist-server is missing,
  # rebuild while the server runs and then restart so the running server matches HEAD.
  if [ ! -f "$REPO_DIR/$SERVER_ENTRY" ] || { [ -n "$BUILT_SHA" ] && [ "$BUILT_SHA" != "$LOCAL" ]; }; then
    log "Local HEAD (${LOCAL:0:8}) differs from last built version (${BUILT_SHA:0:8}); rebuilding and restarting."
    if build_all "$BUILT_SHA" && stop_server && start_server; then
      log "Update complete."
      exit 0
    fi
    log "ERROR: rebuild/restart of ${LOCAL:0:8} failed."
    exit 1
  fi
  if ! server_running; then
    log "Up to date (${LOCAL:0:8})."
    log "Server was not running; starting it (watchdog)."
    start_server
    exit $?
  fi
  if [ -n "$RUNNING_SHA" ] && [ "$RUNNING_SHA" != "$LOCAL" ]; then
    log "Server is running ${RUNNING_SHA:0:8} but HEAD is ${LOCAL:0:8}; restarting."
    stop_server
    start_server
    exit $?
  fi
  log "Up to date (${LOCAL:0:8})."
  exit 0
fi

log "Update found: ${LOCAL:0:8} -> ${REMOTE_SHA:0:8}"
PREV_COMMIT="$LOCAL"   # explicit SHA is safer than HEAD@{1} (reflog can be pruned/disabled)

# 2. Pull & rebuild BEFORE stopping the server (minimizes server downtime)
# Discard any local changes to tracked files (e.g. package-lock.json or
# package.json modified by npm) so they cannot block a pull.
git reset --hard HEAD >> "$UPDATE_LOG" 2>&1 || true

if { git pull --ff-only "$REMOTE" "$BRANCH" >> "$UPDATE_LOG" 2>&1 || { git pull --rebase "$REMOTE" "$BRANCH" >> "$UPDATE_LOG" 2>&1 || { git rebase --abort >> "$UPDATE_LOG" 2>&1; git pull --rebase -X theirs "$REMOTE" "$BRANCH" >> "$UPDATE_LOG" 2>&1 || { git rebase --abort >> "$UPDATE_LOG" 2>&1; git reset --hard "$REMOTE/$BRANCH" >> "$UPDATE_LOG" 2>&1; }; }; }; } && build_all "$PREV_COMMIT"; then
  # 3. Swap server to the newly built version
  log "Build succeeded at $(git rev-parse --short HEAD)."
  stop_server
  if start_server; then
    log "Update complete."
    exit 0
  fi
  log "New version failed to start; rolling back."
else
  log "Pull or build failed; rolling back."
fi

# 4. Rollback & safety
log "Resetting to previous commit ${PREV_COMMIT:0:8}."
if ! git reset --hard "$PREV_COMMIT" >> "$UPDATE_LOG" 2>&1; then
  log "CRITICAL: git reset to $PREV_COMMIT failed."
fi

if build_all "$PREV_COMMIT"; then
  log "Rollback build succeeded."
else
  log "CRITICAL: rollback build failed; trying to start whatever dist-server exists."
fi

if server_running || start_server; then
  log "Service restored on previous version (${PREV_COMMIT:0:8}). Remote ${REMOTE_SHA:0:8} is broken; will retry on next run."
  exit 1
fi

log "CRITICAL: server is DOWN and could not be restarted. Manual intervention required."
exit 2
