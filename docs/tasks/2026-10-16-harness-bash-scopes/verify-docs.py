from datetime import datetime, timezone
from pathlib import Path
import json
import re
import subprocess

task = Path(__file__).resolve().parent
root = task.parents[2]
start = 'b489d67e6b8296f41c9654ff29bcbcab8489e2d6'
record = {
    'time': datetime.now(timezone.utc).isoformat(),
    'start_commit': start,
    'command': f'python3 {Path(__file__).resolve().relative_to(root)}',
    'scope': 'Documentation-only proposal: sections, proposal markers, relative links, whitespace, and unchanged canonical/application files',
    'result': 'fail',
}
try:
    headings = {
        'design.md': ['Purpose and boundary', 'Inputs and preconditions', 'Outputs and observable effects', 'Failure behavior', 'Guarantees and limits', 'Acceptance examples'],
        'impl.md': ['Contract', 'Responsibilities and decomposition', 'Coordination and data flow', 'Decisions and constraints', 'Code map', 'Verification'],
    }
    files = [task / 'task.md', *sorted((task / 'drafts').rglob('*.md'))]
    assert len(files) == 7
    for path in files:
        text = path.read_text()
        assert text.endswith('\n'), f'{path}: missing newline'
        assert all(line == line.rstrip() for line in text.splitlines()), f'{path}: trailing whitespace'
        if path.name in headings:
            assert text.startswith('<!-- Task proposal; current contract is under docs/systems/ -->\n'), path
            for heading in headings[path.name]:
                assert f'## {heading}\n' in text, f'{path}: missing {heading}'
        for target in re.findall(r'\[[^\]]+\]\(([^)]+)\)', text):
            if '://' not in target and not target.startswith('#'):
                assert (path.parent / target.split('#')[0]).exists(), f'{path}: missing {target}'
    unchanged = subprocess.run(['git', 'diff', '--exit-code', start, '--', 'docs/systems', 'backend', 'frontend'], cwd=root, capture_output=True, text=True)
    assert unchanged.returncode == 0, 'Canonical/application files changed in a proposal-only checkpoint'
    record['result'] = 'pass'
    print(f'Passed: {len(files)} documents; required sections, markers, local links, whitespace and unchanged canonical/application files.')
finally:
    with (task / 'tests.jsonl').open('a') as log:
        log.write(json.dumps(record) + '\n')
