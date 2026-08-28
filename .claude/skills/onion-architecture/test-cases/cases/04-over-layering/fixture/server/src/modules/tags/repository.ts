import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { TagEntity } from './domain/tag.entity.js';

/**
 * Tag persistence. Every read hands back a `TagEntity` rather than a row, so the
 * name and slug rules travel with the value and no caller can bypass them.
 */
export class TagsRepository {
  constructor(private readonly db: Db) {}

  async listForWorkspace(workspaceId: string): Promise<TagEntity[]> {
    const rows = await this.db
      .select({
        id: t.tags.id,
        name: t.tags.name,
        workspaceId: t.tags.workspaceId,
        createdAt: t.tags.createdAt,
      })
      .from(t.tags)
      .where(eq(t.tags.workspaceId, workspaceId))
      .orderBy(asc(t.tags.name));

    return rows.map((row) => TagEntity.rehydrate(row));
  }

  async save(tag: TagEntity): Promise<void> {
    await this.db
      .update(t.tags)
      .set({ name: tag.name })
      .where(and(eq(t.tags.id, tag.id), eq(t.tags.workspaceId, tag.workspaceId)));
  }

  async byId(workspaceId: string, id: string): Promise<TagEntity | null> {
    const [row] = await this.db
      .select({
        id: t.tags.id,
        name: t.tags.name,
        workspaceId: t.tags.workspaceId,
        createdAt: t.tags.createdAt,
      })
      .from(t.tags)
      .where(and(eq(t.tags.id, id), eq(t.tags.workspaceId, workspaceId)));

    return row ? TagEntity.rehydrate(row) : null;
  }
}
