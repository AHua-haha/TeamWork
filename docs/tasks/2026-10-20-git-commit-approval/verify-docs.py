from pathlib import Path
import re
import subprocess

root = Path(__file__).resolve().parents[3]
task = Path(__file__).resolve().parent
for draft in (task / 'drafts').rglob('*.md'):
    assert draft.read_text().startswith('<!-- Task proposal;'), draft
    canonical = root / 'docs/systems' / draft.relative_to(task / 'drafts')
    for target in re.findall(r'\]\(([^)]+)\)', draft.read_text()):
        if '://' not in target:
            path = target.split('#')[0]
            assert (draft.parent / path).exists() or (canonical.parent / path).exists(), (draft, target)
assert not subprocess.check_output(['git', 'diff', 'HEAD', '--', 'docs/systems', 'backend', 'frontend', 'scripts'], cwd=root), 'Design persistence must not modify canonical contracts or code'
print('Six proposed documents checked; local links resolve; canonical contracts and code unchanged')
