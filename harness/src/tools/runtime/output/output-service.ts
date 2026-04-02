import type { ToolExecutionPolicy, ToolOutputLimitResult, ToolOutputService } from '../types.js';
import { getDefaultToolResultBytes, limitText } from './output-utils.js';

export class OutputService implements ToolOutputService {
  constructor(private readonly policy: ToolExecutionPolicy) {}

  limitResult(text: string): ToolOutputLimitResult {
    return limitText(text, this.policy.maxToolResultBytes ?? getDefaultToolResultBytes());
  }

  limitText(
    text: string,
    maxBytes: number = this.policy.maxToolResultBytes ?? getDefaultToolResultBytes(),
  ): ToolOutputLimitResult {
    return limitText(text, maxBytes);
  }
}
