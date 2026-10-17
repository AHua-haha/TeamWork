from datetime import datetime, timezone
from pathlib import Path
import json
import os
import re
import subprocess

task = Path(__file__).resolve().parent
root = task.parents[2]
marker = '<!-- Task proposal; current contract is under docs/systems/ -->\n'
record = {
    'time': datetime.now(timezone.utc).isoformat(),
    'start_commit': 'fb2a0e8d35179e7cc033e65323ce6c116e20de5b',
    'command': 'python3 docs/tasks/2026-10-17-context-boundary-guidance/verify-docs.py',
    'scope': 'Promoted design/implementation agreement, document sections, links, rules/templates, unchanged protocol and whitespace',
    'result': 'fail',
}
try:
    drafts_root = task / 'drafts'
    drafts = sorted(drafts_root.rglob('*.md'))
    assert len(drafts) == 3
    checked = [task / 'task.md', root / 'backend/README.md', root / 'backend/prompts/README.md']
    for path in drafts:
        canonical = root / 'docs/systems' / path.relative_to(drafts_root)
        text = path.read_text()
        assert text.startswith(marker), path
        def rebase(m):
            target = m[1]
            if '://' in target or target.startswith('#'):
                return m[0]
            location, sep, anchor = target.partition('#')
            dest = (path.parent / location).resolve()
            if dest.is_relative_to(drafts_root):
                dest = root / 'docs/systems' / dest.relative_to(drafts_root)
            return '](' + os.path.relpath(dest, canonical.parent) + ('#' + anchor if sep else '') + ')'
        promoted = re.sub(r'\]\(([^)]+)\)', rebase, text[len(marker):])
        assert canonical.read_text() == promoted, path
        headings = ['Purpose and boundary', 'Inputs and preconditions', 'Outputs and observable effects', 'Failure behavior', 'Guarantees and limits', 'Acceptance examples'] if path.name == 'design.md' else ['Contract', 'Responsibilities and decomposition', 'Coordination and data flow', 'Decisions and constraints', 'Code map', 'Verification']
        for heading in headings:
            assert f'## {heading}\n' in promoted, (canonical, heading)
        checked += [path, canonical]
    for path in checked:
        text = path.read_text()
        assert text.endswith('\n') and all(line == line.rstrip() for line in text.splitlines()), path
        for target in re.findall(r'\[[^\]]+\]\(([^)]+)\)', text):
            if '://' not in target and not target.startswith('#'):
                assert (path.parent / target.split('#')[0]).exists(), (path, target)
    prompts = root / 'backend/prompts/harness'
    assert all((prompts / name).read_text().strip() for name in ['management-design.md','implementation.md','implementation-context.md','design-template.md','implementation-context-template.md'])
    subprocess.run(['git', 'diff', '--exit-code', record['start_commit'], '--', 'DEVELOPMENT_PROTOCOL.md', 'AGENT_TASK_PROMPT.md'], cwd=root, check=True)
    subprocess.run(['git', 'diff', '--check'], cwd=root, check=True)
    record['result'] = 'pass'
    print('Passed: 3 promoted draft/canonical documents agree; sections, links, prompt assets, protocol and whitespace checked.')
finally:
    with (task / 'tests.jsonl').open('a') as log:
        log.write(json.dumps(record) + '\n')
