import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { responseOutput } from '../src/response-output.js';

test('response routing requires an explicit exclusive response action and never inspects natural language', () => {
  assert.equal(responseOutput(fauxAssistantMessage('Final answer: let me check')), undefined);
  const action = {type:'toolCall' as const,id:'response',name:'final_response',arguments:{text:'Answer'}};
  assert.deepEqual(responseOutput(fauxAssistantMessage([{type:'text',text:'Working commentary'},action])),{response:{toolCallId:'response',text:'Answer'}});
  assert.equal(responseOutput(fauxAssistantMessage([action,{...action,id:'other',name:'read'}])),undefined);
  assert.equal(responseOutput(fauxAssistantMessage([action,{...action,id:'other'}])),undefined);
  assert.deepEqual(responseOutput(fauxAssistantMessage([{...action,arguments:{}}])),{response:{toolCallId:'response',text:''}});
});
