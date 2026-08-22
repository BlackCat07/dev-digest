import type { Db } from '../db/client.js';
import { SettingsRepository } from '../modules/settings/repository.js';
import { rowsToSettings } from '../modules/settings/helpers.js';

/**
 * Cross-cutting delivery fan-out.
 *
 * Anything in the process that wants to tell a human something goes through
 * here, so the "is this channel enabled, and where does it point" decision is
 * made once instead of at every call site.
 */
export type Channel = 'slack' | 'email' | 'none';

export interface Destination {
  channel: Channel;
  target: string;
}

/**
 * Resolve where a workspace's notifications should go. Returns `none` rather
 * than throwing when nothing is configured — a workspace that has not set up a
 * channel is a normal state, not an error, and every caller here is
 * fire-and-forget.
 */
export async function resolveDestination(db: Db, workspaceId: string): Promise<Destination> {
  const repo = new SettingsRepository(db);
  const settings = rowsToSettings(await repo.listForWorkspace(workspaceId));

  if (settings.slackChannel) return { channel: 'slack', target: settings.slackChannel };
  if (settings.notifyEmail) return { channel: 'email', target: settings.notifyEmail };
  return { channel: 'none', target: '' };
}
