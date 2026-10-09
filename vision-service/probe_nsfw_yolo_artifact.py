"""Read-only NSFW-YOLO artifact preflight for an isolated Artes research experiment.

Downloads *publisher model artifact only* (never user images), audits the TAR
contents without extracting or executing anything. No model is imported.
No inference, deployment or source-license changes occur in this phase.
"""
import argparse
import hashlib
import io
import json
import os
import re
import tarfile
import urllib.request
from collections import Counter
from pathlib import Path, PurePosixPath

MODEL_REPO = 'necrosyth/nsfw-detection-with-yolo'
MODEL_FILENAME = 'nsfw_Detection.tar'
MODEL_API = f'https://huggingface.co/api/models/{MODEL_REPO}'
MAX_DOWNLOAD_BYTES = 330 * 1024 * 1024
MAX_CONTENT_BYTES = 2 * 1024 * 1024 * 1024
MAX_MEMBERS = 10000
EXPECTED_LABELS_FROM_CARD = [
    'safe', 'suggestive', 'explicit_partial', 'explicit_full',
    'sexual_act', 'text_overlay',
]
RISKY_EXTENSIONS = {'.pt', '.pth', '.pkl', '.pickle', '.py', '.sh',
                    '.exe', '.dll', '.so', '.bat', '.joblib'}
LOADABLE_FORMATS = {'.onnx', '.safetensors', '.pt', '.pth', '.tflite'}


def read_publisher_revision(urlopen=urllib.request.urlopen):
    request = urllib.request.Request(
        MODEL_API, headers={'User-Agent': 'Artes-private-model-preflight/1'})
    with urlopen(request, timeout=30) as response:
        raw = response.read(2 * 1024 * 1024 + 1)
    if len(raw) > 2 * 1024 * 1024:
        raise ValueError('oversized_model_metadata')
    metadata = json.loads(raw)
    revision = metadata.get('sha', '')
    if not re.fullmatch('[0-9a-f]{40}', revision):
        raise ValueError('unverified_model_revision')
    files = {
        item.get('rfilename')
        for item in metadata.get('siblings', []) if isinstance(item, dict)
    }
    if MODEL_FILENAME not in files:
        raise ValueError('model_archive_not_present_in_publisher_repository')
    return revision


def download_archive(dest, revision, urlopen=urllib.request.urlopen):
    if not re.fullmatch('[0-9a-f]{40}', revision):
        raise ValueError('unverified_model_revision')
    if dest.exists():
        size = dest.stat().st_size
        if not 1 <= size <= MAX_DOWNLOAD_BYTES:
            raise ValueError('invalid_existing_archive_size')
        print(f'Reusing local archive ({size} bytes).', flush=True)
        return size
    url = f'https://huggingface.co/{MODEL_REPO}/resolve/{revision}/{MODEL_FILENAME}'
    req = urllib.request.Request(
        url, headers={'User-Agent': 'Artes-private-model-preflight/1'})
    partial = dest.with_name(dest.name + '.partial')
    partial.unlink(missing_ok=True)
    read_bytes = 0
    try:
        with urlopen(req, timeout=90) as response, partial.open('xb') as output:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                read_bytes += len(chunk)
                if read_bytes > MAX_DOWNLOAD_BYTES:
                    raise ValueError('model_archive_exceeds_330_mib_limit')
                output.write(chunk)
                if read_bytes and read_bytes % (32 * 1024 * 1024) < len(chunk):
                    print(f'Downloaded {read_bytes // (1024 * 1024)} MiB...', flush=True)
        if not read_bytes:
            raise ValueError('empty_model_archive')
        partial.replace(dest)
        return read_bytes
    finally:
        partial.unlink(missing_ok=True)


def inspect_archive(archive):
    total = 0
    members = []
    extensions = Counter()
    unsafe = []
    try:
        with tarfile.open(archive, mode='r:*') as file:
            for index, member in enumerate(file):
                if index >= MAX_MEMBERS:
                    raise ValueError('model_archive_too_many_entries')
                name = member.name
                p = PurePosixPath(name)
                # Never extract any of these files, including benign entries.
                if (not name or '\\' in name or p.is_absolute()
                    or '..' in p.parts or ':' in p.parts[0]
                    or member.issym() or member.islnk()
                    or not (member.isfile() or member.isdir())):
                    unsafe.append(name[:160])
                if member.isfile():
                    total += member.size
                    if total > MAX_CONTENT_BYTES:
                        raise ValueError('model_archive_oversized_uncompressed_content')
                    extensions[p.suffix.lower()] += 1
                    members.append({'name': name[:180], 'sizeBytes': member.size,
                                    'extension': p.suffix.lower()})
    except (tarfile.TarError, EOFError) as exc:
        raise ValueError('model_archive_invalid_tar') from exc
    return {
        'memberCount': len(members),
        'totalUncompressedFileBytes': total,
        'extensions': dict(sorted(extensions.items())),
        'unsafeArchiveEntries': unsafe[:20],
        'topFilesBySize': sorted(members, key=lambda x: -x['sizeBytes'])[:20],
        'modelWeightCandidates': [
            item for item in members if item['extension'] in LOADABLE_FORMATS
        ][:30],
        'potentiallyExecutableOrPickleFiles': [
            item['name'] for item in members
            if item['extension'] in RISKY_EXTENSIONS
        ][:30],
    }


def preflight(work, offline_archive=None):
    work.mkdir(parents=True, exist_ok=True)
    if offline_archive:
        revision = None
        archive = Path(offline_archive)
    else:
        revision = read_publisher_revision()
        archive = work / f'nsfw-yolo-{revision}.tar'
        download_archive(archive, revision)
    if not archive.is_file():
        raise ValueError('model_archive_unavailable')
    digest = hashlib.file_digest(archive.open('rb'), 'sha256').hexdigest()
    inspection = inspect_archive(archive)
    has_weights = bool(inspection['modelWeightCandidates'])
    status = ('blocked_unsafe_archive' if inspection['unsafeArchiveEntries']
              else 'no_recognized_model_weights' if not has_weights
              else 'inspected_not_executed')
    output = {
        'status': status,
        'purpose': 'private_research_only_no_inference_no_deployment',
        'publisherModelRepository': MODEL_REPO,
        'publisherRevision': revision,
        'downloadBytes': archive.stat().st_size,
        'archiveSha256': digest,
        'claimedModelCardClassesNotVerifiedInWeights': EXPECTED_LABELS_FROM_CARD,
        **inspection,
        'safetyNotes': [
            'The archive was not extracted; no untrusted Python or torch pickle executed.',
            'A publisher-declared class taxonomy is NOT independently verified model behavior.',
            'AGPL/CC-BY licensing not resolved for Artes product integration.',
            'Original Artes media and model inference were not accessed during this preflight.',
        ],
    }
    report_path = work / 'nsfw-yolo-archive-preflight.json'
    report_path.write_text(json.dumps(output, indent=2) + '\n', encoding='utf-8')
    print('Model archive status:', status)
    print('Model formats found:', output['extensions'])
    print('Send ONLY this report:', report_path)
    if status != 'inspected_not_executed':
        raise ValueError('model_artifact_requires_manual_review')
    return output


def main():
    parser = argparse.ArgumentParser(description='Safe publisher TAR metadata inspection')
    parser.add_argument('--work', required=True)
    args = parser.parse_args()
    preflight(Path(args.work))


if __name__ == '__main__':
    main()
