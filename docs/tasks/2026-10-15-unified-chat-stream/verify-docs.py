from pathlib import Path
import re

task = Path(__file__).resolve().parent
drafts = task / 'drafts'
root = task.parents[2]
systems = root / 'docs/systems'
required = {
    'design.md': ['Purpose and boundary', 'Inputs and preconditions', 'Outputs and observable effects', 'Failure behavior', 'Guarantees and limits', 'Acceptance examples'],
    'impl.md': ['Contract', 'Responsibilities and decomposition', 'Coordination and data flow', 'Decisions and constraints', 'Code map', 'Verification'],
}
proposals = sorted(drafts.rglob('*.md'))
canonicals = [systems / path.relative_to(drafts) for path in proposals]
files = [task / 'task.md', *proposals, *canonicals]
marker = '<!-- Task proposal; current contract is under docs/systems/ -->\n'
def normalized(path):
    text = path.read_text().removeprefix(marker)
    return re.sub(r'(\[[^\]]+\]\()([^)]+)(\))', lambda match: match[1] + str((path.parent / match[2]).resolve()) + match[3] if '://' not in match[2] and not match[2].startswith('#') else match[0], text)

for draft, canonical in zip(proposals, canonicals):
    assert normalized(draft) == normalized(canonical), f'Draft/canonical mismatch: {draft}'
for path in files:
    text = path.read_text()
    assert text.endswith('\n'), f'{path}: missing final newline'
    assert all(line == line.rstrip() for line in text.splitlines()), f'{path}: trailing whitespace'
    if path.name in required:
        if path.is_relative_to(drafts):
            assert text.startswith(marker), path
        else:
            assert not text.startswith(marker), path
        for heading in required[path.name]:
            assert f'## {heading}\n' in text, f'{path}: missing {heading}'
    for target in re.findall(r'\[[^\]]+\]\(([^)]+)\)', text):
        if '://' not in target and not target.startswith('#'):
            assert (path.parent / target.split('#')[0]).exists(), f'{path}: missing {target}'

design = (drafts / 'frontend/group-chat/design.md').read_text()
assert '## Explicit output channels' not in design
assert 'Reasoning is a compact disclosure' not in design
assert 'final_response({text})' not in design
for path in canonicals:
    text = path.read_text()
    for obsolete in ['output.response', 'response-output.ts', 'responsePreview', 'final_response({text})', 'explicit response tool']:
        assert obsolete not in text, f'{path}: obsolete {obsolete}'
print(f'Passed: {len(files)} documents; draft/canonical parity, proposal markers, required sections, local links, whitespace and obsolete rules.')
