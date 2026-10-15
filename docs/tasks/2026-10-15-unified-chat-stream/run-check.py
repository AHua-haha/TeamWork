from datetime import datetime, timezone
from pathlib import Path
import json
import subprocess
import sys

task = Path(__file__).resolve().parent
result = subprocess.run(sys.argv[1:])
record = {
    'time': datetime.now(timezone.utc).isoformat(),
    'start_commit': 'd56704dea4ac72659e20731e9da5a94eeece42ac',
    'command': sys.argv[1:],
    'scope': 'Unified group-chat streaming implementation candidate',
    'result': 'pass' if result.returncode == 0 else 'fail',
    'exit_code': result.returncode,
}
with (task / 'tests.jsonl').open('a') as log:
    log.write(json.dumps(record) + '\n')
sys.exit(result.returncode)
