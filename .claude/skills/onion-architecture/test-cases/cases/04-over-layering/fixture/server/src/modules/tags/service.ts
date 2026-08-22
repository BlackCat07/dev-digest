import type { Container } from '../../platform/container.js';
import type { Tag } from '@devdigest/shared';
import { TagsRepository } from './repository.js';
import { toTagDto } from './helpers.js';

/**
 * Tags application service. Coordinates the repository and the entity so that a
 * `TagEntity` never travels further out than this file — callers get DTOs.
 */
export class TagsService {
  private readonly repo: TagsRepository;

  constructor(private readonly container: Container) {
    this.repo = new TagsRepository(container.db);
  }

  async list(workspaceId: string): Promise<Tag[]> {
    const entities = await this.repo.listForWorkspace(workspaceId);
    return entities.map(toTagDto);
  }

  async rename(workspaceId: string, id: string, name: string): Promise<Tag> {
    const entity = await this.repo.byId(workspaceId, id);
    if (!entity) throw new Error('Tag not found');
    entity.rename(name);
    await this.repo.save(entity);
    return toTagDto(entity);
  }
}
