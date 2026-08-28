import { Octokit } from 'octokit';
import type { Container } from '../../platform/container.js';
import { ExportsRepository } from './repository.js';
import { orderItems, render, type ExportItem, type ExportRequest } from './types.js';

/**
 * F13 — export assembly. Reads what the workspace already has, tops it up with
 * the pull request titles, and serialises the result.
 */
export class ExportsService {
  private readonly repo: ExportsRepository;

  constructor(private readonly container: Container) {
    this.repo = new ExportsRepository(container.db);
  }

  async build(workspaceId: string, repoFullName: string, req: ExportRequest): Promise<string> {
    const stored = await this.repo.itemsFor(workspaceId, req.prNumbers, req.includeFindings);

    const token = await this.container.secrets.get('GITHUB_TOKEN');
    const octokit = new Octokit({ auth: token });
    const [owner, repo] = repoFullName.split('/');

    const items: ExportItem[] = [];
    for (const row of stored) {
      if (row.title.length > 0) {
        items.push(row);
        continue;
      }
      const { data } = await octokit.rest.pulls.get({ owner, repo, pull_number: row.prNumber });
      items.push({ ...row, title: data.title });
    }

    return render(orderItems(items), req.format);
  }
}
