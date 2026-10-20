from pathlib import Path
import re
root = Path(__file__).resolve().parents[3]
task = Path(__file__).resolve().parent
for name in ("design.md", "impl.md"):
    canonical = root / "docs/systems/host-deployment" / name
    draft = task / "drafts/host-deployment" / name
    assert draft.read_text().split("\n", 1)[1] == canonical.read_text(), name
    for target in re.findall(r"\]\(([^)]+)\)", canonical.read_text()):
        if "://" not in target:
            assert (canonical.parent / target.split("#")[0]).exists(), target
print("Deployment design/implementation match task drafts; all local links resolve")
