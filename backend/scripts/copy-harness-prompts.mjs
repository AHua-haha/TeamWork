import { cp, rm } from 'node:fs/promises';

for (const name of ['harness', 'team', 'agent']) {
  const source = new URL(`../prompts/${name}/`, import.meta.url);
  const target = new URL(`../dist/prompts/${name}/`, import.meta.url);
  await rm(target, { recursive: true, force: true });
  await cp(source, target, { recursive: true });
}
