import type { ModelMessage } from '../models/types.js';
import type { NormalizedTurnContext, TurnContextContribution } from './types.js';

type IndexedContribution = {
  contribution: TurnContextContribution;
  registrationOrder: number;
};

function compareContributionOrder(left: IndexedContribution, right: IndexedContribution): number {
  const leftPriority = left.contribution.kind === 'metadata' ? 0 : (left.contribution.priority ?? 0);
  const rightPriority = right.contribution.kind === 'metadata' ? 0 : (right.contribution.priority ?? 0);

  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }

  return left.registrationOrder - right.registrationOrder;
}

function renderResourceMessages(context: NormalizedTurnContext): ModelMessage[] {
  if (context.resources.length === 0) {
    return [];
  }

  const rendered = context.resources
    .map((resource, index) => {
      const label = resource.mimeType ? `${resource.uri} (${resource.mimeType})` : resource.uri;
      const content = resource.text?.trim() ? `${label}\n${resource.text}` : label;
      return `[Resource ${index + 1} from ${resource.sourceId}]\n${content}`;
    })
    .join('\n\n');

  return [
    {
      content: `Runtime resources for the next answer. Use only the relevant portions.\n\n${rendered}`,
      role: 'user',
    },
  ];
}

function renderMetadataMessages(context: NormalizedTurnContext): ModelMessage[] {
  const entries = Object.entries(context.metadata);

  if (entries.length === 0) {
    return [];
  }

  return [
    {
      content: `Runtime metadata for the next answer.\n\n${entries
        .map(([key, value]) => `${key}: ${JSON.stringify(value.value)}`)
        .join('\n')}`,
      role: 'user',
    },
  ];
}

export function normalizeTurnContext(contributions: readonly IndexedContribution[]): NormalizedTurnContext {
  const sorted = [...contributions].sort(compareContributionOrder);
  const messages: Array<NormalizedTurnContext['messages'][number]> = [];
  const resources: Array<NormalizedTurnContext['resources'][number]> = [];
  const metadata: Record<string, { sourceId: string; value: unknown }> = {};
  const seenResources = new Set<string>();

  for (const { contribution } of sorted) {
    if (contribution.kind === 'message') {
      messages.push({
        message: structuredClone(contribution.message),
        sourceId: contribution.sourceId,
      });
      continue;
    }

    if (contribution.kind === 'resource') {
      const resourceKey = `${contribution.sourceId}:${contribution.uri}:${contribution.mimeType ?? ''}:${contribution.text ?? ''}`;

      if (seenResources.has(resourceKey)) {
        continue;
      }

      seenResources.add(resourceKey);
      resources.push({
        mimeType: contribution.mimeType,
        sourceId: contribution.sourceId,
        text: contribution.text,
        uri: contribution.uri,
      });
      continue;
    }

    if (Object.hasOwn(metadata, contribution.key)) {
      const existing = metadata[contribution.key];
      throw new Error(
        `Turn context metadata collision for key \`${contribution.key}\` between ${existing.sourceId} and ${contribution.sourceId}.`,
      );
    }

    metadata[contribution.key] = {
      sourceId: contribution.sourceId,
      value: structuredClone(contribution.value),
    };
  }

  return Object.freeze({
    messages: Object.freeze(messages),
    metadata: Object.freeze(metadata),
    resources: Object.freeze(resources),
  });
}

export function indexCollectorContributions(
  contributionBatches: readonly { contributions: TurnContextContribution[]; registrationOrder: number }[],
): IndexedContribution[] {
  return contributionBatches.flatMap(({ contributions, registrationOrder }) =>
    contributions.map((contribution) => ({ contribution, registrationOrder })),
  );
}

export function injectTurnContextMessages(context: NormalizedTurnContext): ModelMessage[] {
  return [
    ...context.messages.map(({ message }) => structuredClone(message)),
    ...renderResourceMessages(context),
    ...renderMetadataMessages(context),
  ];
}
