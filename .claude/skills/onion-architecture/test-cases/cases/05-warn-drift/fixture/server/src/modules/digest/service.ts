import type { Container } from '../../platform/container.js';
import type { Digest } from '@devdigest/shared';
import * as t from '../../db/schema.js';
import { DigestRepository } from './repository.js';
import { summariseWindow } from './helpers.js';
import { DIGEST_WINDOW_DAYS } from './constants.js';

/** The row shape the assembler works in, taken from the table it is read from. */
export type ReviewRow = typeof t.reviews.$inferSelect;

/**
 * F12 — digest assembly. Reads the window's activity, hands it to the summariser
 * and returns the rendered digest.
 */
export class DigestService {
  private readonly repo: DigestRepository;

  constructor(private readonly container: Container) {
    this.repo = new DigestRepository(container.db);
  }

  async assemble(workspaceId: string): Promise<Digest> {
    const since = new Date(Date.now() - DIGEST_WINDOW_DAYS * 86_400_000);
    const rows: ReviewRow[] = await this.repo.reviewsSince(workspaceId, since);
    return summariseWindow(this.container, workspaceId, rows);
  }
}
