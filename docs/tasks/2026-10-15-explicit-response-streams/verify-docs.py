from pathlib import Path
import re
import subprocess

root = Path(__file__).resolve().parents[3]
task = Path(__file__).resolve().parent
marker = '<!-- Task proposal; current contract is under docs/systems/ -->\n\n'
checked = []
for draft in sorted((task / 'drafts').rglob('*.md')):
    canonical = root / 'docs/systems' / draft.relative_to(task / 'drafts')
    body = draft.read_text()
    assert body.startswith(marker), draft
    assert canonical.read_text() == body[len(marker):], (draft, canonical)
    checked.append(canonical)
checked += [task / 'task.md', root / 'backend/README.md', root / 'frontend/README.md', root / 'README.md']
for file in checked:
    body = file.read_text()
    assert body.endswith('\n') and all(line == line.rstrip() for line in body.splitlines()), file
    for target in re.findall(r'\]\(([^)]+)\)', body):
        target = target.split('#', 1)[0]
        if not target or '://' in target:
            continue
        assert (file.parent / target).resolve().exists(), (file, target)
subprocess.run(['git', 'diff', '--check'], cwd=root, check=True)
subprocess.run(['git', 'diff', '--cached', '--check'], cwd=root, check=True)
print(f'PASS: {len(checked)} documentation files; draft/canonical parity, local links and whitespace.')
