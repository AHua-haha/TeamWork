import {readFileSync} from 'node:fs';
import {AppError} from '../errors.js';

const required = (name:string) => {
  const text=readFileSync(new URL(`../../../prompts/team/${name}.md`,import.meta.url),'utf8').trim();
  if(!text)throw new AppError('invalid_config',`Required Team prompt is empty: ${name}`,500);
  return text;
};
const rules=[required('instructions'),required('group-chat')].join('\n\n');

/** Fixed Team rules and activated agent.md. Dynamic member information is separate and deferred. */
export class MemberInstructions {
  build(own:string|undefined):string {
    return [rules,...(own ? [`## Member instructions\n${own}`] : [])].join('\n\n');
  }
}
