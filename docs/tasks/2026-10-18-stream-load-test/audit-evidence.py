import json
import re
from pathlib import Path

folder = Path(__file__).resolve().parent
raw = json.loads((folder / "raw-results.json").read_text())
assert len(raw) == 3
assert all(
    client["gaps"] == 0
    and client["deltaCount"] == row["spec"]["duration"] * row["spec"]["rate"]
    for row in raw for client in row["clients"]
)
rows = raw[:]
for name, variant in [("browser-results.json", "development"), ("browser-production-results.json", "production")]:
    data = json.loads((folder / name).read_text())
    assert len(data) == 4
    assert [row["generatedEvents"] for row in data] == [900, 900, 1500, 2700]
    assert all(row["variant"] == variant for row in data)
    rows += data
assert all(member["retainedEvents"] <= 1024 for row in rows for member in row["progress"])
environment = json.loads((folder / "environment.json").read_text())
assert ":5279/" in environment["url"]
assert all("/assets/" in url for url in environment["pageScripts"])
assert environment["completedResponses"] == 4
assert all(json.loads(line)["start_commit"] == "475542a8ce4048d47f10d77d8e5cdd32ebf48951"
           for line in (folder / "tests.jsonl").read_text().splitlines())
for file in folder.iterdir():
    if not file.is_file():
        continue
    content = file.read_text()
    if file.suffix in [".json", ".jsonl"]:
        for value in [content] if file.suffix == ".json" else content.splitlines():
            json.loads(value)
    assert not re.search(r"sk-[A-Za-z0-9]{20,}", content), file
print("Evidence integrity, expected events, bounded buffers, production origin and credential scan passed")
