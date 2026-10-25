#!/usr/bin/env bash
# Read-only capacity check for hosting the artificial-life simulation on a
# Proxmox node. It only reads system information; it changes nothing.
#
# Run on the Proxmox host (as root for full detail):
#   bash proxmox-scout.sh | tee scout.txt
#
# What the simulation needs (measured): a small LXC container with
#   ~512 MB RAM (256 MB workable), 1 CPU core, ~4 GB disk.
# The world itself uses ~5 MB (30x30) to ~15 MB (60x60); Node.js ~50 MB.

set -u
export LC_ALL=C

NEED_RAM_MB=512
COMFY_RAM_MB=1024
NEED_DISK_GB=4

section() { printf '\n== %s ==\n' "$1"; progress "$1"; }
# Progress goes to stderr: visible in the terminal, kept out of the saved output.
progress() { printf '[scout %s] %s...\n' "$(date +%H:%M:%S)" "$1" >&2; }
have() { command -v "$1" >/dev/null 2>&1; }
IS_ROOT=0
[ "$(id -u)" -eq 0 ] && IS_ROOT=1

section "Host"
echo "hostname: $(hostname)"
echo "kernel:   $(uname -r)"
echo "uptime:   $(uptime -p 2>/dev/null || uptime)"
if have pveversion; then
  echo "proxmox:  $(pveversion 2>/dev/null)"
else
  echo "proxmox:  pveversion not found (not a Proxmox node, or not on PATH)"
fi
[ "$IS_ROOT" -eq 1 ] || echo "note:     not running as root; some Proxmox details will be skipped"

section "CPU"
CORES=$(nproc)
echo "cores (threads): $CORES"
if have lscpu; then
  lscpu | grep -E '^(Model name|Socket\(s\)|Core\(s\) per socket|Thread\(s\) per core|CPU max MHz)' | sed 's/  */ /g'
fi
read -r L1 L5 L15 _ < /proc/loadavg
echo "load average (1/5/15 min): $L1 $L5 $L15"
LOAD_PER_CORE=$(awk -v l="$L15" -v c="$CORES" 'BEGIN { printf "%.2f", l / c }')
echo "15-min load per core: $LOAD_PER_CORE  (below ~0.7 leaves room)"

# Single-core speed: a fixed arithmetic loop. Reference: 60 ms on the
# machine where the engine measured ~4 ms/tick (30x30 world).
start=$(date +%s%N)
awk 'BEGIN { s = 0; for (i = 0; i < 2000000; i++) s += i % 7; if (s < 0) print s }'
end=$(date +%s%N)
BENCH_MS=$(( (end - start) / 1000000 ))
echo "single-core benchmark: ${BENCH_MS} ms (reference 60 ms; higher = slower)"

section "Memory"
free -m
MEM_TOTAL_MB=$(awk '/^MemTotal:/ { printf "%d", $2 / 1024 }' /proc/meminfo)
MEM_AVAIL_MB=$(awk '/^MemAvailable:/ { printf "%d", $2 / 1024 }' /proc/meminfo)
echo "available (MemAvailable): ${MEM_AVAIL_MB} MB of ${MEM_TOTAL_MB} MB"
ARC_MB=0
if [ -r /proc/spl/kstat/zfs/arcstats ]; then
  ARC_MB=$(awk '$1 == "size" { printf "%d", $3 / 1048576 }' /proc/spl/kstat/zfs/arcstats)
  ARC_MAX_MB=$(awk '$1 == "c_max" { printf "%d", $3 / 1048576 }' /proc/spl/kstat/zfs/arcstats)
  echo "ZFS ARC cache: ${ARC_MB} MB in use (max ${ARC_MAX_MB} MB). It shrinks when memory is needed,"
  echo "  so real headroom is somewhat more than 'available'."
fi

section "Guests (VMs and containers)"
ALLOC_RUNNING_MB=0
# Read guest configs straight from /etc/pve (instant, no locks) instead of
# asking qm/pct, which can wait on a guest locked by a backup.
if [ -d /etc/pve/qemu-server ] || [ -d /etc/pve/lxc ]; then
  progress "reading guest configs"
  running_ids() { timeout -k 2 15 "$1" list 2>/dev/null | awk -v col="$2" 'NR > 1 && $col == "running" { print $1 }'; }
  echo "-- running guests (id, type, RAM MB, cores) --"
  for id in $(have qm && running_ids qm 3); do
    f=/etc/pve/qemu-server/$id.conf
    m=$(awk -F': ' '$1 == "memory" { print $2; exit }' "$f" 2>/dev/null)
    c=$(awk -F': ' '$1 == "cores" { print $2; exit }' "$f" 2>/dev/null)
    printf '  %-5s VM  %6s  %s\n' "$id" "${m:-?}" "${c:-?}"
    ALLOC_RUNNING_MB=$(( ALLOC_RUNNING_MB + ${m:-0} ))
  done
  for id in $(have pct && running_ids pct 2); do
    f=/etc/pve/lxc/$id.conf
    m=$(awk -F': ' '$1 == "memory" { print $2; exit }' "$f" 2>/dev/null)
    c=$(awk -F': ' '$1 == "cores" { print $2; exit }' "$f" 2>/dev/null)
    printf '  %-5s CT  %6s  %s\n' "$id" "${m:-512}" "${c:-all}"
    ALLOC_RUNNING_MB=$(( ALLOC_RUNNING_MB + ${m:-512} ))
  done
  echo "RAM allocated to running guests: ${ALLOC_RUNNING_MB} MB of ${MEM_TOTAL_MB} MB host RAM"
else
  echo "skipped (no /etc/pve; not a Proxmox host or not root)"
fi

