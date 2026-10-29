// The always-on server: one world for every viewer, saved to disk, resumed on restart.
//
//   npm run server                        build the app and server, then start
//   node dist-server/main.js [options]    start an already-built server
//
// Options (each also readable from an environment variable):
//   --port N            port to listen on (ALIFE_PORT, default 8080)
//   --host ADDR         address to bind (ALIFE_HOST, default 0.0.0.0: the whole LAN / Tailscale)
//   --data DIR          where the world is saved (ALIFE_DATA, default ./data)
//   --static DIR        the built app (ALIFE_STATIC, default ./dist)
//   --fps N             frames per second sent to each viewer (ALIFE_FPS, default 10)
//   --max-speed N       ticks-per-second limit, e.g. to keep a phone cool (ALIFE_MAX_SPEED, default 60)
//   --save-minutes N    save every N minutes (ALIFE_SAVE_MINUTES, default 5); also on shutdown
//   --keep-backups N    hourly compressed backups to keep (ALIFE_KEEP_BACKUPS, default 48)
//   --watch-only        viewers can watch and inspect, not steer (ALIFE_WATCH_ONLY=1)
//   --control-token T   secret token that unlocks full controls via ?control=T (ALIFE_CONTROL_TOKEN)
//   --control-port N    second port with full controls on the same world (ALIFE_CONTROL_PORT)

import { AlifeServer, DEFAULT_OPTIONS, type ServerOptions } from './app';

function option(args: string[], name: string, env: string): string | undefined {
  const i = args.indexOf(name);
  if (i >= 0) return args[i + 1];
  return process.env[env] || undefined;
}

function numberOption(args: string[], name: string, env: string): number | undefined {
  const raw = option(args, name, env);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number (got "${raw}")`);
  return n;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fps = numberOption(args, '--fps', 'ALIFE_FPS');
  const saveMinutes = numberOption(args, '--save-minutes', 'ALIFE_SAVE_MINUTES');
  const options: Partial<ServerOptions> = {
    port: numberOption(args, '--port', 'ALIFE_PORT') ?? DEFAULT_OPTIONS.port,
    host: option(args, '--host', 'ALIFE_HOST') ?? DEFAULT_OPTIONS.host,
    dataDir: option(args, '--data', 'ALIFE_DATA') ?? DEFAULT_OPTIONS.dataDir,
    staticDir: option(args, '--static', 'ALIFE_STATIC') ?? DEFAULT_OPTIONS.staticDir,
    frameIntervalMs: fps ? 1000 / fps : DEFAULT_OPTIONS.frameIntervalMs,
    maxTicksPerSecond: numberOption(args, '--max-speed', 'ALIFE_MAX_SPEED') ?? DEFAULT_OPTIONS.maxTicksPerSecond,
    saveEveryMs: saveMinutes ? saveMinutes * 60_000 : DEFAULT_OPTIONS.saveEveryMs,
    keepBackups: numberOption(args, '--keep-backups', 'ALIFE_KEEP_BACKUPS') ?? DEFAULT_OPTIONS.keepBackups,
    watchOnly: args.includes('--watch-only') || process.env.ALIFE_WATCH_ONLY === '1',
    controlToken: option(args, '--control-token', 'ALIFE_CONTROL_TOKEN'),
    controlPort: numberOption(args, '--control-port', 'ALIFE_CONTROL_PORT'),
  };

  const server = new AlifeServer(options);
  const port = await server.listen();
  const shown = options.host === '0.0.0.0' ? 'localhost' : options.host;
  const controlInfo = options.controlPort ? `, full-control port ${options.controlPort}` : '';
  console.log(`Artificial life server at http://${shown}:${port} (data in ${options.dataDir}${options.watchOnly ? ', watch-only' : ''}${controlInfo})`);

  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal}: saving and stopping…`);
    server
      .close()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        console.error(error);
        process.exit(1);
      });
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGHUP', () => stop('SIGHUP'));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
