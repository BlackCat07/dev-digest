import type {
  LLMProvider,
  ModelInfo,
  CompletionRequest,
  CompletionResult,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';

/**
 * The real OpenRouter provider lives in @devdigest/reviewer-core and is shared
 * with the studio server. Re-exported here so runner code keeps importing its
 * provider from one place — and so "the same engine, the same model client"
 * stays literally true rather than nearly true.
 */
export { OpenRouterProvider } from '@devdigest/reviewer-core';

/**
 * Offline provider for tests: returns a canned structured value (validated
 * against the request's own schema) so the runner can be exercised end to end
 * with no API key and no network.
 */
export class MockLLMProvider implements LLMProvider {
  readonly id = 'openrouter' as const;
  /** Every structured call this provider received — "it cost nothing" is checkable. */
  readonly calls: { model: string; schemaName: string }[] = [];

  constructor(private structured: unknown) {}

  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push({ model: req.model, schemaName: req.schemaName });
    const parsed = req.schema.safeParse(this.structured);
    if (!parsed.success) {
      throw new Error(`MockLLMProvider: canned value does not match ${req.schemaName} schema`);
    }
    return {
      data: parsed.data,
      model: req.model,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      raw: JSON.stringify(this.structured),
      attempts: 1,
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [];
  }
  async complete(_req: CompletionRequest): Promise<CompletionResult> {
    throw new Error('MockLLMProvider only implements completeStructured');
  }
  async embed(_texts: string[]): Promise<number[][]> {
    return [];
  }
}

/** A provider whose model call always throws — the "result is still written" path. */
export class ThrowingLLMProvider implements LLMProvider {
  readonly id = 'openrouter' as const;
  readonly calls: { model: string }[] = [];

  constructor(private readonly message = 'model call failed') {}

  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push({ model: req.model });
    throw new Error(this.message);
  }
  async listModels(): Promise<ModelInfo[]> {
    return [];
  }
  async complete(_req: CompletionRequest): Promise<CompletionResult> {
    throw new Error(this.message);
  }
  async embed(_texts: string[]): Promise<number[][]> {
    return [];
  }
}
