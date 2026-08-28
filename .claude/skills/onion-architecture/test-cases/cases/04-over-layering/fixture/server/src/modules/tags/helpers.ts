import type { Tag } from '@devdigest/shared';
import type { TagEntity } from './domain/tag.entity.js';

/** Entity → wire shape. The slug is computed, so it is emitted, never persisted. */
export function toTagDto(entity: TagEntity): Tag {
  return {
    id: entity.id,
    name: entity.name,
    slug: entity.slug,
    createdAt: entity.createdAt.toISOString(),
  };
}
