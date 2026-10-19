// Live network/toolchain verification on macOS; uses and removes a disposable project.
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeBash, closeBashRuntime } from '../../../backend/src/harness-command.js';
const root=await realpath(await mkdtemp(join(tmpdir(),'rsi-broad-smoke-')));
try {
 await mkdir(join(root,'src/py'),{recursive:true});
 await writeFile(join(root,'src/package.json'),JSON.stringify({name:'sandbox-smoke',version:'1.0.0',private:true}));
 await writeFile(join(root,'src/py/pyproject.toml'),'[project]\nname = "sandbox-smoke"\nversion = "0.1.0"\nrequires-python = ">=3.9"\ndependencies = []\n');
 const result=await executeBash({root,command:'command -v node npm uv docker && node --version && npm --version && uv --version && cd src && npm install --fetch-retries=0 --fetch-timeout=10000 --loglevel=verbose --ignore-scripts --no-audit --no-fund --package-lock=false is-number@7.0.0 && node -e \'console.log(require("is-number")(42))\' && cd py && uv sync --offline --python /Library/Developer/CommandLineTools/usr/bin/python3 && .venv/bin/python -c \'print("uv-sync-ok")\'',readable:[],writable:['src'],readonly:[],signal:new AbortController().signal});
 console.log(JSON.stringify(result,null,2));
 if(result.exitCode!==0||!result.stdout.includes('uv-sync-ok'))process.exitCode=1;
}finally{await closeBashRuntime();await rm(root,{recursive:true,force:true});}
