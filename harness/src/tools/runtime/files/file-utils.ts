import { basename, extname } from 'node:path';

import type { ToolFileAccess, ToolPathDenyRule } from '../types.js';

function normalizePolicyPath(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+/g, '/').replace(/\/$/, '');

  return normalized || '.';
}

function matchesPathPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function matchesDenyRule(
  path: string,
  toolName: string,
  access: ToolFileAccess,
  rule: ToolPathDenyRule,
): boolean {
  if (rule.access && !rule.access.includes(access)) {
    return false;
  }

  if (rule.tools && !rule.tools.includes(toolName)) {
    return false;
  }

  const fileBasename = basename(path);
  const hasSelector = rule.path || rule.pathPrefix || rule.basename || rule.basenamePrefix || rule.extension;

  if (!hasSelector) {
    return false;
  }

  if (rule.path && normalizePolicyPath(rule.path) !== path) {
    return false;
  }

  if (rule.pathPrefix && !matchesPathPrefix(path, normalizePolicyPath(rule.pathPrefix))) {
    return false;
  }

  if (rule.basename && rule.basename !== fileBasename) {
    return false;
  }

  if (rule.basenamePrefix && !fileBasename.startsWith(rule.basenamePrefix)) {
    return false;
  }

  if (rule.extension && rule.extension !== extname(fileBasename)) {
    return false;
  }

  return true;
}

export function getPolicyError(toolName: string, path: string, rule: ToolPathDenyRule): Error {
  const reason = rule.reason ? ` (${rule.reason})` : '';

  return new Error(`${toolName} path is blocked by tool policy: ${path}${reason}`);
}

export function assertWriteSizeWithinLimit(content: string, maxBytes: number, toolName: string): void {
  const size = Buffer.byteLength(content, 'utf8');

  if (size > maxBytes) {
    throw new Error(`${toolName} refuses content larger than ${maxBytes} bytes.`);
  }
}

export function normalizeRelativePolicyPath(path: string): string {
  return normalizePolicyPath(path);
}
