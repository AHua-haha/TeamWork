from pathlib import Path
import re
root=Path(__file__).resolve().parents[3]
task=Path(__file__).resolve().parent
marker='<!-- Task proposal; current contract is under docs/systems/ -->\n'
count=0
for draft in (task/'drafts').rglob('*.md'):
 canonical=root/'docs/systems'/draft.relative_to(task/'drafts')
 assert draft.read_text().removeprefix(marker)==canonical.read_text(), canonical
 for match in re.finditer(r'\[[^\]]*\]\(([^)]+)\)',canonical.read_text()):
  link=match.group(1).split('#')[0]
  if not link or '://' in link: continue
  assert (canonical.parent/link).exists(), (canonical,link)
 count+=1
print(f'{count} canonical documents match task drafts; local links resolve.')
