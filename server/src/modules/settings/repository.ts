import { eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { SettingsRow } from './helpers.js';

/**
 * F1 — settings data-access. The ONLY layer touching the `settings` table.
 * Non-secret prefs only; provider keys live in the SecretsProvider, never here.
 *
 * Reads project the two columns the DTO mapper needs rather than `select()`, so
 * no Drizzle Row type leaves this ring (a `select()` would hand `id`,
 * `workspace_id` and `user_id` to callers that have no use for them).
 */
export class SettingsRepository {
  constructor(private readonly db: Db) {}

  /** Every pref row for a workspace, as the flat pairs `rowsToSettings` expects. */
  listForWorkspace(workspaceId: string): Promise<SettingsRow[]> {
    return this.db
      .select({ key: t.settings.key, value: t.settings.value })
      .from(t.settings)
      .where(eq(t.settings.workspaceId, workspaceId));
  }

  /**
   * Upsert every supplied pref in ONE statement — atomic without a transaction,
   * where a per-key loop could leave preferences half-saved if one key failed.
   *
   * `excluded.value` is required: a multi-row upsert cannot share a single static
   * `set` value, each conflicting row must take its own incoming value.
   */
  async upsertMany(
    values: { workspaceId: string; userId: string; key: string; value: unknown }[],
  ): Promise<void> {
    if (values.length === 0) return;
    await this.db
      .insert(t.settings)
      .values(values)
      .onConflictDoUpdate({
        target: [t.settings.workspaceId, t.settings.userId, t.settings.key],
        set: { value: sql`excluded.value` },
      });
  }
}
