import { WebClient } from '@slack/web-api';
import type { ReviewSummary } from '@devdigest/shared';
import { ReviewService } from '../../modules/reviews/service.js';

/**
 * Slack delivery. Posts one message per completed review into the channel the
 * workspace configured.
 *
 * The message is built here rather than by the caller because Slack's Block Kit
 * shape is a vendor detail: callers hand over a review id and a channel, and get
 * back the permalink Slack assigned.
 */
export interface SlackPost {
  channel: string;
  permalink: string;
}

export class SlackNotifier {
  private readonly web: WebClient;

  constructor(
    token: string,
    private readonly reviews: ReviewService,
  ) {
    this.web = new WebClient(token);
  }

  /**
   * Post the summary of one review. The review is re-read at post time rather
   * than passed in, so a message never carries figures that were superseded
   * while the delivery sat in the retry queue.
   */
  async postReview(reviewId: string, channel: string): Promise<SlackPost> {
    const summary: ReviewSummary = await this.reviews.summaryFor(reviewId);

    const res = await this.web.chat.postMessage({
      channel,
      text: `Review finished — score ${summary.score}`,
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*${summary.prTitle}*\nScore ${summary.score}` },
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: summary.findings.map((f) => `• ${f.title}`).join('\n') },
        },
      ],
    });

    return { channel, permalink: String(res.ts ?? '') };
  }
}
