import type { Container } from '../../platform/container.js';
import type {
  ConnTestResult,
  Provider,
  SecretsStatus,
  Settings,
  SettingsUpdate,
} from '@devdigest/shared';
import { SettingsRepository } from './repository.js';
import { GITHUB_PROVIDER, SECRET_KEY_BY_PROVIDER } from './constants.js';
import { rowsToSettings } from './helpers.js';

/**
 * F1 — settings service. Non-secret prefs (read/upsert) plus the two
 * secret-adjacent use cases the Settings screen needs: which provider keys are
 * configured, and a live connection test for one provider.
 *
 * Secret VALUES never appear in anything returned from here — `secretsStatus`
 * reports booleans and `testConnection` reports a message.
 */
export class SettingsService {
  private readonly repo: SettingsRepository;

  constructor(private readonly container: Container) {
    this.repo = new SettingsRepository(container.db);
  }

  /** Current non-secret prefs for a workspace, as the flat wire object. */
  async get(workspaceId: string): Promise<Settings> {
    return rowsToSettings(await this.repo.listForWorkspace(workspaceId));
  }

  /** Upsert the supplied prefs, then return the whole (merged) settings object. */
  async update(workspaceId: string, userId: string, patch: SettingsUpdate): Promise<Settings> {
    await this.repo.upsertMany(
      Object.entries(patch).map(([key, value]) => ({ workspaceId, userId, key, value })),
    );
    return this.get(workspaceId);
  }

  /**
   * Which provider keys are configured — booleans only, so the API Keys panel can
   * render "Configured / Not set" without the value ever leaving the server.
   */
  async secretsStatus(): Promise<SecretsStatus> {
    const entries = await Promise.all(
      (Object.entries(SECRET_KEY_BY_PROVIDER) as [keyof SecretsStatus, string][]).map(
        async ([provider, key]) =>
          [provider, Boolean(await this.container.secrets.get(key))] as const,
      ),
    );
    return Object.fromEntries(entries) as SecretsStatus;
  }

  /**
   * Test one provider's key with a cheap live call (GitHub `GET /user`, or the
   * LLM adapter's model list). A supplied key is persisted FIRST, so the test
   * reflects — and the rest of the app immediately uses — the new value.
   *
   * A failure is a RESULT, not an exception: the Settings screen renders the
   * message inline next to the field, so an unreachable provider or a bad key
   * must not become a 500.
   */
  async testConnection(provider: Provider | 'github', key?: string): Promise<ConnTestResult> {
    try {
      if (key) {
        if (!this.container.secrets.set) {
          return { provider, ok: false, message: 'Secrets backend is read-only' };
        }
        await this.container.secrets.set(SECRET_KEY_BY_PROVIDER[provider], key);
        this.container.invalidateSecretCaches();
      }
      if (provider === GITHUB_PROVIDER) {
        const gh = await this.container.github();
        const login = await gh.currentLogin();
        return { provider, ok: true, message: `Connected as @${login}` };
      }
      const llm = await this.container.llm(provider);
      const models = await llm.listModels();
      return { provider, ok: true, message: `OK — ${models.length} models available` };
    } catch (err) {
      return { provider, ok: false, message: (err as Error).message };
    }
  }
}
