/**
 * Review module constants.
 */

/**
 * Studio review strategy. 'single-pass' = send the WHOLE diff in ONE LLM call.
 * We deliberately do NOT use 'auto'/map-reduce by default: map-reduce makes one
 * call PER FILE, which is slow and fragile (any single file's transient 5xx
 * fails the entire run) and unnecessary — the whole diff already fits the
 * model's context.
 */
export const REVIEW_STRATEGY = 'single-pass' as const;

/**
 * How many of a review's queued agent runs may be in flight at once.
 *
 * The executor used to run the queue strictly sequentially; it now runs a
 * bounded worker pool of this size, and a free slot is refilled the instant one
 * run settles rather than when the whole in-flight set drains.
 *
 * WHY 4, and not 8. One run issues one structured request at a time — but that
 * request is not one request to the provider. `StructuredRequest.timeoutMs` is
 * silently ignored (the timeout is a constructor option on the OpenAI client)
 * and `maxRetries` defaults to 2, i.e. up to THREE attempts of up to 90s each
 * for a single call. So the worst case here is 4 × 3 = TWELVE provider requests
 * in flight for one review, where the sequential loop's worst case was three.
 * Four is the largest bound that keeps that multiple in the same order of
 * magnitude as the old behaviour while still making a fan-out worth doing.
 *
 * Raising it is a provider-rate-limit decision, not a code decision: measure the
 * 429 rate at the new bound before changing this number.
 */
export const MAX_CONCURRENT_AGENT_RUNS = 4;
