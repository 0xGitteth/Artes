"""Safely consolidate *existing* Artes moderation research under one .tmp folder.

Default = PLAN ONLY. --apply moves selected directories on the same filesystem
and leaves compatibility symlinks at their original paths, preserving scripts,
venvs, private per-image scores, and datasets. --undo reverses exact moves.
NO deletion, git commits, network access, model inference or image processing.
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path

COLLECTION = "Artes_Moderatie_Onderzoek"
INDEX_FILE = "organization-manifest.json"
PREFIXES = ("moderation-", "nsfw-", "artes-moderation-", "adultlabs-")
BUCKETS = (
    ("datasets", ("moderation-v2", "dataset", "training", "balanced")),
    ("modelonderzoek", ("moderation-v5", "nsfw", "model", "yolo", "siglip")),
    ("beeldbronnen", ("discovery", "research", "source")),
    ("eindtest", ("holdout",)),
    ("testmateriaal", ("test-images", "test-set")),
)


def category(name):
    # Prefer end-test and discovery over broad "research" or model buckets.
    lowered = name.lower()
    if "holdout" in lowered:
        return "eindtest"
    if any(marker in lowered for marker in ("test-images", "test-set")):
        return "testmateriaal"
    if "discovery" in lowered or "source" in lowered:
        return "beeldbronnen"
    if "moderation-v2" in lowered or "dataset" in lowered or "training" in lowered:
        return "datasets"
    if any(x in lowered for x in ("moderation-v5", "nsfw", "model", "yolo", "siglip")):
        return "modelonderzoek"
    return "overig"


def locations(project):
    project = project.resolve()
    if not (project / ".git").is_dir() or not (project / ".gitignore").is_file():
        raise ValueError("not_a_known_repository")
    ignore = (project / ".gitignore").read_text(encoding="utf-8")
    if ".tmp/" not in ignore.splitlines():
        raise ValueError("gitignore_does_not_protect_tmp")
    tmp = project / ".tmp"
    if not tmp.is_dir() or tmp.is_symlink():
        raise ValueError("private_tmp_directory_missing")
    collection = tmp / COLLECTION
    if collection.is_symlink():
        raise ValueError("collection_cannot_be_symlink")
    return tmp, collection


def plan(project):
    tmp, collection = locations(project)
    if collection.exists() and (collection / INDEX_FILE).exists():
        raise ValueError("prior_organization_manifest_exists_use_undo_or_review")
    entries = []
    for path in sorted(tmp.iterdir(), key=lambda x: x.name.lower()):
        if path.name == COLLECTION or path.is_symlink() or not path.is_dir():
            continue
        if not path.name.startswith(PREFIXES):
            continue
        dest = collection / category(path.name) / path.name
        if dest.exists() or dest.is_symlink():
            raise ValueError("destination_collision_abort")
        entries.append({"from": path.name, "to": str(dest.relative_to(tmp))})
    return entries


def save_manifest(collection, entries):
    result = {
        "version": 1,
        "status": "applied_compat_symlinks",
        "root": COLLECTION,
        "entries": entries,
        "noDeletion": True,
        "originalPathsPreservedBySymlinks": True,
        "noModelOrDatasetContentChanged": True,
    }
    path = collection / INDEX_FILE
    with path.open("x", encoding="utf-8") as file:
        json.dump(result, file, indent=2, ensure_ascii=False)
        file.write("\n")
    return path


def apply(project):
    tmp, collection = locations(project)
    entries = plan(project)
    if not entries:
        return {"status": "no_matching_directories_to_move", "entries": []}
    # All moves are within the exact same .tmp filesystem. Detect invalid
    # links/collisions BEFORE modifying any original directory.
    for record in entries:
        source = tmp / record["from"]
        dest = tmp / record["to"]
        if source.is_symlink() or not source.is_dir() or dest.exists():
            raise ValueError("source_changed_or_destination_occupied")
    completed = []
    try:
        for record in entries:
            source, dest = tmp / record["from"], tmp / record["to"]
            dest.parent.mkdir(parents=True, exist_ok=True)
            source.rename(dest)
            # Relative symlinks survive Codespace root moves on the same tree.
            try:
                source.symlink_to(os.path.relpath(dest, source.parent), target_is_directory=True)
            except Exception:
                dest.rename(source)
                raise
            completed.append(record)
        manifest = save_manifest(collection, entries)
    except Exception:
        # Restore original paths if anything fails partway through.
        for record in reversed(completed):
            source, dest = tmp / record["from"], tmp / record["to"]
            if source.is_symlink() and source.resolve() == dest.resolve() and dest.exists():
                source.unlink()
                dest.rename(source)
        raise
    return {"status": "applied", "moved": len(entries), "manifest": str(manifest),
            "entries": entries}


def undo(project):
    tmp, collection = locations(project)
    manifest = collection / INDEX_FILE
    if not manifest.is_file() or manifest.is_symlink():
        raise ValueError("organization_manifest_missing")
    report = json.loads(manifest.read_text(encoding="utf-8"))
    if report.get("version") != 1 or report.get("root") != COLLECTION:
        raise ValueError("unrecognized_organization_manifest")
    entries = report.get("entries")
    if not isinstance(entries, list):
        raise ValueError("invalid_organization_manifest")
    # Verify ALL origin symlinks and target directories before first undo.
    for entry in entries:
        source, dest = tmp / entry["from"], tmp / entry["to"]
        if (not re.fullmatch(r"(?:moderation-|nsfw-|artes-moderation-|adultlabs-)[^/]+",
                             entry["from"])
                or not dest.is_relative_to(collection)
                or not source.is_symlink()
                or not dest.is_dir()
                or source.resolve() != dest.resolve()):
            raise ValueError("original_link_or_destination_changed_abort_undo")
    for entry in reversed(entries):
        source, dest = tmp / entry["from"], tmp / entry["to"]
        source.unlink()
        try:
            dest.rename(source)
        except Exception:
            source.symlink_to(os.path.relpath(dest, source.parent),
                              target_is_directory=True)
            raise
    manifest.unlink()
    for bucket in ("eindtest", "testmateriaal", "beeldbronnen", "modelonderzoek", "datasets", "overig"):
        folder = collection / bucket
        if folder.exists():
            folder.rmdir()
    collection.rmdir()
    return {"status": "undone", "restored": len(entries)}


def main():
    parser = argparse.ArgumentParser(description="Non-destructive Artes research folder organizer")
    parser.add_argument("--project", type=Path, default=Path("/workspaces/Artes"))
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--apply", action="store_true", help="Move selected folders and leave old-path links")
    group.add_argument("--undo", action="store_true", help="Restore from the exact organization manifest")
    args = parser.parse_args()
    if args.undo:
        result = undo(args.project)
    elif args.apply:
        result = apply(args.project)
    else:
        result = {
            "status": "preview_only_no_changes",
            "newHome": ".tmp/" + COLLECTION,
            "entries": plan(args.project),
            "note": "Run again with --apply to move; old paths become safe links.",
        }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
