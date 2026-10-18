import json,os,subprocess,time
from pathlib import Path
root=Path(__file__).resolve().parents[3]
variant=os.environ.get('LOAD_VARIANT','development')
suffix='-production' if variant=='production' else ''
profile=os.environ.get('LOAD_BROWSER_PROFILE','playwright_chromiumdev_profile-dEDTVz')
rows=[]
def sample():
 data=[]
 raw=subprocess.check_output(['ps','-axo','pid=,ppid=,time=,rss=,command='],text=True)
 for line in raw.splitlines():
  parts=line.strip().split(None,4)
  if len(parts)!=5:continue
  pid,parent,cpu,rss,command=parts
  if profile in command and '/Google Chrome' in command:
   kind='renderer' if '--type=renderer' in command else 'browser-other'
  elif int(pid)==74245:kind='docker-host'
  elif int(pid)==74305:kind='docker-vm'
  else:continue
  seconds=sum(float(n)*60**i for i,n in enumerate(reversed(cpu.split(':'))))
  data.append([int(pid),kind,seconds,int(rss)])
 return [time.time()*1000,data]
cmd=['node','backend/scripts/verify.mjs','/Users/ahua/.codex/skills/playwright/scripts/playwright_cli.sh','--session=stream-load','run-code','--filename='+str(root/'docs/tasks/2026-10-18-stream-load-test/browser-load.js')]
env={**os.environ,'VERIFY_TASK_ID':'2026-10-18-stream-load-test','VERIFY_SCOPE':'Real browser UI load: normal visible/folded, large fast output and four parallel members; process CPU/RSS, animation gaps and long tasks'}
with (root/('.run/stream-load-browser'+suffix+'.log')).open('w') as log:
 process=subprocess.Popen(cmd,cwd=root,env=env,stdout=log,stderr=log)
 while process.poll() is None:
  rows.append(sample());time.sleep(.5)
rows.append(sample())
(root/('docs/tasks/2026-10-18-stream-load-test/browser-host'+suffix+'-samples.jsonl')).write_text(''.join(json.dumps(row,separators=(',',':'))+'\n' for row in rows))
raise SystemExit(process.returncode)
