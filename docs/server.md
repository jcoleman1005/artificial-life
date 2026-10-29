# The always-on server

One world that keeps running whether or not anyone is watching. Any browser
that opens the server's address watches and steers that same world.

## Running it

```bash
npm ci                 # once (needs the dev dependencies to build)
npm run server         # build the app and the server, then start on port 8080
npm run server:start   # start again without rebuilding
```

Open `http://<host>:8080` on any device on the LAN or Tailscale. The status
line in Settings and Stats says "shared world on the server" in this mode.
Stop with Ctrl+C (or SIGTERM): it saves first.

| Option | Environment | Default | |
|---|---|---|---|
| `--port N` | `ALIFE_PORT` | 8080 | |
| `--host ADDR` | `ALIFE_HOST` | 0.0.0.0 | every interface (LAN, Tailscale); `127.0.0.1` for this machine only |
| `--data DIR` | `ALIFE_DATA` | `./data` | where the world is saved |
| `--static DIR` | `ALIFE_STATIC` | `./dist` | the built app |
| `--fps N` | `ALIFE_FPS` | 25 | frames per second sent to each viewer |
| `--max-speed N` | `ALIFE_MAX_SPEED` | 60 | ticks-per-second limit (the page's 10× is 60) |
| `--save-minutes N` | `ALIFE_SAVE_MINUTES` | 5 | also saves on shutdown, play/pause/speed, and before a reset or load |
| `--keep-backups N` | `ALIFE_KEEP_BACKUPS` | 48 | hourly compressed backups kept |
| `--watch-only` | `ALIFE_WATCH_ONLY=1` | off | viewers can watch, inspect and save copies, not steer |

## How it works

- `server/app.ts` runs the same `SimulationHost` the Web Worker uses, with
  any number of viewers. Playback, settings, reset and load are shared; each
  viewer has its own selected organism, tabs and overlay.
- The page asks `GET /api/info` when it opens. If it is talking to the server
  it streams the world from `GET /api/events` (Server-Sent Events) and
  sends commands with `POST /api/command`; otherwise (Vite, a static host) it
  runs its own world in a Web Worker as before. The messages are the ones in
  `src/sim/protocol.ts` either way.
- Frames go out at most `--fps` times a second per viewer, with the ticks in
  between merged in (events and panels are never dropped). A slow connection
  is sent fewer frames instead of falling behind.
- The browser's own auto-save and resume are off in server mode. Branch
  points and files still work: they copy the server's world into the
  browser, and loading one replaces the shared world (backed up first).
- `GET /api/world` downloads the current world, e.g. for
  `npm run experiment -- --from world.json`.

Files in the data directory:

- `world.json`: the latest save, in the same format as a file saved from the
  app (so it loads there too).
- `playback.json`: whether it was playing and how fast; a fresh server plays
  at 1×.
- `backups/world-<time>-tick-<n>.json.gz`: hourly, plus one before every
  reset or load from a viewer. To restore one: stop the server,
  `gunzip -c backups/<file> > world.json`, start it again.

A damaged `world.json` stops the server at start-up instead of silently
starting a new world; restore a backup or move the file away.

To develop the page against a running server: `ALIFE_SERVER=http://localhost:8080 npm run dev`.

## On the Galaxy S21 (Termux)

Hosting decision and battery care are in `docs/STATUS.md` (Hosting plan).

1. Install Termux and Termux:Boot from F-Droid. Turn battery optimisation off
   for both; Settings → Battery → Protect battery on.
2. In Termux:
   ```bash
   pkg install nodejs git
   git clone https://github.com/jcoleman1005/artificial-life.git
   cd artificial-life
   npm ci
   npm run perf          # the speed check from the roadmap
   npm run build && npm run build:server
   ```
3. Start on boot:
   ```bash
   mkdir -p ~/.termux/boot
   cp scripts/termux-boot.sh ~/.termux/boot/alife
   chmod +x ~/.termux/boot/alife
   ~/.termux/boot/alife   # start it now too
   ```
   It takes a wake lock, caps the speed at 30 ticks/s, and logs to
   `~/alife-server.log`.
4. Install Tailscale on the phone and open `http://<phone's Tailscale name>:8080`
   from other devices.
5. Back up `~/artificial-life/data` to Proxmox (`JRC-Vault`) regularly, e.g.
   `rsync -a ~/artificial-life/data/ <vault>:alife-data/` from a cron job or
   by hand.

To update: `git pull && npm ci && npm run build && npm run build:server`,
then stop the server (`pkill -f dist-server/main.js`, which saves) and run
`~/.termux/boot/alife` again. Saves from older versions load with neutral
defaults for new fields.

Don't expose the server to the public internet as it is: anyone who can reach
it can steer the world. For a public link use `--watch-only` (or a second,
watch-only server) behind Cloudflare Tunnel (`cloudflared tunnel --protocol http2 run --token ...` on Termux/Android, since Android drops unprivileged QUIC handshakes), as now running for `orbitalis.jcoleman.us`.
