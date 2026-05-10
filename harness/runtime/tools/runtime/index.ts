import type { ModelToolCall, ModelToolDefinition } from '../../models/types.js';
import { freezeDeep } from '../../utils/object.js';
import type {
  ResolvedToolCall,
  ToolCatalog,
  ToolCatalogSnapshot,
  ToolDescriptor,
  ToolExecutionContext,
  ToolIdentity,
} from '../catalog.js';
import { createTextToolResult, type Tool } from '../types.js';

type StaticToolCatalogOptions = {
  sourceId?: string;
  sourceType?: 'local' | 'mcp';
  tools: Tool[];
};

function assertUniqueToolNames(tools: Tool[]): void {
  const seen = new Set<string>();
  const seenPublicNames = new Map<string, string>();

  for (const tool of tools) {
    if (seen.has(tool.name)) {
      throw new Error(`Duplicate tool name registered: ${tool.name}`);
    }

    seen.add(tool.name);

    const publicName = toProviderSafeToolName(tool.name);
    const existingName = seenPublicNames.get(publicName);

    if (existingName) {
      throw new Error(`Duplicate provider-safe tool name registered: ${publicName} (${existingName}, ${tool.name})`);
    }

    seenPublicNames.set(publicName, tool.name);
  }
}

function toProviderSafeToolName(name: string): string {
  return name.replaceAll(/[^a-zA-Z0-9_-]/g, '_');
}

function toDescriptor(tool: Tool, sourceId: string, sourceType: 'local' | 'mcp'): ToolDescriptor {
  const publicName = toProviderSafeToolName(tool.name);
  const identity: ToolIdentity = {
    originalName: tool.name,
    publicName,
    sourceId,
    sourceType,
    toolId: `${sourceId}:${tool.name}`,
  };

  const definition: ModelToolDefinition = {
    description: tool.description,
    inputSchema: structuredClone(tool.inputSchema),
    name: publicName,
  };

  return freezeDeep({ definition, identity });
}

function createSnapshot(
  toolsByToolId: Map<string, Tool>,
  descriptors: readonly ToolDescriptor[],
  descriptorsByName: Map<string, ToolDescriptor>,
): ToolCatalogSnapshot {
  return Object.freeze({
    descriptors,
    async execute(call: ResolvedToolCall, ctx: ToolExecutionContext) {
      const tool = toolsByToolId.get(call.toolId);

      if (!tool) {
        return createTextToolResult(`Unknown tool: ${call.publicName}`, { isError: true });
      }

      try {
        return await tool.execute(call.input, ctx);
      } catch (error: unknown) {
        return createTextToolResult(error instanceof Error ? error.message : String(error), { isError: true });
      }
    },
    resolve(call: ModelToolCall) {
      const descriptor = descriptorsByName.get(call.name);

      if (!descriptor) {
        return null;
      }

      return Object.freeze({
        input: structuredClone(call.input),
        originalName: descriptor.identity.originalName,
        publicName: descriptor.identity.publicName,
        rawCall: structuredClone(call),
        sourceId: descriptor.identity.sourceId,
        toolCallId: call.id,
        toolId: descriptor.identity.toolId,
      });
    },
  });
}

export function createEmptyToolCatalog(): ToolCatalog {
  return {
    async snapshot() {
      return createSnapshot(new Map<string, Tool>(), Object.freeze([]), new Map<string, ToolDescriptor>());
    },
  };
}

export function createStaticToolCatalog(options: StaticToolCatalogOptions): ToolCatalog {
  assertUniqueToolNames(options.tools);

  const sourceId = options.sourceId ?? 'local-tools';
  const sourceType = options.sourceType ?? 'local';
  const descriptors = Object.freeze(options.tools.map((tool) => toDescriptor(tool, sourceId, sourceType)));
  const toolMap = new Map(
    descriptors.map((descriptor, index) => [descriptor.identity.toolId, options.tools[index] as Tool]),
  );
  const descriptorsByName = new Map(descriptors.map((descriptor) => [descriptor.definition.name, descriptor]));

  return {
    async snapshot() {
      return createSnapshot(toolMap, descriptors, descriptorsByName);
    },
  };
}

export type { ToolCatalog, ToolCatalogSnapshot, ToolDescriptor, ToolExecutionContext, ToolIdentity };
