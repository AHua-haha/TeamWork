from datetime import datetime, timezone
from pathlib import Path
import argparse
import json
import os
import re
import shlex
import subprocess
import sys

task = Path(__file__).resolve().parent
root = task.parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--start-commit', default='d08936cc05b08382b90069887f02937d801b1899')
start = parser.parse_args().start_commit
record = {'time': datetime.now(timezone.utc).isoformat(), 'start_commit': start,
          'command': shlex.join(['python3', str(Path(__file__).resolve().relative_to(root)), *sys.argv[1:]]),
          'scope': 'Implemented candidate: canonical/draft parity, sections, links, JSON examples, stale tool removal and whitespace', 'result': 'fail'}
headings = {
 'design.md': ['Purpose and boundary', 'Inputs and preconditions', 'Outputs and observable effects', 'Failure behavior', 'Guarantees and limits', 'Acceptance examples'],
 'impl.md': ['Contract', 'Responsibilities and decomposition', 'Coordination and data flow', 'Decisions and constraints', 'Code map', 'Verification'],
}
def normalized(path):
 text=path.read_text().removeprefix('<!-- Task proposal; current contract is under docs/systems/ -->\n')
 def link(m):
  url=m.group(2)
  if '://' in url or url.startswith('#'):return m.group(0)
  resolved=(path.parent/url).resolve()
  try: resolved=root/'docs/systems'/resolved.relative_to(task/'drafts')
  except ValueError:pass
  return f'[{m.group(1)}]({resolved})'
 return re.sub(r'\[([^\]]+)\]\(([^)]+)\)', link, text)
try:
 drafts=sorted((task/'drafts').rglob('*.md'))
 for draft in drafts:
  assert draft.read_text().startswith('<!-- Task proposal; current contract is under docs/systems/ -->\n')
  canonical=root/'docs/systems'/draft.relative_to(task/'drafts')
  assert normalized(draft)==normalized(canonical), f'{draft}: canonical/draft mismatch'
 files=[task/'task.md', *drafts, *sorted((root/'docs/systems').rglob('*.md')), root/'README.md', root/'backend/README.md', root/'frontend/README.md']
 for path in files:
  text=path.read_text(); assert text.endswith('\n'), f'{path}: newline'
  assert all(line==line.rstrip() for line in text.splitlines()), f'{path}: whitespace'
  if path.name in headings:
   for heading in headings[path.name]: assert f'## {heading}\n' in text, f'{path}: missing {heading}'
  for url in re.findall(r'\[[^\]]+\]\(([^)]+)\)',text):
   if '://' not in url and not url.startswith('#'):
    assert (path.parent/url.split('#')[0]).exists(), f'{path}: missing {url}'
  for code in re.findall(r'```json\n(.*?)\n```', text, re.S): json.loads(code)
 source='\n'.join(path.read_text() for path in (root/'backend/src').glob('*.ts'))
 for obsolete in ["name: 'run_command'", "name: 'submit_member_config'", "name: 'retire_member'", "name: 'commit_scope'", "name: 'scope_history'", "name: 'restore_scope'"]:
  assert obsolete not in source, f'Obsolete tool still registered: {obsolete}'
 assert not (root/'backend/src/lead-tools.ts').exists()
 check=subprocess.run(['git','diff','--check'],cwd=root,capture_output=True,text=True)
 assert check.returncode==0, check.stdout+check.stderr
 record['result']='pass'
 print(f'Passed: {len(files)} Markdown files; {len(drafts)} promoted documents; parity, sections, links, JSON examples, tool removal, whitespace.')
finally:
 with (task/'tests.jsonl').open('a') as log: log.write(json.dumps(record)+'\n')
