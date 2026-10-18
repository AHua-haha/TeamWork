import json,subprocess,time
from pathlib import Path
root=Path(__file__).resolve().parents[3]
pids=[51564,56814,74245,74305,6168]
def read():
 out=subprocess.check_output(['ps','-p',','.join(map(str,pids)),'-o','pid=,time=,rss='],text=True)
 return {int(pid):{'cpuSeconds':sum(float(n)*60**i for i,n in enumerate(reversed(cpu.split(':')))),'rssMiB':int(rss)/1024} for pid,cpu,rss in (line.split() for line in out.splitlines())}
a=read();start=time.monotonic();time.sleep(10);b=read();elapsed=time.monotonic()-start
result={'seconds':elapsed,'phase':'idle after production streaming with completed transcript retained','processes':{pid:{'cpuPercent':100*(b[pid]['cpuSeconds']-a[pid]['cpuSeconds'])/elapsed,'rssStartMiB':a[pid]['rssMiB'],'rssEndMiB':b[pid]['rssMiB']} for pid in pids}}
(root/'docs/tasks/2026-10-18-stream-load-test/post-idle.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
