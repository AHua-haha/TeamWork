import { cp, rm } from 'node:fs/promises';

const source = new URL('../prompts/harness/', import.meta.url);
const target = new URL('../dist/prompts/harness/', import.meta.url);
await rm(target, { recursive: true, force: true });
await cp(source, target, { recursive: true });
