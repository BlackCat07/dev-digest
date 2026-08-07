import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SecretsProvider, SecretKey } from '@devdigest/shared';

/**
 * LocalSecretsProvider — writable MVP secrets backend.
 *
 * Reads stored overrides from a JSON file on disk (BYO keys entered via the
 * UI), falling back to process.env when a key has not been set. Writes persist
 * to the same file (mode 0600) so keys survive restarts. GITHUB_TOKEN is the
 * canonical key; GITHUB_PAT is still read as a fallback for back-compat.
 *
 * Stored values take precedence over env so a key entered in the UI wins.
 * Swap for a VaultSecretsProvider later without touching call sites.
 */
export class LocalSecretsProvider implements SecretsProvider {
  private cache: Record<string, string> | null = null;
  /** mtime the cache was read at; -1 = no file existed then. */
  private cachedMtimeMs = -1;

  constructor(
    private readonly filePath: string,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  /**
   * Load stored overrides, re-reading whenever the file changed underneath us.
   *
   * The cache used to be read once per process. `set` goes through this class, so
   * a key entered in the Settings UI was picked up — but a key added by hand to
   * `~/.devdigest/secrets.json`, or written by a second process (the CI runner,
   * a `tsx` script), stayed invisible until a restart. An `mtime` compare costs
   * one `stat` per read and removes that whole class of "I set the key and it
   * still says Not set".
   */
  private async load(): Promise<Record<string, string>> {
    let mtimeMs = -1;
    try {
      mtimeMs = (await stat(this.filePath)).mtimeMs;
    } catch {
      // Missing file → -1, which still differs from a real mtime, so a file that
      // appears later invalidates the empty cache.
    }
    if (this.cache && mtimeMs === this.cachedMtimeMs) return this.cache;

    let data: Record<string, string> = {};
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf8'));
      if (parsed && typeof parsed === 'object') data = parsed as Record<string, string>;
    } catch {
      // Missing or unreadable file → no stored overrides yet.
    }
    this.cache = data;
    this.cachedMtimeMs = mtimeMs;
    return data;
  }

  async get(key: SecretKey): Promise<string | undefined> {
    const stored = (await this.load())[key as string];
    if (stored) return stored;
    if (key === 'GITHUB_TOKEN') return this.env.GITHUB_TOKEN ?? this.env.GITHUB_PAT;
    return this.env[key as string];
  }

  async set(key: SecretKey, value: string): Promise<void> {
    const data = await this.load();
    data[key as string] = value;
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    // Our own write must not look like someone else's: adopt the new mtime so the
    // next read serves this cache instead of re-parsing the file we just wrote.
    try {
      this.cachedMtimeMs = (await stat(this.filePath)).mtimeMs;
    } catch {
      // Unreadable right after a successful write is not worth failing `set` for;
      // the stale mtime simply forces one extra re-read.
    }
  }
}
