from datetime import datetime, timezone
from pathlib import Path
import json
import re
import subprocess

task = Path(__file__).resolve().parent
root = task.parents[2]
systems = root / 'docs/systems'
drafts = task / 'drafts'
record = {
    'time': datetime.now(timezone.utc).isoformat(),
    'start_commit': '53f8ac3aea0bca063f453718582bc0ea46174cec',
    'command': 'python3 docs/tasks/2026-10-16-member-inspection-api/verify-docs.py',
    'scope': 'Final canonical/draft parity, design/implementation sections, local links, JSON examples and whitespace',
    'result': 'fail',
}
marker = '<!-- Task proposal; current contract is under docs/systems/ -->\n'

def normalized(path):
    def link(match):
        value = match[1]
        if '://' in value or value.startswith('#'):
            return match[0]
        target, separator, anchor = value.partition('#')
        absolute = (path.parent / target).resolve()
        if absolute.is_relative_to(drafts):
            absolute = systems / absolute.relative_to(drafts)
        return '](' + str(absolute) + (separator + anchor if separator else '') + ')'
    return re.sub(r'\]\(([^)]+)\)', link, path.read_text().removeprefix(marker))

try:
    proposed = sorted(drafts.rglob('*.md'))
    assert len(proposed) == 7
    paths = [task / 'task.md', root / 'backend/README.md', root / 'frontend/README.md']
    for draft in proposed:
        assert draft.read_text().startswith(marker), draft
        canonical = systems / draft.relative_to(drafts)
        assert normalized(draft) == normalized(canonical), (draft, canonical)
        headings = ['Purpose and boundary', 'Inputs and preconditions', 'Outputs and observable effects', 'Failure behavior', 'Guarantees and limits', 'Acceptance examples'] if draft.name == 'design.md' else ['Contract', 'Responsibilities and decomposition', 'Coordination and data flow', 'Decisions and constraints', 'Code map', 'Verification']
        for heading in headings:
            assert f'## {heading}\n' in draft.read_text(), (draft, heading)
        paths.extend([draft, canonical])
    for path in paths:
        text = path.read_text()
        assert text.endswith('\n') and all(line == line.rstrip() for line in text.splitlines()), path
        for target in re.findall(r'\[[^\]]+\]\(([^)]+)\)', text):
            if '://' not in target and not target.startswith('#'):
                assert (path.parent / target.split('#')[0]).exists(), (path, target)
        for example in re.findall(r'```json\n(.*?)\n```', text, re.S):
            json.loads(example)
    for line in (task / 'tests.jsonl').read_text().splitlines():
        item = json.loads(line)
        assert item['start_commit'] == record['start_commit']
        assert item['result'] in ['pass', 'fail', 'blocked']
    subprocess.run(['git', 'diff', '--check'], cwd=root, check=True)
    record['result'] = 'pass'
    print('Passed: seven canonical/draft pairs, required sections, local links, JSON examples, test records and whitespace.')
finally:
    with (task / 'tests.jsonl').open('a') as log:
        log.write(json.dumps(record) + '\n')
