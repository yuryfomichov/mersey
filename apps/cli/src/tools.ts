import { ReadFileTool, type Tool } from '../../../harness/tools.js';

export function createTools(): Tool[] {
  return [new ReadFileTool({ workspaceRoot: process.cwd() })];
}
