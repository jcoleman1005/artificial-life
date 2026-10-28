import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { constants as zlibConstants, createGzip } from 'node:zlib';
import { SimulationHost } from '../src/sim/host';
import type { ToWorker } from '../src/sim/protocol';
import { encodeMessage, ViewerStream } from './viewer-stream';
import { WorldStore } from './store';

export interface ServerOptions {
  /** Where world.json, playback.json and backups/ live. */
  readonly dataDir: string;
  /** The built app (`npm run build` output). */
  readonly staticDir: string;
  readonly port: number;
  readonly host: string;
  /** At most one frame per viewer this often. */
  readonly frameIntervalMs: number;
  readonly saveEveryMs: number;
  readonly backupEveryMs: number;
  readonly keepBackups: number;
  /** Speed limit in ticks per second (e.g. to keep a phone cool). */
  readonly maxTicksPerSecond: number;
  /** Viewers can watch and inspect but not change the world. */
  readonly watchOnly: boolean;
  /** Optional secret token that unlocks full controls on a watch-only server (?control=TOKEN or X-Control-Token). */
  readonly controlToken?: string;
  /** Optional second port that always has full controls over the same world (e.g. for a separate tunnel hostname). */
  readonly controlPort?: number;
  readonly log?: (line: string) => void;
}

export const DEFAULT_OPTIONS: ServerOptions = {
  dataDir: 'data',
  staticDir: 'dist',
  port: 8080,
  host: '0.0.0.0',
  frameIntervalMs: 40,
  saveEveryMs: 5 * 60 * 1000,
  backupEveryMs: 60 * 60 * 1000,
  keepBackups: 48,
  maxTicksPerSecond: 60,
  watchOnly: false,
};

/** Speed of a fresh world (the page's ½×). */
const DEFAULT_TICKS_PER_SECOND = 3;
const MAX_BODY_BYTES = 64 * 1024 * 1024;
/** Frames wait while a viewer's connection has this much unsent. */
const MAX_QUEUED_BYTES = 1024 * 1024;
const KEEPALIVE_MS = 15_000;

/** Commands that replace or reconfigure the shared world (refused when watch-only). */
const SHARED_COMMANDS = new Set<ToWorker['kind']>(['reset', 'config', 'load']);
const ALL_COMMANDS = new Set<ToWorker['kind']>([...SHARED_COMMANDS, 'play', 'pause', 'step', 'speed', 'select', 'panels', 'csv', 'save', 'inspectBrain']);

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

