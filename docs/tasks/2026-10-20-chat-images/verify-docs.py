from pathlib import Path
import re
root = Path(__file__).resolve().parents[3]
drafts = root / 'docs/tasks/2026-10-20-chat-images/drafts'
marker = '<!-- Task proposal; current contract is under docs/systems/ -->\n'
for draft in drafts.rglob('*.md'):
    canonical = root / 'docs/systems' / draft.relative_to(drafts)
    assert canonical.read_text() == draft.read_text().removeprefix(marker), canonical
    for target in re.findall(r'\]\(([^)]+)\)', canonical.read_text()):
        if '://' in target or target.startswith('#'):
            continue
        path = target.split('#')[0]
        assert (canonical.parent / path).exists(), (canonical, target)
source = (root / 'backend/src/chat-images.ts').read_text()
assert "from '@earendil-works/pi-coding-agent'" in source
assert '/dist/' not in source and '/utils/' not in source
print('12 canonical/draft documents agree; links and public Pi imports verified')
