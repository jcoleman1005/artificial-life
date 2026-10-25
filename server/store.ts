import { mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { isSavedWorld, type SavedWorld } from '../src/sim/protocol';
import type { PlaybackState } from '../src/sim/host';

/**
 * The server's files, all in one data directory:
 *
 *   world.json            the latest save (a SavedWorld, the same format as
 *                         a file saved from the app, so it can be loaded there)
 *   playback.json         whether the world was playing, and how fast
 *   backups/*.json.gz     an hourly compressed copy, the newest `keepBackups` kept
 *
 * Every write goes to a temporary file first and is then renamed over the
 * old one, so a crash or power cut mid-write never leaves a broken save.
 */
export class WorldStore {
  private readonly backupDir: string;

  constructor(
    private readonly dir: string,
    private readonly keepBackups = 48
  ) {
    this.backupDir = join(dir, 'backups');
    mkdirSync(this.backupDir, { recursive: true });
  }

  /** The saved world, or null if there is none yet. Throws on a damaged file rather than starting over silently. */
  public loadWorld(): SavedWorld | null {
    const text = readOrNull(join(this.dir, 'world.json'));
    if (text === null) return null;
    const parsed: unknown = JSON.parse(text);
    if (!isSavedWorld(parsed)) throw new Error(`${join(this.dir, 'world.json')} is not a saved world`);
    return parsed;
  }

  public loadPlayback(): PlaybackState | null {
    const text = readOrNull(join(this.dir, 'playback.json'));
    if (text === null) return null;
    try {
      const p = JSON.parse(text) as Partial<PlaybackState>;
      return typeof p.running === 'boolean' && typeof p.ticksPerSecond === 'number'
        ? { running: p.running, ticksPerSecond: p.ticksPerSecond }
        : null;
    } catch {
      return null;
    }
  }

  public save(saved: SavedWorld, playback: PlaybackState): void {
    atomicWrite(join(this.dir, 'world.json'), JSON.stringify(saved));
    atomicWrite(join(this.dir, 'playback.json'), JSON.stringify(playback));
  }

  /** A compressed copy named by time and tick; the oldest beyond the limit are deleted. */
  public backup(saved: SavedWorld): string {
    const stamp = saved.savedAt.replace(/[:.]/g, '-');
    const name = `world-${stamp}-tick-${saved.world.tick}.json.gz`;
    atomicWrite(join(this.backupDir, name), gzipSync(JSON.stringify(saved)));
    const all = this.listBackups();
    for (const old of all.slice(0, Math.max(0, all.length - this.keepBackups))) unlinkSync(join(this.backupDir, old));
    return name;
  }

  /** Backup file names, oldest first. */
  public listBackups(): string[] {
    return readdirSync(this.backupDir)
      .filter((f) => f.endsWith('.json.gz'))
      .sort();
  }
}

function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function atomicWrite(path: string, data: string | Uint8Array): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}
