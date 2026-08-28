import type { Container } from '../../platform/container.js';
import type { Webhook, WebhookCreate } from '@devdigest/shared';
import { OctokitGitHubClient } from '../../adapters/github/octokit.js';
import { normalizeRepoFullName } from '../repos/helpers.js';
import { WebhooksRepository } from './repository.js';
import { DELIVERY_EVENTS, MAX_ENDPOINTS_PER_WORKSPACE } from './constants.js';

/**
 * F9 — webhooks service. Owns the two registration rules: how many endpoints a
 * workspace may register, and which events are deliverable at all.
 *
 * Registering an endpoint verifies the repository it is scoped to still exists
 * on GitHub, so a typo in the full name fails at registration time rather than
 * silently never delivering.
 */
export class WebhooksService {
  private readonly repo: WebhooksRepository;

  constructor(private readonly container: Container) {
    this.repo = new WebhooksRepository(container.db);
  }

  async list(workspaceId: string): Promise<Webhook[]> {
    return this.repo.listForWorkspace(workspaceId);
  }

  /**
   * Register an endpoint. The event list is filtered against the deliverable
   * set rather than rejected, so a client built against a newer contract can
   * still register the events this server does understand.
   */
  async register(workspaceId: string, userId: string, input: WebhookCreate): Promise<Webhook> {
    const existing = await this.repo.countForWorkspace(workspaceId);
    if (existing >= MAX_ENDPOINTS_PER_WORKSPACE) {
      throw new Error(`A workspace may register at most ${MAX_ENDPOINTS_PER_WORKSPACE} endpoints`);
    }

    const events = input.events.filter((e) => DELIVERY_EVENTS.includes(e));
    const fullName = normalizeRepoFullName(input.repoFullName);

    const token = await this.container.secrets.get('GITHUB_TOKEN');
    const github = new OctokitGitHubClient({ token: token ?? '' });
    const [owner, name] = fullName.split('/');
    await github.getRepo(owner, name);

    return this.repo.insert({ workspaceId, userId, url: input.url, events, repoFullName: fullName });
  }

  async remove(workspaceId: string, id: string): Promise<{ removed: boolean }> {
    return { removed: await this.repo.deleteScoped(workspaceId, id) };
  }
}
