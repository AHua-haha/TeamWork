from pathlib import Path
import re

task = Path(__file__).resolve().parent
drafts = task / 'drafts'
required = {
    'design.md': ['Purpose and boundary', 'Inputs and preconditions', 'Outputs and observable effects', 'Failure behavior', 'Guarantees and limits', 'Acceptance examples'],
    'impl.md': ['Contract', 'Responsibilities and decomposition', 'Coordination and data flow', 'Decisions and constraints', 'Code map', 'Verification'],
}
files = [task / 'task.md', *sorted(drafts.rglob('*.md'))]
for path in files:
    text = path.read_text()
    assert text.endswith('\n'), f'{path}: missing final newline'
    assert all(line == line.rstrip() for line in text.splitlines()), f'{path}: trailing whitespace'
    if path.is_relative_to(drafts):
        assert text.startswith('<!-- Task proposal; current contract is under docs/systems/ -->\n'), path
        for heading in required[path.name]:
            assert f'## {heading}\n' in text, f'{path}: missing {heading}'
    for target in re.findall(r'\[[^\]]+\]\(([^)]+)\)', text):
        if '://' not in target and not target.startswith('#'):
            assert (path.parent / target.split('#')[0]).exists(), f'{path}: missing {target}'

design = (drafts / 'frontend/group-chat/design.md').read_text()
assert '## Explicit output channels' not in design
assert 'Reasoning is a compact disclosure' not in design
assert 'final_response({text})' not in design
print(f'Passed: {len(files)} documents; proposal markers, required sections, local links, whitespace and obsolete rules.')
