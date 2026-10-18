import type { AssistantMessage, AssistantMessageFrame } from '@earendil-works/pi-ai';
import { parseStreamingJson } from '@earendil-works/pi-ai/utils/json-parse';
import { ProtocolError } from './sse.js';

export type ProgressEvent = Exclude<AssistantMessageFrame, { type: 'start' }> | { type: 'start'; message: AssistantMessage };

/** Incremental projection of Pi compact frames; only the changed content block is replaced. */
export class ProgressReducer {
  message: AssistantMessage | undefined;
  private blocks = new Map<number, { kind: string; ended: boolean; json: string }>();
  apply(frame: ProgressEvent): AssistantMessage {
    if (frame.type === 'start') {
      if (this.message || frame.message?.role !== 'assistant' || !Array.isArray(frame.message.content) || frame.message.content.length) throw new ProtocolError('Invalid progress start');
      this.message = structuredClone(frame.message);
      return this.message;
    }
    if (!this.message || !Number.isSafeInteger(frame.contentIndex) || frame.contentIndex < 0) throw new ProtocolError('Progress block has no message start');
    const index = frame.contentIndex, content = this.message.content.slice();
    const state = this.blocks.get(index);
    if (frame.type === 'text_start' || frame.type === 'thinking_start' || frame.type === 'toolcall_start') {
      const block = frame.type === 'toolcall_start' ? frame.toolCall : frame.content;
      const kind = frame.type === 'text_start' ? 'text' : frame.type === 'thinking_start' ? 'thinking' : 'toolCall';
      if (index !== content.length || state || block?.type !== kind) throw new ProtocolError('Invalid progress block start');
      content.push(structuredClone(block)); this.blocks.set(index, { kind, ended: false, json: '' });
    } else {
      const kind = frame.type.startsWith('text_') ? 'text' : frame.type.startsWith('thinking_') ? 'thinking' : 'toolCall';
      const existing = content[index];
      if (!state || state.ended || state.kind !== kind || existing?.type !== kind) throw new ProtocolError('Invalid progress block update');
      const block = { ...existing };
      switch (frame.type) {
        case 'text_delta': if (block.type === 'text') block.text += frame.delta; break;
        case 'text_end': if (block.type === 'text') { block.text = frame.content; delete block.textSignature; if (frame.textSignature !== undefined) block.textSignature = frame.textSignature; } break;
        case 'thinking_delta': if (block.type === 'thinking') block.thinking += frame.delta; break;
        case 'thinking_end': if (block.type === 'thinking') { block.thinking = frame.content; delete block.thinkingSignature; delete block.redacted; if (frame.thinkingSignature !== undefined) block.thinkingSignature = frame.thinkingSignature; if (frame.redacted !== undefined) block.redacted = frame.redacted; } break;
        case 'toolcall_checkpoint': state.json = frame.json; if (block.type === 'toolCall') block.arguments = parseStreamingJson(state.json); break;
        case 'toolcall_delta': state.json += frame.delta; if (block.type === 'toolCall') block.arguments = parseStreamingJson(state.json); break;
        case 'toolcall_end': if (block.type === 'toolCall') { block.id = frame.id; block.name = frame.name; block.arguments = structuredClone(frame.arguments); delete block.thoughtSignature; delete block.namespace; if (frame.thoughtSignature !== undefined) block.thoughtSignature = frame.thoughtSignature; if (frame.namespace !== undefined) block.namespace = frame.namespace; } break;
        default: throw new ProtocolError('Unknown progress event');
      }
      if (frame.type.endsWith('_end')) state.ended = true;
      content[index] = block;
    }
    this.message = { ...this.message, content };
    return this.message;
  }
}
