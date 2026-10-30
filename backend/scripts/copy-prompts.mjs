import { cp, rm } from 'node:fs/promises';

for (const name of ['workspace', 'team', 'agent']) {
  const source = new URL(`../prompts/${name}/`, import.meta.url);
  const target = new URL(`../dist/prompts/${name}/`, import.meta.url);
  await rm(target, { recursive: true, force: true });
  await cp(source, target, { recursive: true });
}

for (const path of ['src/core/react-harness/file/context-maintenance.md','src/core/react-harness/file/instructions.md','src/core/react-harness/default/prompts']) {
  await cp(new URL(`../${path}`,import.meta.url),new URL(`../dist/${path}`,import.meta.url),{recursive:true});
}