section "Storage"
# Only local storage is measured. Network storage (NFS, SMB, PBS, ...) is
# listed but never contacted: a slow or offline share can hang any query.
BEST_NAME=""
BEST_GB=0
consider() { # name, free GiB, can hold container disks (1/0)
  [ "$3" -eq 1 ] && [ "$2" -gt "$BEST_GB" ] && { BEST_GB=$2; BEST_NAME=$1; }
  return 0
}
if [ -r /etc/pve/storage.cfg ]; then
  progress "checking local storage"
  # One line per storage: type name path pool thinpool vgname content
  awk '
    function flush() { if (name) print type, name, (path ? path : "-"), (pool ? pool : "-"), (thin ? thin : "-"), (vg ? vg : "-"), (content ? content : "-") }
    /^[a-z]+: / { flush(); type = substr($1, 1, length($1) - 1); name = $2; path = pool = thin = vg = content = ""; next }
    $1 == "path" { path = $2 } $1 == "pool" { pool = $2 } $1 == "thinpool" { thin = $2 }
    $1 == "vgname" { vg = $2 } $1 == "content" { content = $2 }
    END { flush() }' /etc/pve/storage.cfg > /tmp/scout-storages.$$
  while read -r type name path pool thin vg content; do
    ct=0; case "$content" in *rootdir*) ct=1 ;; esac
    label="for container disks: $([ "$ct" -eq 1 ] && echo yes || echo no)"
    case "$type" in
      lvmthin)
        line=$(timeout -k 2 10 lvs --noheadings --units g --nosuffix -o lv_size,data_percent "$vg/$thin" 2>/dev/null)
        if [ -n "$line" ]; then
          free=$(echo "$line" | awk '{ printf "%d", $1 * (100 - $2) / 100 }')
          echo "  $name (LVM thin $vg/$thin): ~${free} GiB free; $label"
          consider "$name" "$free" "$ct"
        else
          echo "  $name (LVM thin): could not read"
        fi ;;
      zfspool)
        free=$(timeout -k 2 10 zfs list -Hp -o avail "$pool" 2>/dev/null | awk '{ printf "%d", $1 / 1073741824 }')
        echo "  $name (ZFS $pool): ~${free:-?} GiB free; $label"
        [ -n "$free" ] && consider "$name" "$free" "$ct" ;;
      dir)
        case "$path" in
          /mnt/pve/*) echo "  $name (folder on a mounted share, $path): not checked" ;;
          *)
            free=$(timeout -k 2 10 df -Pk "$path" 2>/dev/null | awk 'NR == 2 { printf "%d", $4 / 1048576 }')
            echo "  $name (folder $path): ~${free:-?} GiB free; $label"
            [ -n "$free" ] && consider "$name" "$free" "$ct" ;;
        esac ;;
      *)
        echo "  $name ($type, network or special storage): not checked; $label" ;;
    esac
  done < /tmp/scout-storages.$$
  rm -f /tmp/scout-storages.$$
else
  echo "skipped (no /etc/pve/storage.cfg)"
fi

section "Container templates"
if [ -d /var/lib/vz/template/cache ]; then
  ls -1 /var/lib/vz/template/cache 2>/dev/null | sed 's/^/  /' | grep . || echo "  (none downloaded on 'local')"
else
  echo "skipped (no local template folder)"
fi

section "Network"
ip -br addr 2>/dev/null | grep -v '^lo ' || true
echo "bridges: $(ip -br link show type bridge 2>/dev/null | awk '{ printf "%s ", $1 }')"
echo "default route: $(ip route show default 2>/dev/null | head -1)"

section "Verdict"
verdict() { printf '%-8s %s\n' "$1" "$2"; }
if [ "$MEM_AVAIL_MB" -ge "$COMFY_RAM_MB" ]; then
  verdict "RAM" "OK: ${MEM_AVAIL_MB} MB available (need ~${NEED_RAM_MB} MB)"
elif [ $(( MEM_AVAIL_MB + ARC_MB / 2 )) -ge "$NEED_RAM_MB" ]; then
  verdict "RAM" "TIGHT: ${MEM_AVAIL_MB} MB available (+ some reclaimable ZFS cache); need ~${NEED_RAM_MB} MB"
else
  verdict "RAM" "LOW: ${MEM_AVAIL_MB} MB available; need ~${NEED_RAM_MB} MB. Free memory or shrink other guests."
fi
if awk -v x="$LOAD_PER_CORE" 'BEGIN { exit !(x < 0.7) }'; then
  verdict "CPU" "OK: load ${LOAD_PER_CORE} per core across ${CORES} cores"
else
  verdict "CPU" "BUSY: load ${LOAD_PER_CORE} per core; the simulation would compete for CPU"
fi
if [ "$BENCH_MS" -le 120 ]; then
  verdict "SPEED" "OK: ${BENCH_MS} ms benchmark (<= 2x slower than the reference machine)"
else
  verdict "SPEED" "SLOW: ${BENCH_MS} ms benchmark; expect ~$(( BENCH_MS / 60 ))x slower ticks (still fine for an always-on world)"
fi
if [ -n "$BEST_NAME" ]; then
  if [ "$BEST_GB" -ge "$NEED_DISK_GB" ]; then
    verdict "DISK" "OK: local storage '$BEST_NAME' has ~${BEST_GB} GiB free for container disks (need ~${NEED_DISK_GB} GiB)"
  else
    verdict "DISK" "LOW: best local container storage '$BEST_NAME' has ~${BEST_GB} GiB free (need ~${NEED_DISK_GB} GiB)"
  fi
else
  verdict "DISK" "UNKNOWN: no local storage for container disks found (see Storage above)"
fi
echo
echo "Done. Nothing was changed. Paste this output back to Claude."
