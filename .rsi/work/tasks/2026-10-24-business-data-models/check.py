import subprocess,sys,datetime,json,shlex
from pathlib import Path
command=sys.argv[1:]
start=subprocess.check_output(["git","rev-parse","HEAD"],text=True).strip()
result=subprocess.run(command)
record={"time":datetime.datetime.now(datetime.timezone.utc).isoformat(),"start_commit":start,"command":shlex.join(command),"scope":"Business-owned data models; deterministic providers/disposable SQL only","result":"pass" if result.returncode==0 else "fail"}
with Path(".rsi/work/tasks/2026-10-24-business-data-models/tests.jsonl").open("a") as f:f.write(json.dumps(record)+"\n")
sys.exit(result.returncode)
