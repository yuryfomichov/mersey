import assert from 'node:assert/strict';
import test from 'node:test';

import { createAsyncQueue } from './async-queue.js';

test('push delivers value to waiting consumer immediately', async () => {
  const queue = createAsyncQueue<string>();

  const nextPromise = queue.iterable.next();

  queue.push('hello');

  const result = await nextPromise;
  assert.deepEqual(result, { done: false, value: 'hello' });
});

test('push buffers value when no consumer is waiting', async () => {
  const queue = createAsyncQueue<string>();

  queue.push('hello');
  queue.push('world');

  const result = await queue.iterable.next();
  assert.deepEqual(result, { done: false, value: 'hello' });

  const second = await queue.iterable.next();
  assert.deepEqual(second, { done: false, value: 'world' });
});

test('end drains remaining buffered values before returning done', async () => {
  const queue = createAsyncQueue<string>();

  queue.push('hello');
  queue.push('world');

  queue.end();

  const first = await queue.iterable.next();
  assert.deepEqual(first, { done: false, value: 'hello' });

  const second = await queue.iterable.next();
  assert.deepEqual(second, { done: false, value: 'world' });

  const third = await queue.iterable.next();
  assert.deepEqual(third, { done: true, value: undefined });
});

test('end ignores subsequent push calls', async () => {
  const queue = createAsyncQueue<string>();

  queue.end();
  queue.push('ignored');

  const result = await queue.iterable.next();
  assert.deepEqual(result, { done: true, value: undefined });
});

test('fail rejects all waiting consumers with the error', async () => {
  const queue = createAsyncQueue<string>();

  const waiters = [queue.iterable.next(), queue.iterable.next()];

  queue.fail(new Error('queue error'));

  await assert.rejects(Promise.all(waiters), (error: Error) => {
    return error.message === 'queue error';
  });
});

test('iterable.return closes the queue and clears waiters', async () => {
  const queue = createAsyncQueue<string>();

  const waiterPromise = queue.iterable.next();

  await queue.iterable.return!();

  const result = await waiterPromise;
  assert.deepEqual(result, { done: true, value: undefined });

  queue.push('still ignored');

  const closedResult = await queue.iterable.next();
  assert.deepEqual(closedResult, { done: true, value: undefined });
});

test('fifo ordering is preserved', async () => {
  const queue = createAsyncQueue<number>();

  queue.push(1);
  queue.push(2);
  queue.push(3);

  assert.deepEqual(await queue.iterable.next(), { done: false, value: 1 });
  assert.deepEqual(await queue.iterable.next(), { done: false, value: 2 });
  assert.deepEqual(await queue.iterable.next(), { done: false, value: 3 });
});

test('values are delivered in order after being pushed one at a time', async () => {
  const queue = createAsyncQueue<string>();

  const first = queue.iterable.next();
  const second = queue.iterable.next();

  queue.push('a');
  queue.push('b');

  assert.deepEqual(await first, { done: false, value: 'a' });
  assert.deepEqual(await second, { done: false, value: 'b' });
});

test('queue can be used with for-await-of', async () => {
  const queue = createAsyncQueue<string>();

  queue.push('a');
  queue.push('b');
  queue.push('c');
  queue.end();

  const values: string[] = [];

  for await (const value of queue.iterable) {
    values.push(value);
  }

  assert.deepEqual(values, ['a', 'b', 'c']);
});

test('push does not throw if queue is ended', () => {
  const queue = createAsyncQueue<string>();

  queue.end();

  assert.doesNotThrow(() => queue.push('silently ignored'));
});
