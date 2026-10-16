from pathlib import Path
import json
import re
import subprocess

task = Path(__file__).resolve().parent
root = task.parents[2]
marker = '<!-- Task proposal; current contract is under docs/systems/ -->\n'
headings = {
    'design.md': ['Purpose and boundary', 'Inputs and preconditions', 'Outputs and observable effects', 'Failure behavior', 'Guarantees and limits', 'Acceptance examples'],
    'impl.md': ['Contract', 'Responsibilities and decomposition', 'Coordination and data flow', 'Decisions and constraints', 'Code map', 'Verification'],
}

def normalize(path):
    def link(match):
        target = match.group(2)
        if '://' in target or target.startswith('#'):
            return match.group(0)
        url, separator, anchor = target.partition('#')
        resolved = (path.parent / url).resolve()
        try:
            resolved = root / 'docs/systems' / resolved.relative_to(task / 'drafts')
        except ValueError:
            pass
        return f'[{match.group(1)}]({resolved}' + (f'#{anchor}' if separator else '') + ')'
    return re.sub(r'\[([^\]]+)\]\(([^)]+)\)', link, path.read_text().removeprefix(marker))

files = [task / 'task.md', root / 'backend/README.md', root / 'frontend/README.md']
for draft in sorted((task / 'drafts').rglob('*.md')):
    canonical = root / 'docs/systems' / draft.relative_to(task / 'drafts')
    assert draft.read_text().startswith(marker), draft
    assert normalize(draft) == normalize(canonical), draft
    for heading in headings[draft.name]:
        assert f'## {heading}\n' in canonical.read_text(), (canonical, heading)
    files.extend([draft, canonical])
for path in files:
    text = path.read_text()
    assert text.endswith('\n'), path
    assert all(line == line.rstrip() for line in text.splitlines()), path
    for target in re.findall(r'\[[^\]]+\]\(([^)]+)\)', text):
        if '://' not in target and not target.startswith('#'):
            assert (path.parent / target.split('#')[0]).exists(), (path, target)
    for example in re.findall(r'```json\s*\n(.*?)\n```', text, re.S):
        json.loads(example)
for path in (root / 'backend/prompts/harness').glob('*.md'):
    for example in re.findall(r'```json\s*\n(.*?)\n```', path.read_text(), re.S):
        json.loads(example)
for line in (task / 'tests.jsonl').read_text().splitlines():
    record = json.loads(line)
    assert record['start_commit'] == 'e87fa3db5349378c9f5bf694f64a4202844ea363'
subprocess.run(['git', 'diff', '--check'], cwd=root, check=True)
print(f'Passed: {len(files)} documentation files; canonical/draft parity, required sections, links, JSON examples, evidence and whitespace.')
