"""Second-stage, reversible cleanup of Artes Codespace research artifacts.

The original nine-folder organizer has already been applied. This script
handles the remaining legacy archives, orphan training folders, and research
logs, and tidies the *VS Code explorer* by hiding old compatibility links.

Default: preview only. --apply: local-only moves + reversible settings change.
--undo: reverse ONLY this second stage; the first-stage layout remains.
No research files deleted, no network access, no model change, no Git changes.
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path

ROOT_NAME = "Artes_Moderatie_Onderzoek"
MANIFEST = "additional-cleanup-manifest.json"
EDITOR_GLOBS = {
    ".tmp/moderation-*": True,
    ".tmp/artes-training-*": True,
    ".tmp/nsfw-*": True,
    "firestore-debug.log": True,
    "dist": True,
}
ROOT_ARCHIVE = re.compile(
    r"(?i)^(?:Artes[_-].*\.(?:zip|pyz)|artes-scene-depth-.*\.zip|"
    r"creative-explicit-.*\.zip|public-fhg-.*\.zip|"
    r"balanced-target-scene-labels\.reviewed\.json)$"
)
TMPS = re.compile(r"(?i)^artes-training-[a-z0-9_-]+$")
PROTECTED_PATHS = {".git", ".gitignore", ".vscode", "src", "public",
                   "functions", "vision-service", "docs", "node_modules",
                   "dist", "scripts", "package.json", "firebase.json"}


def paths(root):
    root = root.resolve()
    if not (root / ".git").is_dir() or not (root / ".gitignore").is_file():
        raise ValueError("not_artes_repository")
    if ".tmp/" not in (root / ".gitignore").read_text(encoding="utf-8").splitlines():
        raise ValueError("private_tmp_not_gitignored")
    tmp = root / ".tmp"
    target = tmp / ROOT_NAME
    first = target / "organization-manifest.json"
    if not first.is_file() or target.is_symlink():
        raise ValueError("first_stage_organization_required")
    document = json.loads(first.read_text(encoding="utf-8"))
    if document.get("version") != 1:
        raise ValueError("unexpected_first_stage_manifest")
    for old in document.get("entries", []):
        source, dest = tmp / old["from"], tmp / old["to"]
        if not source.is_symlink() or not dest.is_dir() or source.resolve() != dest.resolve():
            raise ValueError("broken_first_stage_compatibility_link")
    return root, tmp, target


def tracked(root, relative):
    result = subprocess.run(
        ["git", "-C", str(root), "ls-files", "--error-unmatch", "--", relative],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        check=False, timeout=10,
    )
    return result.returncode == 0


def code_references(root, name):
    """Do not relocate assets used by tracked code with hard-coded filenames."""
    result = subprocess.run(
        ["git", "-C", str(root), "grep", "-l", "-F", "--", name,
         "--", "*.py", "*.sh", "*.js", "*.mjs", "*.json", "*.yml", "*.yaml"],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        text=True, check=False, timeout=20,
    )
    if result.returncode not in (0, 1):
        raise ValueError("cannot_check_source_references")
    return result.returncode == 0


def inspect(root):
    root, tmp, target = paths(root)
    if (target / MANIFEST).exists():
        raise ValueError("second_stage_already_applied")
    entries, skipped = [], []
    for path in sorted(root.iterdir(), key=lambda p: p.name.lower()):
        if path.name in PROTECTED_PATHS or path.is_symlink() or not path.is_file():
            continue
        if not ROOT_ARCHIVE.fullmatch(path.name):
            continue
        if tracked(root, path.name):
            skipped.append({"name": path.name, "why": "tracked_in_git"})
            continue
        if code_references(root, path.name):
            skipped.append({"name": path.name, "why": "referenced_by_tracked_code"})
            continue
        kind = ("menselijke_beoordelingen" if path.suffix.lower() == ".json"
                else "uitvoerbare_oude_tools" if path.suffix.lower() == ".pyz"
                else "oude_archieven")
        entries.append({"from": path.name, "to": str(Path(".tmp") / ROOT_NAME
                         / kind / path.name), "compatibilityLink": False,
                        "sizeBytes": path.stat().st_size})
    for path in sorted(tmp.iterdir(), key=lambda p: p.name.lower()):
        if path.name == ROOT_NAME or path.is_symlink():
            continue
        if path.is_dir() and TMPS.fullmatch(path.name):
            entries.append({"from": ".tmp/" + path.name,
                            "to": str(Path(".tmp") / ROOT_NAME / "datasets" / path.name),
                            "compatibilityLink": True, "sizeBytes": None})
        elif path.is_file() and (path.name.startswith("vision-") and path.suffix == ".log"
                                 or path.name.startswith("web-research-")
                                 and path.suffix == ".zip"):
            folder = "onderzoekslogs" if path.suffix == ".log" else "oude_archieven"
            entries.append({"from": ".tmp/" + path.name,
                            "to": str(Path(".tmp") / ROOT_NAME / folder / path.name),
                            "compatibilityLink": False, "sizeBytes": path.stat().st_size})
    for entry in entries:
        source, dest = root / entry["from"], root / entry["to"]
        if (source.is_symlink() or not source.exists()
                or dest.exists() or dest.is_symlink()
                or not dest.resolve().is_relative_to(target)
                or not source.resolve().is_relative_to(root)):
            raise ValueError("collision_or_unsafe_source_abort")
    settings = root / ".vscode" / "settings.json"
    if settings.is_symlink():
        raise ValueError("vscode_settings_symlink_not_allowed")
    if settings.is_file():
        try:
            data = json.loads(settings.read_text(encoding="utf-8"))
        except (ValueError, UnicodeError):
            raise ValueError("vscode_settings_are_not_standard_json_no_overwrite")
        if not isinstance(data, dict) or not isinstance(data.get("files.exclude", {}), dict):
            raise ValueError("vscode_settings_invalid_format")
        old_text = settings.read_text(encoding="utf-8")
    else:
        old_text = None
    return entries, skipped, old_text


def sha(raw):
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def set_explorer(root, old_text):
    settings = root / ".vscode" / "settings.json"
    parsed = json.loads(old_text) if old_text else {}
    exclusions = parsed.setdefault("files.exclude", {})
    # Avoid overriding explicit existing user's choices.
    for glob, desired in EDITOR_GLOBS.items():
        exclusions.setdefault(glob, desired)
    settings.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(parsed, indent=2, ensure_ascii=False) + "\n"
    if settings.exists():
        settings.write_text(text, encoding="utf-8")
    else:
        with settings.open("x", encoding="utf-8") as f:
            f.write(text)
    return sha(text)


def relocate(root, entries):
    completed = []
    for entry in entries:
        source, dest = root / entry["from"], root / entry["to"]
        dest.parent.mkdir(parents=True, exist_ok=True)
        source.rename(dest)
        try:
            if entry["compatibilityLink"]:
                source.symlink_to(os.path.relpath(dest, source.parent),
                                  target_is_directory=True)
        except Exception:
            dest.rename(source)
            raise
        completed.append(entry)
    return completed


def revert_moves(root, entries):
    for entry in reversed(entries):
        source, dest = root / entry["from"], root / entry["to"]
        if entry["compatibilityLink"]:
            if not source.is_symlink() or source.resolve() != dest.resolve():
                raise ValueError("moved_compatibility_link_modified")
            source.unlink()
        elif source.exists() or source.is_symlink():
            raise ValueError("original_location_reused_cannot_restore")
        dest.rename(source)


def apply(root):
    root, tmp, target = paths(root)
    entries, skipped, settings_before = inspect(root)
    completed = []
    settings_sha = None
    try:
        for entry in entries:
            source, dest = root / entry["from"], root / entry["to"]
            dest.parent.mkdir(parents=True, exist_ok=True)
            source.rename(dest)
            try:
                if entry["compatibilityLink"]:
                    source.symlink_to(os.path.relpath(dest, source.parent),
                                      target_is_directory=True)
            except Exception:
                dest.rename(source)
                raise
            completed.append(entry)
        settings_sha = set_explorer(root, settings_before)
        manifest = {
            "version": 2, "entries": entries, "skipped": skipped,
            "editorOriginalText": settings_before, "editorAfterSha256": settings_sha,
            "firstStageUntouched": True,
        }
        with (target / MANIFEST).open("x", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)
            f.write("\n")
    except Exception:
        # Roll back both archives and editor changes on partial failures.
        if settings_sha:
            settings = root / ".vscode" / "settings.json"
            if settings.is_file() and sha(settings.read_text(encoding="utf-8")) == settings_sha:
                if settings_before is None:
                    settings.unlink()
                else:
                    settings.write_text(settings_before, encoding="utf-8")
        revert_moves(root, completed)
        raise
    return {"status": "applied", "moved": len(entries), "skipped": skipped,
            "editorLegacyLinksHidden": True,
            "location": str(target), "manifest": str(target / MANIFEST)}


def undo(root):
    root, tmp, target = paths(root)
    path = target / MANIFEST
    if not path.is_file() or path.is_symlink():
        raise ValueError("second_stage_manifest_not_present")
    document = json.loads(path.read_text(encoding="utf-8"))
    if document.get("version") != 2 or document.get("firstStageUntouched") is not True:
        raise ValueError("unrecognized_second_stage")
    entries = document["entries"]
    # Validate all sources/targets BEFORE changing anything.
    for entry in entries:
        original, dest = root / entry["from"], root / entry["to"]
        if (not dest.is_relative_to(target) or not dest.exists()
                or (entry["compatibilityLink"] and (
                    not original.is_symlink() or original.resolve() != dest.resolve()))
                or (not entry["compatibilityLink"] and (
                    original.exists() or original.is_symlink()))):
            raise ValueError("workspace_changed_abort_undo")
    settings = root / ".vscode" / "settings.json"
    if (not settings.is_file() or settings.is_symlink() or
            sha(settings.read_text(encoding="utf-8")) != document["editorAfterSha256"]):
        raise ValueError("editor_settings_changed_abort_undo_no_overwrite")
    revert_moves(root, entries)
    before = document["editorOriginalText"]
    if before is None:
        settings.unlink()
    else:
        settings.write_text(before, encoding="utf-8")
    path.unlink()
    for folder in ("oude_archieven", "menselijke_beoordelingen", "uitvoerbare_oude_tools",
                   "onderzoekslogs", "datasets"):
        dst = target / folder
        if dst.is_dir() and not any(dst.iterdir()):
            dst.rmdir()
    return {"status": "undone", "restored": len(entries)}


def main():
    parser = argparse.ArgumentParser(description="Second-stage Artes Codespace tidy-up")
    parser.add_argument("--project", type=Path, default=Path("/workspaces/Artes"))
    mutually = parser.add_mutually_exclusive_group()
    mutually.add_argument("--apply", action="store_true")
    mutually.add_argument("--undo", action="store_true")
    args = parser.parse_args()
    if args.apply:
        outcome = apply(args.project)
    elif args.undo:
        outcome = undo(args.project)
    else:
        entries, skipped, _ = inspect(args.project)
        outcome = {
            "status": "preview_only_no_changes",
            "willRelocate": entries,
            "skippedToProtectCode": skipped,
            "willHideExplorerLegacyLinks": list(EDITOR_GLOBS),
            "willNotTouch": [
                "version-controlled docs/source-code", "first nine grouped directories",
                "Git branches", "running emulator log file", "model contents",
            ],
            "rootArchivesHaveNoLegacySymlink": True,
            "undoAvailable": True,
        }
    print(json.dumps(outcome, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
