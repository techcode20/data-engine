import re
import sys
from datetime import date

def bump_patch(pyproject_text):
    match = re.search(r'version = "(\d+)\.(\d+)\.(\d+)"', pyproject_text)
    major, minor, patch = match.groups()
    new_version = f"{major}.{minor}.{int(patch) + 1}"
    return re.sub(r'version = "\d+\.\d+\.\d+"', f'version = "{new_version}"', pyproject_text, count=1), new_version

if __name__ == "__main__":
    with open("pyproject.toml", "r") as f:
        content = f.read()
    new_content, new_version = bump_patch(content)
    with open("pyproject.toml", "w") as f:
        f.write(new_content)

    note = sys.argv[1] if len(sys.argv) > 1 else "Unreleased changes"
    with open("CHANGELOG.md", "r") as f:
        changelog = f.read()
    entry = f"\n## {new_version} — {date.today().isoformat()}\n{note}\n"
    with open("CHANGELOG.md", "w") as f:
        f.write(changelog.rstrip() + "\n" + entry)

    print(f"Bumped to {new_version}, added CHANGELOG entry.")