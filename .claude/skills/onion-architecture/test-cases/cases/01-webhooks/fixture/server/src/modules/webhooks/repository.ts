import { and, count, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { Webhook } from '@devdigest/shared';

/**
 * F9 — webhooks data-access for the `webhooks` table.
 *
 * Reads project the columns the wire type needs rather than `select()`, so a
 * caller is handed exactly the fields it renders.
 */
export class WebhooksRepository {
  constructor(private readonly db: Db) {}

  listForWorkspace(workspaceId: string): Promise<Webhook[]> {
    return this.db
      .select({
        id: t.webhooks.id,
        url: t.webhooks.url,
        events: t.webhooks.events,
        repoFullName: t.webhooks.repoFullName,
      })
      .from(t.webhooks)
      .where(eq(t.webhooks.workspaceId, workspaceId));
  }

  async countForWorkspace(workspaceId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(t.webhooks)
      .where(eq(t.webhooks.workspaceId, workspaceId));
    return row?.n ?? 0;
  }

  async insert(values: {
    workspaceId: string;
    userId: string;
    url: string;
    events: string[];
    repoFullName: string;
  }): Promise<Webhook> {
    const [row] = await this.db
      .insert(t.webhooks)
      .values(values)
      .returning({
        id: t.webhooks.id,
        url: t.webhooks.url,
        events: t.webhooks.events,
        repoFullName: t.webhooks.repoFullName,
      });
    return row;
  }

  async deleteScoped(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.webhooks)
      .where(and(eq(t.webhooks.id, id), eq(t.webhooks.workspaceId, workspaceId)))
      .returning({ id: t.webhooks.id });
    return rows.length > 0;
  }
}
