from __future__ import annotations

import importlib.util
import json
import shutil
import sys
from pathlib import Path

REQUIRED_MODULES = {
    "fastapi": "fastapi",
    "uvicorn": "uvicorn",
    "PIL": "pillow",
    "torch": "torch",
    "transformers": "transformers",
}


def module_status(import_name: str) -> dict:
    spec = importlib.util.find_spec(import_name)
    return {
        "installed": spec is not None,
        "origin": str(spec.origin) if spec and spec.origin else None,
    }


def main() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    usage = shutil.disk_usage(repo_root)
    modules = {
        package_name: module_status(import_name)
        for import_name, package_name in REQUIRED_MODULES.items()
    }
    missing = sorted(
        package_name
        for package_name, status in modules.items()
        if not status["installed"]
    )

    print(json.dumps({
        "auditMode": "local_vision_runtime_read_only",
        "writes": False,
        "pythonVersion": sys.version.split()[0],
        "modules": modules,
        "missingPackages": missing,
        "disk": {
            "freeGiB": round(usage.free / (1024 ** 3), 2),
            "totalGiB": round(usage.total / (1024 ** 3), 2),
        },
        "modelDownloadedByThisAudit": False,
        "packagesInstalledByThisAudit": False,
    }, indent=2))


if __name__ == "__main__":
    main()
