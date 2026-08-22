/** Events an endpoint may subscribe to. */
export const DELIVERY_EVENTS = ['review.completed', 'review.failed', 'pr.imported'] as const;

/** Registration cap per workspace — keeps one tenant from fanning out the job runner. */
export const MAX_ENDPOINTS_PER_WORKSPACE = 20;
