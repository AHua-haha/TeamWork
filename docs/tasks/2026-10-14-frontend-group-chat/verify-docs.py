import re,subprocess
from pathlib import Path
root=Path('docs/tasks/2026-10-14-frontend-group-chat/drafts')
marker='<!-- Task proposal; current contract is under docs/systems/ -->\n'
for draft in root.rglob('*.md'):
 canonical=Path('docs/systems')/draft.relative_to(root)
 assert canonical.read_text()==draft.read_text().removeprefix(marker),str(canonical)
 for target in re.findall(r'\]\(([^\s)]+)\)',canonical.read_text()):
  if '://' in target or target.startswith('#'):continue
  path=target.split('#')[0]
  assert (canonical.parent/path).exists(),f'{canonical}: {target}'
source='\n'.join(p.read_text() for p in Path('backend/src').glob('*.ts'))
assert "name: 'send_message'" not in source
assert "name: 'assign_member'" not in source
assert 'maxChainMembers' not in source
frontend=Path('frontend/src/ui/WorkspacePage.tsx').read_text()
assert 'GroupChat' in frontend and 'ChatPage' not in frontend
assert 'publishFinal(scope.agentId, scope.runId, text, record.messageId)' in Path('backend/src/team-system.ts').read_text()
assert 'chat_changes' in Path('backend/src/database.ts').read_text()
subprocess.run(['git','diff','--check'],check=True)
print('Draft/canonical parity, canonical links, obsolete call-path removal and whitespace passed.')
