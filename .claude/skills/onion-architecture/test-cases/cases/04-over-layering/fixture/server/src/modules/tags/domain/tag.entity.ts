import { TAG_NAME_MAX, TAG_SLUG_PATTERN } from '../constants.js';

/**
 * A tag, as the rest of the module talks about it.
 *
 * Behaviour that belongs to a tag lives on the tag: renaming enforces its own
 * length and character rules, and the slug is derived rather than stored twice,
 * so no caller can construct a tag whose slug disagrees with its name.
 */
export class TagEntity {
  private constructor(
    readonly id: string,
    private _name: string,
    readonly workspaceId: string,
    readonly createdAt: Date,
  ) {}

  static rehydrate(props: {
    id: string;
    name: string;
    workspaceId: string;
    createdAt: Date;
  }): TagEntity {
    return new TagEntity(props.id, props.name, props.workspaceId, props.createdAt);
  }

  static create(name: string, workspaceId: string): TagEntity {
    const entity = new TagEntity(crypto.randomUUID(), '', workspaceId, new Date());
    entity.rename(name);
    return entity;
  }

  get name(): string {
    return this._name;
  }

  /** Derived, never stored — two tags with the same name always share a slug. */
  get slug(): string {
    return this._name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  rename(next: string): void {
    const trimmed = next.trim();
    if (trimmed.length === 0) throw new Error('A tag name cannot be empty');
    if (trimmed.length > TAG_NAME_MAX) {
      throw new Error(`A tag name cannot exceed ${TAG_NAME_MAX} characters`);
    }
    if (!TAG_SLUG_PATTERN.test(trimmed)) {
      throw new Error('A tag name may only contain letters, digits, spaces and dashes');
    }
    this._name = trimmed;
  }

  equals(other: TagEntity): boolean {
    return this.id === other.id;
  }
}