const timers = {
  now: () => performance.now(),
  schedule: (fn: () => void, ms: number) => setTimeout(fn, ms),
  cancel: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * The always-on server: runs one world for everyone, keeps it saved, and
 * serves the app. A page opened from here watches and steers this world
 * instead of running its own (see src/ui/simulation-client.ts).
 *
 *   GET  /api/info      what this server is (the page checks it to pick server mode)
 *   GET  /api/events    the world as a stream of messages (Server-Sent Events)
 *   POST /api/command   one page-to-world message (header X-Viewer: the stream's id)
 *   GET  /api/world     the current world as a SavedWorld file
 *   GET  /*             the built app
 */
export class AlifeServer {
  public readonly host: SimulationHost;
  public readonly store: WorldStore;
  private readonly options: ServerOptions;
  private readonly http: Server;
  private readonly controlHttp: Server | null;
  private readonly streams = new Map<number, { stream: ViewerStream; end: () => void }>();
  private saveTimer: ReturnType<typeof setInterval> | undefined;
  private lastBackup = 0;
  private readonly log: (line: string) => void;

  constructor(options: Partial<ServerOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.log = this.options.log ?? ((line) => console.log(`[${new Date().toISOString()}] ${line}`));
    this.store = new WorldStore(this.options.dataDir, this.options.keepBackups);
    this.host = new SimulationHost(timers);

    const saved = this.store.loadWorld();
    if (saved) {
      this.host.handle({ kind: 'load', saved });
      this.log(`Resumed the saved world at tick ${saved.world.tick} (saved ${saved.savedAt})`);
    } else {
      this.log(`No saved world in ${this.options.dataDir}; starting a new one (seed ${String(this.host.world.config.seed)})`);
    }
    const playback = this.store.loadPlayback() ?? { running: true, ticksPerSecond: DEFAULT_TICKS_PER_SECOND };
    this.host.handle({ kind: 'speed', ticksPerSecond: Math.min(playback.ticksPerSecond, this.options.maxTicksPerSecond) });
    if (playback.running) this.host.handle({ kind: 'play' });

    const makeServer = (fromControlPort: boolean) =>
      createServer((req, res) => {
        this.route(req, res, fromControlPort).catch((error: unknown) => {
          this.log(`Error on ${req.method} ${req.url}: ${(error as Error).stack ?? String(error)}`);
          if (!res.headersSent) sendJson(res, 500, { error: 'Internal error' });
          else res.end();
        });
      });
    this.http = makeServer(false);
    this.controlHttp = this.options.controlPort ? makeServer(true) : null;
  }

  /** Starts listening and saving. Resolves with the port actually used. */
  public async listen(): Promise<number> {
    this.saveTimer = setInterval(() => this.saveNow(), this.options.saveEveryMs);
    this.lastBackup = Date.now();
    const port = await new Promise<number>((resolvePort, reject) => {
      this.http.once('error', reject);
      this.http.listen(this.options.port, this.options.host, () => {
        const address = this.http.address();
        resolvePort(typeof address === 'object' && address ? address.port : this.options.port);
      });
    });
    if (this.controlHttp && this.options.controlPort) {
      await new Promise<void>((resolveControl, reject) => {
        this.controlHttp!.once('error', reject);
        this.controlHttp!.listen(this.options.controlPort, this.options.host, () => resolveControl());
      });
    }
    return port;
  }

  /** Saves, backing up when one is due (or when `forceBackup`). */
  public saveNow(forceBackup = false): void {
    try {
      const saved = this.host.save();
      this.store.save(saved, this.host.playback());
      if (forceBackup || Date.now() - this.lastBackup >= this.options.backupEveryMs) {
        this.lastBackup = Date.now();
        this.store.backup(saved);
      }
    } catch (error) {
      this.log(`Save failed: ${(error as Error).message}`);
    }
  }

  /** Saves, pauses the world and closes every connection. */
  public async close(): Promise<void> {
    clearInterval(this.saveTimer);
    this.saveNow();
    this.host.handle({ kind: 'pause' });
    for (const { end } of this.streams.values()) end();
    const closed = new Promise<void>((done) => this.http.close(() => done()));
    this.http.closeAllConnections();
    if (this.controlHttp) {
      const controlClosed = new Promise<void>((done) => this.controlHttp!.close(() => done()));
      this.controlHttp.closeAllConnections();
      await controlClosed;
    }
    await closed;
  }

  private isWatchOnly(req: IncomingMessage, url: URL, fromControlPort: boolean): boolean {
    if (!this.options.watchOnly || fromControlPort) return false;
    const expected = this.options.controlToken;
    if (expected) {
      const headerToken = req.headers['x-control-token'];
      const queryToken = url.searchParams.get('control') ?? url.searchParams.get('admin');
      if (headerToken === expected || queryToken === expected) return false;
    }
    return true;
  }

  private readBuildId(): string {
    try {
      const html = readFileSync(join(resolve(this.options.staticDir), 'index.html'));
      return createHash('sha1').update(html).digest('hex').slice(0, 12);
    } catch {
      return 'dev';
    }
  }

  private async route(req: IncomingMessage, res: ServerResponse, fromControlPort = false): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const watchOnly = this.isWatchOnly(req, url, fromControlPort);
    if (url.pathname === '/api/info' && req.method === 'GET') {
      sendJson(res, 200, {
        app: 'alife-server',
        version: 1,
        buildId: this.readBuildId(),
        frameIntervalMs: this.options.frameIntervalMs,
        maxTicksPerSecond: this.options.maxTicksPerSecond,
        watchOnly,
        tick: this.host.world.tick,
        viewers: this.host.viewerCount,
      });
    } else if (url.pathname === '/api/events' && req.method === 'GET') {
      this.openStream(req, res);
    } else if (url.pathname === '/api/command' && req.method === 'POST') {
      await this.command(req, res, watchOnly);
    } else if (url.pathname === '/api/world' && req.method === 'GET') {
      const saved = this.host.save();
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="alife-world-tick-${saved.world.tick}.json"`,
      });
      res.end(JSON.stringify(saved));
    } else if (url.pathname.startsWith('/api/')) {
      sendJson(res, 404, { error: 'No such endpoint' });
    } else if (req.method === 'GET' || req.method === 'HEAD') {
      await this.serveStatic(url.pathname, res);
    } else {
      sendJson(res, 405, { error: 'Method not allowed' });
    }
  }

  private openStream(req: IncomingMessage, res: ServerResponse): void {
    req.socket.setNoDelay(true);
    const acceptsGzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // ask proxies not to hold the stream back
      ...(acceptsGzip ? { 'Content-Encoding': 'gzip' } : {}),
    });
    const gzip = acceptsGzip
      ? createGzip({ flush: zlibConstants.Z_SYNC_FLUSH, level: zlibConstants.Z_BEST_SPEED })
      : null;
    if (gzip) gzip.pipe(res);
    const write = (text: string) => {
      if (gzip) {
        gzip.write(text);
        gzip.flush(zlibConstants.Z_SYNC_FLUSH);
      } else {
        res.write(text);
      }
    };
    const queued = () => res.writableLength + (gzip ? gzip.writableLength : 0);

    const stream = new ViewerStream((m) => write(`data: ${encodeMessage(m)}\n\n`), this.options.frameIntervalMs, timers, () => queued() < MAX_QUEUED_BYTES);
    // The id comes first, so the page can send commands as soon as the world arrives.
    const buildId = this.readBuildId();
    const id = this.host.connect(
      (m) => stream.post(m),
      (viewer) => write(`event: hello\ndata: ${JSON.stringify({ viewer, buildId })}\n\n`)
    );
    const keepalive = setInterval(() => write(': keepalive\n\n'), KEEPALIVE_MS);
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      clearInterval(keepalive);
      stream.close();
      this.host.disconnect(id);
      this.streams.delete(id);
      if (gzip) gzip.end();
      else res.end();
      this.log(`Viewer ${id} left (${this.host.viewerCount} watching)`);
    };
    this.streams.set(id, { stream, end });
    req.on('close', end);
    res.on('error', end);
    this.log(`Viewer ${id} joined from ${req.socket.remoteAddress ?? '?'} (${this.host.viewerCount} watching)`);
  }

  private async command(req: IncomingMessage, res: ServerResponse, watchOnly = this.options.watchOnly): Promise<void> {
    const viewerId = Number(req.headers['x-viewer']);
    if (!this.streams.has(viewerId)) {
      sendJson(res, 409, { error: 'Unknown viewer; reconnect the event stream first' });
      return;
    }
    let message: ToWorker;
    try {
      message = JSON.parse(await readBody(req)) as ToWorker;
    } catch (error) {
      sendJson(res, 400, { error: (error as Error).message });
      return;
    }
    if (!message || !ALL_COMMANDS.has(message.kind)) {
      sendJson(res, 400, { error: 'Unknown command' });
      return;
    }
    if (watchOnly && SHARED_COMMANDS.has(message.kind)) {
      sendJson(res, 403, { error: 'This server is watch-only' });
      return;
    }
    if (message.kind === 'speed') {
      message = { kind: 'speed', ticksPerSecond: Math.min(message.ticksPerSecond, this.options.maxTicksPerSecond) };
    }
    if (message.kind === 'reset' || message.kind === 'load') {
      this.saveNow(true); // the world about to be replaced stays in backups/
      this.log(`Viewer ${viewerId}: ${message.kind} (backed up tick ${this.host.world.tick} first)`);
    }
    this.host.handle(message, viewerId);
    if (message.kind === 'play' || message.kind === 'pause' || message.kind === 'speed') {
      this.store.save(this.host.save(), this.host.playback());
    }
    res.writeHead(204).end();
  }

  private async serveStatic(pathname: string, res: ServerResponse): Promise<void> {
    const root = resolve(this.options.staticDir);
    const relative = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
    const path = resolve(join(root, relative === '' ? 'index.html' : relative));
    if (path !== root && !path.startsWith(root + sep)) {
      sendJson(res, 403, { error: 'Forbidden' });
      return;
    }
    let body: Buffer;
    try {
      body = await readFile(path);
    } catch {
      if (relative === '' || relative === 'index.html') {
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`The app is not built yet: run "npm run build" (looked in ${root}).\n`);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found\n');
      }
      return;
    }
    const type = CONTENT_TYPES[extname(path)] ?? 'application/octet-stream';
    // Vite's hashed assets never change; the page itself must always be fresh.
    const cache = relative.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-store';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache, 'Content-Length': body.length });
    res.end(body);
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
