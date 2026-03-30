import { EditFileTool, ReadFileTool, WriteFileTool, type Tool } from '../../../harness/tools.js';

export function createTools(): Tool[] {
  return [
    new ReadFileTool({ workspaceRoot: process.cwd() }),
    new WriteFileTool({ workspaceRoot: process.cwd() }),
    new EditFileTool({ workspaceRoot: process.cwd() }),
  ];
}
