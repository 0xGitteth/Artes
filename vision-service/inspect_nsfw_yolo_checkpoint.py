"""Offline forensic check of the *existing* NSFW-YOLO publisher archive.

Does NOT deserialize TensorFlow checkpoints, execute model code, extract files,
make network requests, or read/upload Artes photographs. Reads at most 4 MiB
per metadata file directly from TAR and matches an allowlisted set of hints.
"""
import argparse
import hashlib
import json
import re
import tarfile
from collections import Counter
from pathlib import Path, PurePosixPath

from probe_nsfw_yolo_artifact import inspect_archive

MAX_METADATA_SAMPLE = 4 * 1024 * 1024
MAX_METADATA_FILE = 128 * 1024 * 1024
HINTS = (
    'yolov8', 'ultralytics', 'darknet', 'yolo', 'mobilenet', 'inception',
    'resnet', 'efficientnet', 'conv2d', 'depthwise', 'batch_normalization',
    'batchnorm', 'bbox', 'bounding_box', 'boxes', 'anchors', 'logits',
    'softmax', 'sigmoid', 'tensorflow', 'images', 'input', 'output',
)
CARD_CLASSES = (
    'safe', 'suggestive', 'explicit_partial', 'explicit_full',
    'sexual_act', 'text_overlay',
)


def checkpoint_parts(member_names):
    """Only recognize matched (.meta, .index, .data-nnn-of-nnn) families."""
    names = set(member_names)
    families = []
    for name in sorted(names):
        if not name.endswith('.meta'):
            continue
        stem = name[:-5]
        index = stem + '.index'
        shard = sorted(x for x in names if re.fullmatch(
            re.escape(stem) + r'\.data-\d{5}-of-\d{5}', x))
        if index in names and shard:
            families.append({
                'metaName': name,
                'indexName': index,
                'shardNames': shard[:12],
                'shardCount': len(shard),
            })
    return families


def allowed_member(member):
    name = member.name
    p = PurePosixPath(name)
    return (
        bool(name) and bool(p.parts) and not p.is_absolute()
        and '..' not in p.parts and '\\' not in name
        and member.isfile() and not member.issym() and not member.islnk()
        and member.size <= MAX_METADATA_FILE
    )


def inspect_existing_checkpoint(work):
    report = work / 'nsfw-yolo-archive-preflight.json'
    if not report.is_file():
        raise ValueError('previous_preflight_report_missing')
    prev = json.loads(report.read_text(encoding='utf-8'))
    revision = prev.get('publisherRevision', '')
    sha = prev.get('archiveSha256', '')
    if not re.fullmatch('[0-9a-f]{40}', revision):
        raise ValueError('unverified_publisher_revision')
    if not re.fullmatch('[0-9a-f]{64}', sha):
        raise ValueError('unverified_archive_checksum')
    archive = work / f'nsfw-yolo-{revision}.tar'
    if not archive.is_file() or archive.stat().st_size != prev.get('downloadBytes'):
        raise ValueError('previous_model_archive_missing_or_size_changed')
    with archive.open('rb') as source:
        actual = hashlib.file_digest(source, 'sha256').hexdigest()
    if actual != sha:
        raise ValueError('previous_archive_hash_mismatch')

    contents = inspect_archive(archive)
    if contents['unsafeArchiveEntries']:
        raise ValueError('archive_unsafe_entries_manual_review')
    members = [member['name'] for member in contents['topFilesBySize']]
    with tarfile.open(archive, 'r:*') as inp:
        all_regular = [m for m in inp if m.isfile()]
        family = checkpoint_parts([m.name for m in all_regular])
        summaries = []
        for item in family:
            evidence = {'meta': {}, 'index': {}}
            for part_name, filename in (('meta', item['metaName']), ('index', item['indexName'])):
                member = inp.getmember(filename)
                if not allowed_member(member):
                    raise ValueError('unsafe_model_metadata')
                with inp.extractfile(member) as file:
                    data = file.read(min(MAX_METADATA_SAMPLE, member.size))
                lower = data.lower()
                evidence[part_name] = {
                    'sampleBytes': len(data),
                    'totalBytes': member.size,
                    'hints': {word: lower.count(word.encode('ascii')) for word in HINTS
                              if word.encode('ascii') in lower},
                    'claimedClassNamePresent': {
                        word: word.encode('ascii') in lower for word in CARD_CLASSES
                    },
                }
            summaries.append({
                'checkpointName': PurePosixPath(item['metaName']).name[:-5],
                'checkpointIndexPresent': True,
                'checkpointShardCount': item['shardCount'],
                'metadataEvidence': evidence,
            })

    status = ('checkpoint_family_found_architecture_unverified' if summaries
              else 'no_complete_checkpoint_family')
    result = {
        'status': status,
        'artifactSha256': sha,
        'publisherRevision': revision,
        'archiveExtensionCounts': contents['extensions'],
        'tensorflowStyleCheckpointFamilyCount': len(summaries),
        'checkpointFamilies': summaries,
        'modelCardClaimsYoloV8AndSixClasses': True,
        'warning': 'TensorFlow .meta/.index/.data files differ from a usual PyTorch YOLOv8 .pt checkpoint. These naming and string hints do NOT verify the model architecture or labels.',
        'notPerformed': [
            'No TensorFlow or model code loaded',
            'No archive extraction',
            'No image inference or external data transfer',
            'No changes to Artes runtime or license',
        ],
    }
    destination = work / 'nsfw-yolo-checkpoint-inspection.json'
    destination.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print('Checkpoint discovery:', status, flush=True)
    print('Checkpoint families:', len(summaries), flush=True)
    for item in summaries:
        print('Metadata hints:', {
            part: data['hints'] for part, data in item['metadataEvidence'].items()
        }, flush=True)
    print('Share ONLY:', destination, flush=True)
    return result


def main():
    parser = argparse.ArgumentParser(description='Offline TF-style checkpoint metadata audit')
    parser.add_argument('--work', required=True)
    args = parser.parse_args()
    inspect_existing_checkpoint(Path(args.work))


if __name__ == '__main__':
    main()
