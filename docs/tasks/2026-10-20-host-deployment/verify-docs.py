from pathlib import Path
import re
root = Path(__file__).resolve().parents[3]
drafts = root / 'docs/tasks/2026-10-20-host-deployment/drafts'
for proposal in drafts.rglob('*.md'):
    canonical = root / 'docs/systems' / proposal.relative_to(drafts)
    assert canonical.read_text() == proposal.read_text().removeprefix('<!-- Task proposal; current contract is under docs/systems/ -->\n'), canonical
    for target in re.findall(r'\]\(([^)]+)\)', canonical.read_text()):
        if '://' not in target and not target.startswith('#'):
            assert (canonical.parent / target.split('#')[0]).exists(), (canonical, target)
print('Six lifecycle documents agree with drafts; links resolve')
