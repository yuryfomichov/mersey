import type {
  ToolCancellationService,
  ToolExecutionContext,
  ToolExecutionPolicy,
  ToolFileAccess,
  ToolFileService,
  ToolOutputLimitResult,
  ToolOutputService,
  ToolPathDenyRule,
} from '../../src/tools/runtime/types.js';
import type { ToolCommandRunner } from './commands/types.js';

export type {
  ToolCancellationService,
  ToolExecutionContext,
  ToolExecutionPolicy,
  ToolFileAccess,
  ToolFileService,
  ToolOutputLimitResult,
  ToolOutputService,
  ToolPathDenyRule,
} from '../../src/tools/runtime/types.js';

export type ToolRuntimeServices = {
  cancellation: ToolCancellationService;
  commands: ToolCommandRunner;
  files: ToolFileService;
  output: ToolOutputService;
};
