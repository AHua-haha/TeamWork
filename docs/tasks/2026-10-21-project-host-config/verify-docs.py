from pathlib import Path
import re
root=Path(__file__).resolve().parents[3]
task=Path(__file__).resolve().parent
count=0
for draft in (task/'drafts').rglob('*.md'):
    assert draft.read_text().startswith('<!-- Task proposal;'),draft
    canonical=root/'docs/systems'/draft.relative_to(task/'drafts')
    assert canonical.read_text()==draft.read_text().split('\n',1)[1],draft
    for target in re.findall(r'\]\(([^)]+)\)',canonical.read_text()):
        if '://' not in target:
            assert (canonical.parent/target.split('#')[0]).exists(),(canonical,target)
    count+=1
assert not (root/'backend/.env.example').exists()
print(f'{count} canonical documents match task drafts; links resolve; old env example retired')
