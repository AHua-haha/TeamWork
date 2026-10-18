import json,sys
from pathlib import Path
folder=Path(__file__).resolve().parent;root=folder.parents[2]
variant=sys.argv[1] if len(sys.argv)>1 else 'development'
suffix='-production' if variant=='production' else ''
text=(root/('.run/stream-load-browser'+suffix+'.log')).read_text()
data=json.loads(text.split('### Result\n',1)[1].split('\n### ',1)[0])
samples=[json.loads(line) for line in (folder/('browser-host'+suffix+'-samples.jsonl')).read_text().splitlines()]
for case in data:
 begin,end=case['browser']['beganAt'],case['browser']['endedAt']
 start=min(samples,key=lambda s:abs(s[0]-begin));stop=min(samples,key=lambda s:abs(s[0]-end));elapsed=(stop[0]-start[0])/1000
 first={r[0]:r for r in start[1]};last={r[0]:r for r in stop[1]};cpu={};per_pid=[]
 selected=[s for s in samples if start[0]<=s[0]<=stop[0]]
 for pid,row in last.items():
  if pid in first:
   used=(row[2]-first[pid][2])/elapsed*100
   cpu[row[1]]=cpu.get(row[1],0)+used
   if row[1]=='renderer':per_pid.append((pid,used))
 main_renderer=max(per_pid,key=lambda row:row[1])[0]
 peak={};active_peak=0
 for at,rows in selected:
  current={}
  for pid,kind,sec,rss in rows:
   current[kind]=current.get(kind,0)+rss/1024
   if pid==main_renderer:active_peak=max(active_peak,rss/1024)
  for kind,value in current.items():peak[kind]=max(peak.get(kind,0),value)
 case['hostMeasurement']={'sampleSeconds':elapsed,'cpuPercent':cpu,'peakRssMiB':peak,'activeRendererPeakRssMiB':active_peak}
 print(json.dumps({'label':case['spec']['label'],'backendCpu':round(case['backendCpuPercent'],2),'rendererCpu':round(cpu['renderer'],2),'rendererPeakMiB':round(active_peak,1),'sqlKiBsec':round(case['sqlDelta']['Bytes_sent']/case['seconds']/1024,1),'frameGapP95Ms':round(case['browser']['frameGapP95Ms'],1),'longestTaskMs':case['browser']['longestTaskMs']}))
(folder/('browser'+suffix+'-results.json')).write_text(json.dumps(data,indent=2)+'\n')
