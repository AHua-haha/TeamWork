import json
import urllib.request
from datetime import datetime,timezone
from pathlib import Path

task=Path(__file__).resolve().parent
record={'time':datetime.now(timezone.utc).isoformat(),'start_commit':'b3eb5a80fbb36b1d8acad392c5bbbbca0798c0cf','command':'python3 docs/tasks/2026-10-18-split-context-roots/verify-http.py','scope':'Disposable in-memory backend at 31478 and Vite frontend proxy at 5274, actual design/tree/document reads and raw implementation mutation refusal','result':'fail'}
try:
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
 root='http://127.0.0.1:5274/workspaces/w1'
 def get(path):
  with opener.open(root+path) as response:return json.load(response)
 catalog=get('/designs')
 assert [d['path'] for d in catalog['designs']]==['backend/metadata.json','metadata.json']
 design=get('/designs/file?path=backend/metadata.json')
 assert design['path']=='design/backend/metadata.json'
 assert [d['path'] for d in design['design']['documents']]==['design/backend/design/README.md','design/backend/design/request-flow.md']
 assert get('/context/file?path=design/backend/design/request-flow.md')['content']==design['design']['documents'][1]['content']
 assert [d['path'] for d in get('/context/tree?path=&depth=1')['entries']]==['design','implement']
 assert 'Implemented contract' in get('/context/file?path=implement/impl.md')['content']
 request=urllib.request.Request(root+'/context/file?path=implement/temporary.txt',data=json.dumps({'content':'no','baseRevision':None}).encode(),method='PUT',headers={'Content-Type':'application/json'})
 try:opener.open(request);raise AssertionError('Implementation mutation must refuse')
 except urllib.error.HTTPError as error:assert error.code==403
 print('Passed: actual frontend proxy, split root listing, semantic/raw document paths and read-only implementation API.')
 record['result']='pass'
finally:
 with (task/'tests.jsonl').open('a') as out:out.write(json.dumps(record)+'\n')
