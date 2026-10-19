"""Apply the inspected personal-todo plan; refuses changed targets and any link traversal."""
import hashlib
import json
import os
from pathlib import Path
import sys

plan = json.loads(Path(sys.argv[1]).read_text())
assert sys.argv[2] in ['--dry-run', '--apply']
assert not plan['conflicts']
root = Path(plan['workspace']).resolve()
assert root == Path('/Users/ahua/workspace/personal-todo')

def digest(path):
    if not path.exists():
        return None
    assert path.is_file(), f'Expected a regular file: {path}'
    return hashlib.sha256(path.read_bytes()).hexdigest()

def safe(path):
    assert path.is_relative_to(root)
    for parent in [path, *path.parents]:
        if parent == root:
            break
        assert not parent.is_symlink(), f'Link requires manual review: {parent}'

prepared = []
for change in plan['changes']:
    relative = Path(change['path'])
    assert not relative.is_absolute() and '..' not in relative.parts
    assert '.git' not in relative.parts and not change['path'].startswith('.rsi/harness/')
    source = root / '.rsi/harness/worktrees' / change['memberId'] / relative
    target = root / relative
    safe(source)
    safe(target)
    assert digest(source) == change['sourceSha256'], f'Source changed: {relative}'
    assert digest(target) == change['targetSha256'], f'Target changed: {relative}'
    prepared.append((change, source, target))

if sys.argv[2] == '--apply':
    for change, source, target in prepared:
        if change['action'] == 'delete':
            target.unlink(missing_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            temporary = target.with_name(target.name + '.migration-tmp')
            with temporary.open('xb') as file:
                file.write(source.read_bytes())
            os.chmod(temporary, source.stat().st_mode & 0o777)
            os.replace(temporary, target)
    for change, _, target in prepared:
        assert digest(target) == change['sourceSha256'], f'Imported bytes mismatch: {target}'
print(json.dumps({'mode': sys.argv[2], 'files': len(prepared), 'conflicts': 0}))
