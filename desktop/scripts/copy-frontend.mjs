import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = path.resolve(root, '../frontend/dist');
const target = path.join(root, '.build', 'frontend-dist');
await rm(target, { recursive: true, force: true });
await mkdir(path.dirname(target), { recursive: true });
await cp(source, target, { recursive: true });
console.log(`Bundled shared frontend build output: ${path.relative(root, target)}`);
