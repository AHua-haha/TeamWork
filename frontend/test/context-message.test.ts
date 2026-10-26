import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Message } from '@earendil-works/pi-ai';
import { contextThreadMessage } from '../src/features/workspace/context-message.js';
import { assistant } from './fixtures.js';

test('context viewer does not attach assistant-only status to user or system messages', () => {
  const messages: Message[] = [{role:'user',content:'Shared group message',timestamp:1},{role:'system',content:'Retained instructions',timestamp:2}];
  for(const message of messages) {
    const converted=contextThreadMessage(message);
    assert.equal(converted.role,message.role);
    assert.equal('status' in converted,false);
    assert.deepEqual(converted.content,[{type:'text',text:message.content}]);
  }
});
test('context viewer scopes assistant completion and preserves native multimodal input without mutation', () => {
  const message: Message = {role:'user',content:[{type:'text',text:'See picture'},{type:'image',mimeType:'image/png',data:'aW1hZ2U='}],timestamp:1};
  const original=JSON.stringify(message);
  assert.deepEqual(contextThreadMessage(message).content,[{type:'text',text:'See picture'},{type:'image',image:'data:image/png;base64,aW1hZ2U='}]);
  assert.equal(JSON.stringify(message),original);
  const reply=assistant('Retained answer');
  assert.deepEqual(contextThreadMessage(reply).status,{type:'complete',reason:'stop'});
  const result: Message={role:'toolResult',toolCallId:'call',toolName:'read',isError:false,content:[{type:'text',text:'File contents'}],timestamp:2};
  assert.equal(contextThreadMessage(result).role,'assistant');
  assert.deepEqual(contextThreadMessage(result).status,{type:'complete',reason:'stop'});
});
