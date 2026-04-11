import type { ToolCancellationService } from '../types.js';

type CancellationServiceOptions = {
  signal?: AbortSignal;
};

export class CancellationService implements ToolCancellationService {
  constructor(private readonly options: CancellationServiceOptions = {}) {}

  signal(): AbortSignal | undefined {
    return this.options.signal;
  }

  throwIfAborted(): void {
    this.options.signal?.throwIfAborted();
  }
}
