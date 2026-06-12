import { describe, expect, test } from 'bun:test';
import { selectBatch, pollerAction } from './query-mode.js';
import type { MessageInRow } from './db/messages-in.js';

function makeRow(overrides: Partial<MessageInRow> & { id: string }): MessageInRow {
  return {
    seq: null,
    kind: 'chat',
    timestamp: '2026-01-01T00:00:00Z',
    status: 'pending',
    process_after: null,
    recurrence: null,
    tries: 0,
    trigger: 1,
    platform_id: null,
    channel_type: null,
    thread_id: null,
    content: '{}',
    ...overrides,
  };
}

describe('selectBatch', () => {
  test('mixed chat+task pending → mode chat, rows exclude tasks', () => {
    const chat = makeRow({ id: 'c1', kind: 'chat', trigger: 1 });
    const task = makeRow({ id: 't1', kind: 'task', trigger: 1 });
    const result = selectBatch([chat, task]);
    expect(result).not.toBeNull();
    expect(result!.mode).toBe('chat');
    expect(result!.rows).toEqual([chat]);
  });

  test('task-only pending → mode task', () => {
    const task = makeRow({ id: 't1', kind: 'task', trigger: 1 });
    const result = selectBatch([task]);
    expect(result).not.toBeNull();
    expect(result!.mode).toBe('task');
    expect(result!.rows).toEqual([task]);
  });

  test('chat rows all trigger=0, no tasks → null', () => {
    const chat = makeRow({ id: 'c1', kind: 'chat', trigger: 0 });
    const result = selectBatch([chat]);
    expect(result).toBeNull();
  });

  test('chat rows all trigger=0 + due task → mode task', () => {
    const chat = makeRow({ id: 'c1', kind: 'chat', trigger: 0 });
    const task = makeRow({ id: 't1', kind: 'task', trigger: 1 });
    const result = selectBatch([chat, task]);
    expect(result).not.toBeNull();
    expect(result!.mode).toBe('task');
  });
});

describe('pollerAction', () => {
  test('chat mode: task pending → push=[], end=true', () => {
    const task = makeRow({ id: 't1', kind: 'task' });
    const action = pollerAction('chat', [task]);
    expect(action).toEqual({ push: [], end: true });
  });

  test('chat mode: chat pending → pushes it, no end', () => {
    const chat = makeRow({ id: 'c1', kind: 'chat' });
    const action = pollerAction('chat', [chat]);
    expect(action.end).toBe(false);
    expect(action.push).toEqual([chat]);
  });

  test('task mode: agent reply → pushes it, no end', () => {
    const reply = makeRow({ id: 'a1', kind: 'chat', channel_type: 'agent' });
    const action = pollerAction('task', [reply]);
    expect(action.end).toBe(false);
    expect(action.push).toEqual([reply]);
  });

  test('task mode: chat from human → end, push nothing', () => {
    const chat = makeRow({ id: 'c1', kind: 'chat', channel_type: 'telegram' });
    const action = pollerAction('task', [chat]);
    expect(action.end).toBe(true);
    expect(action.push).toEqual([]);
  });

  test('task mode: new task → end, push nothing', () => {
    const task = makeRow({ id: 't1', kind: 'task', channel_type: null });
    const action = pollerAction('task', [task]);
    expect(action.end).toBe(true);
    expect(action.push).toEqual([]);
  });

  test('task mode: agent reply + new task → end, push nothing', () => {
    const reply = makeRow({ id: 'a1', kind: 'chat', channel_type: 'agent' });
    const task = makeRow({ id: 't1', kind: 'task', channel_type: null });
    const action = pollerAction('task', [reply, task]);
    expect(action.end).toBe(true);
    expect(action.push).toEqual([]);
  });
});
