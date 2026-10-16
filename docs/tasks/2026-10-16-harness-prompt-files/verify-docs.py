from pathlib import Path
import re
import subprocess

task=Path(__file__).resolve().parent
root=task.parents[2]
marker='<!-- Task proposal; current contract is under docs/systems/ -->\n'
def normalize(path):
 def link(m):
  url=m.group(2)
  if '://' in url or url.startswith('#'):return m.group(0)
  resolved=(path.parent/url).resolve()
  try:resolved=root/'docs/systems'/resolved.relative_to(task/'drafts')
  except ValueError:pass
  return f'[{m.group(1)}]({resolved})'
 return re.sub(r'\[([^\]]+)\]\(([^)]+)\)',link,path.read_text().removeprefix(marker))
files=[task/'task.md',root/'backend/README.md',root/'backend/prompts/README.md']
for draft in (task/'drafts').rglob('*.md'):
 canonical=root/'docs/systems'/draft.relative_to(task/'drafts')
 assert draft.read_text().startswith(marker)
 assert normalize(draft)==normalize(canonical),draft
 files.extend([draft,canonical])
for path in files:
 text=path.read_text();assert text.endswith('\n'),path
 assert all(line==line.rstrip() for line in text.splitlines()),path
 for url in re.findall(r'\[[^\]]+\]\(([^)]+)\)',text):
  if '://' not in url and not url.startswith('#'):assert (path.parent/url.split('#')[0]).exists(),(path,url)
subprocess.run(['git','diff','--check'],cwd=root,check=True)
print(f'Passed: {len(files)} documentation files, canonical/draft parity, links and whitespace.')
