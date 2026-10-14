import re,subprocess
from pathlib import Path
root=Path('docs/tasks/2026-10-14-group-chat-run-headers/drafts')
marker='<!-- Task proposal; current contract is under docs/systems/ -->\n'
for draft in root.rglob('*.md'):
 canonical=Path('docs/systems')/draft.relative_to(root)
 assert canonical.read_text()==draft.read_text().removeprefix(marker),str(canonical)
 for target in re.findall(r'\]\(([^\s)]+)\)',canonical.read_text()):
  if '://' in target or target.startswith('#'):continue
  assert (canonical.parent/target.split('#')[0]).exists(),f'{canonical}: {target}'
subprocess.run(['git','diff','--check'],check=True)
print('Draft/canonical parity, links and whitespace passed.')
