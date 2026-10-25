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

section() { printf '\n== %s ==\n' "$1"; }
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
if [ "$IS_ROOT" -eq 1 ] && have qm && have pct; then
  echo "-- VMs --"
  timeout 20 qm list 2>/dev/null || true
  echo "-- Containers --"
  timeout 20 pct list 2>/dev/null || true
  # Timeouts so a guest locked by a backup or migration cannot stall the scout.
  for id in $(timeout 20 qm list 2>/dev/null | awk 'NR > 1 && $3 == "running" { print $1 }'); do
    m=$(timeout 10 qm config "$id" 2>/dev/null | awk '/^memory:/ { print $2 }')
    ALLOC_RUNNING_MB=$(( ALLOC_RUNNING_MB + ${m:-0} ))
  done
  for id in $(timeout 20 pct list 2>/dev/null | awk 'NR > 1 && $2 == "running" { print $1 }'); do
    m=$(timeout 10 pct config "$id" 2>/dev/null | awk '/^memory:/ { print $2 }')
    [ -n "$m" ] || echo "  (container $id: no answer within 10 s, e.g. locked; not counted)"
    ALLOC_RUNNING_MB=$(( ALLOC_RUNNING_MB + ${m:-0} ))
  done
  echo "RAM allocated to running guests: ${ALLOC_RUNNING_MB} MB of ${MEM_TOTAL_MB} MB host RAM"
else
  echo "skipped (needs root and the qm/pct tools)"
fi

section "Storage"
if [ "$IS_ROOT" -eq 1 ] && have pvesm; then
  echo "(Total/Used/Available are in KiB)"
  timeout 30 pvesm status 2>/dev/null || true
  echo "-- storages that can hold container disks (content includes rootdir) --"
  awk '/^[a-z]+: / { name = $2 } /^[[:space:]]+content/ && /rootdir/ { print "  " name }' \
    /etc/pve/storage.cfg 2>/dev/null || true
fi
df -h / /var/lib/vz 2>/dev/null | awk 'NR == 1 || !seen[$0]++'
if have lvs && [ "$IS_ROOT" -eq 1 ]; then
  echo "-- LVM thin pools --"
  lvs --noheadings -o vg_name,lv_name,lv_size,data_percent,segtype 2>/dev/null | awk '$5 == "thin-pool"' || true
fi

section "Container templates"
if [ "$IS_ROOT" -eq 1 ] && have pveam; then
  for s in $(timeout 30 pvesm status --content vztmpl 2>/dev/null | awk 'NR > 1 { print $1 }'); do
    echo "-- on $s --"
    timeout 20 pveam list "$s" 2>/dev/null | awk 'NR > 1 { print "  " $1 }'
  done
  echo "-- Debian/Ubuntu templates offered (from the cached index) --"
  timeout 20 pveam available --section system 2>/dev/null | awk '{ print $2 }' | grep -E 'debian-1[2-9]|ubuntu-2[4-9]' | head -5 || true
else
  echo "skipped (needs root and pveam)"
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
if [ "$IS_ROOT" -eq 1 ] && have pvesm; then
  BEST=$(timeout 30 pvesm status --content rootdir 2>/dev/null | awk 'NR > 1 && $3 == "active" { if ($6 > m) { m = $6; n = $1 } } END { if (n) printf "%s %d", n, m / 1048576 }')
  if [ -n "$BEST" ]; then
    set -- $BEST
    if [ "$2" -ge "$NEED_DISK_GB" ]; then
      verdict "DISK" "OK: storage '$1' has ~$2 GiB free for container disks (need ~${NEED_DISK_GB} GiB)"
    else
      verdict "DISK" "LOW: best container storage '$1' has ~$2 GiB free (need ~${NEED_DISK_GB} GiB)"
    fi
  else
    verdict "DISK" "UNKNOWN: no active storage for container disks found"
  fi
else
  verdict "DISK" "UNKNOWN: run as root for storage details"
fi
echo
echo "Done. Nothing was changed. Paste this output back to Claude."
