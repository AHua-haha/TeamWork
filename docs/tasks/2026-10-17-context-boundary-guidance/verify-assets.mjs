import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { harnessPrompt } from '../../../backend/dist/src/harness-prompts.js';
for (const name of ['management-design','implementation','design-template','implementation-context-template']) {
 const source=await readFile(new URL(`../../../backend/prompts/harness/${name}.md`,import.meta.url),'utf8');
 const built=await readFile(new URL(`../../../backend/dist/prompts/harness/${name}.md`,import.meta.url),'utf8');
 assert.equal(built,source,`${name}: packaged instructions must match source`);
}
process.chdir('/tmp');
assert.match(harnessPrompt('design-template',{project:'Example'}),/caller's perspective/);
assert.match(harnessPrompt('implementation-context-template',{design:'metadata.json'}),/caller's perspective/);
assert.match(harnessPrompt('management-design'),/distinct subsystem/);
assert.match(harnessPrompt('implementation'),/same system from its caller's perspective/);
console.log('Rule/template packaging matches source; rendered instructions preserve caller perspective and subsystem boundaries.');
