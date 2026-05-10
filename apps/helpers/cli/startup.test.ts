import assert from 'node:assert/strict';
import test from 'node:test';

import { getStartupStatusLines } from './startup.js';

test('getStartupStatusLines returns no output for ready startup', () => {
  assert.deepEqual(
    getStartupStatusLines({
      diagnostics: [],
      sources: [],
      status: 'ready',
    }),
    [],
  );
});

test('getStartupStatusLines formats degraded diagnostics for app display', () => {
  assert.deepEqual(
    getStartupStatusLines({
      diagnostics: [
        {
          code: 'collector_warning',
          message: 'Recall backend unavailable',
          severity: 'warning',
          sourceId: 'memory',
        },
      ],
      sources: [
        {
          required: false,
          sourceId: 'memory',
          status: 'degraded',
        },
      ],
      status: 'degraded',
    }),
    ['startup: degraded', 'warning: memory: Recall backend unavailable'],
  );
});

test('getStartupStatusLines falls back to source status when diagnostics are absent', () => {
  assert.deepEqual(
    getStartupStatusLines({
      diagnostics: [],
      sources: [
        {
          message: 'Index opened in read-only mode',
          required: false,
          sourceId: 'markdown-rag',
          status: 'degraded',
        },
      ],
      status: 'degraded',
    }),
    ['startup: degraded', 'degraded: markdown-rag: Index opened in read-only mode'],
  );
});
