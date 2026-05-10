import assert from 'node:assert/strict';
import test from 'node:test';

import { getToolContentPartTelemetryLength, projectToolResultToText, sanitizeToolExecutionResult } from './result.js';

test('projectToolResultToText renders cyclic JSON parts without throwing', () => {
  const value: Record<string, unknown> = { name: 'root' };
  value.self = value;

  const text = projectToolResultToText({
    parts: [{ type: 'json', value }],
  });

  assert.match(text, /"name": "root"/);
  assert.match(text, /"self": "\[circular\]"/);
});

test('tool result helpers tolerate non-JSON primitive values', () => {
  const result = sanitizeToolExecutionResult({
    parts: [{ type: 'json', value: { count: 123n } }],
  });

  assert.deepEqual(result.parts, [{ type: 'json', value: { count: '123' } }]);
  assert.equal(projectToolResultToText(result), '{\n  "count": "123"\n}');
});

test('getToolContentPartTelemetryLength tolerates cyclic JSON parts', () => {
  const value: Record<string, unknown> = { name: 'root' };
  value.self = value;

  assert.doesNotThrow(() => getToolContentPartTelemetryLength({ type: 'json', value }));
});
