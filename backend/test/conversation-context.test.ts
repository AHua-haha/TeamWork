import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { contextInput, parseContextDocument, repairInterruptedTools } from '../src/core/conversation-context.js';
import { memberContextPath } from '../src/core/workspace-layout.js';
import type { ContextEntry } from '../src/core/types.js';

const document = (commands: unknown[] = []) => `# Context\n\n## Result summary\nCurrent state.\n\n## File lookup\n| Path | Description |\n| --- | --- |\n| secret.txt | Inspect only when needed |\n\n## Automatic retrieval\n\n\`\`\`json\n${JSON.stringify({ commands })}\n\`\`\`\n`;

test('context document selects prose/table without expanding lookup or including retrieval configuration', () => {
  const inputs = [{ command: 'echo ready', cwd: '/project', timeout: 3, background: true, metadata: {} }];
  const parsed = parseContextDocument(document(inputs));
  assert.deepEqual(parsed.commands, inputs);
  assert.match(parsed.text, /Current state/); assert.match(parsed.text, /secret.txt/);
  assert.doesNotMatch(parsed.text, /echo ready|Automatic retrieval/);
  assert.equal(memberContextPath('backend/metadata.json'), '.rsi/context/implement/backend/impl/README.md');
  assert.equal(memberContextPath('metadata.json'), '.rsi/context/implement/impl/README.md');
});

test('context parser ignores reserved headings and commands inside ordinary fenced examples', () => {
  const text = document().replace('Current state.', 'Current state.\n````markdown\n## Automatic retrieval\n```json\n{"commands":[{"command":"never run"}]}\n```\n````');
  const parsed = parseContextDocument(text);
  assert.deepEqual(parsed.commands, []); assert.match(parsed.text, /never run/);
});

test('invalid JSON, duplicate sections, unclosed fences and unsupported Bash inputs are repairable parse errors', () => {
  for (const text of [document().replace('"commands":[]', '"commands":'), document() + '\n## File lookup\nDuplicate', document().replace(/```\n$/, ''), document([{ command: 'ok' }, { command: 'bad', authority: 'admin' }]), document(['npm test']), document([{ command: 'x', timeout: -1 }]), document([{ command: 'x', metadata: { approval: true } }]), document().replace('## File lookup', '## Files')]) {
    assert.throws(() => parseContextDocument(text));
  }
});

test('interrupted tool exchange gets context-only missing results without modifying original history', () => {
  const assistant: ContextEntry = { messageId: 'calls', message: fauxAssistantMessage([{ type: 'toolCall', id: 'a', name: 'bash', arguments: { command: 'work' } }, { type: 'toolCall', id: 'b', name: 'read', arguments: { path: 'file' } }], { stopReason: 'toolUse' }), metadata: {} };
  const result: ContextEntry = { messageId: 'result', message: { role: 'toolResult', toolCallId: 'a', toolName: 'bash', content: [{ type: 'text', text: 'done' }], isError: false, timestamp: 1 }, metadata: {} };
  const original = [assistant, result, contextInput('Later failed activation', {})];
  const before = structuredClone(original), repaired = repairInterruptedTools(original);
  assert.deepEqual(original, before); assert.equal(repaired.length, 4);
  const missing = repaired[2]!;
  assert.equal(missing.message.role, 'toolResult');
  if (missing.message.role !== 'toolResult') throw new Error('missing error result');
  assert.equal(missing.message.toolCallId, 'b'); assert.equal(missing.message.isError, true);
  assert.match(JSON.stringify(missing.message), /not replayed/);
  assert.equal(repairInterruptedTools(repaired).length, repaired.length);
});

test('complete tool results are kept exactly without synthetic errors', () => {
  const entries = [contextInput('No tools were interrupted', {})];
  assert.deepEqual(repairInterruptedTools(entries), entries);
  assert.deepEqual(parseContextDocument(document()).commands, []);
});
