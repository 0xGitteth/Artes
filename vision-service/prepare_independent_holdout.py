"""Prepare and seal an independent, private Artes image holdout in Codespaces.

Only local files are inspected; no uploads, downloads, model inference,
training, automatic labels or publication. Human labels and rights evidence
MUST be provided before seal. Existing development groups/images are excluded.

Usage:
  python prepare_independent_holdout.py scan --development PATH --holdout PATH
  python prepare_independent_holdout.py seal --development PATH --holdout PATH
Holdout directory contains 'images/' (candidate image files), plus local
'holdout-draft.json' and (after approval) 'holdout-sealed.json'.
"""
import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path

from PIL import Image, ImageOps

from evaluate_nsfw_development import load_development_rows, LABELS

NUDITY = frozenset(('none', 'implied_nude', 'bare_buttocks',
                    'female_bare_breasts', 'genitalia'))
EXTENSIONS = frozenset(('.jpg', '.jpeg', '.png', '.webp'))
IMAGE_LIMIT_BYTES = 30 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 85_000_000
DUPLICATE_DISTANCE = 6


def sha_file(path):
    digest = hashlib.sha256()
    with path.open('rb') as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def visual_hash(path):
    with Image.open(path) as original:
        original.verify()
    with Image.open(path) as original:
        image = ImageOps.exif_transpose(original)
        if image.width * image.height > Image.MAX_IMAGE_PIXELS:
            raise ValueError('oversized_image_pixel_count')
        grayscale = image.convert('L').resize((9, 8), Image.Resampling.BILINEAR)
        pixels = list(grayscale.getdata())
    bits = 0
    for row in range(8):
        for col in range(8):
            bits = (bits << 1) | int(pixels[row * 9 + col] > pixels[row * 9 + col + 1])
    return f'{bits:016x}'


def hamming(a, b):
    return (int(a, 16) ^ int(b, 16)).bit_count()


def candidates(holdout):
    root = holdout.resolve()
    images = (root / 'images').resolve()
    if not images.is_dir() or not images.is_relative_to(root):
        raise ValueError('private_holdout_images_folder_missing')
    paths = []
    for path in images.iterdir():
        if path.is_symlink():
            raise ValueError('holdout_symlinks_forbidden')
        if path.is_file():
            if path.suffix.lower() not in EXTENSIONS:
                raise ValueError('unsupported_file_in_holdout_images_directory')
            if not path.resolve().is_relative_to(images):
                raise ValueError('holdout_path_escapes_private_directory')
            if not 0 < path.stat().st_size <= IMAGE_LIMIT_BYTES:
                raise ValueError('invalid_holdout_image_size')
            paths.append(path)
        elif path.is_dir():
            raise ValueError('holdout_nested_directories_not_supported')
    return sorted(paths, key=lambda path: path.name)


def read_development(development):
    existing = load_development_rows(development)
    if len(existing) != 375:
        raise ValueError('expected_375_existing_development_images')
    dev_shas = set()
    dev_groups = set()
    dev_visuals = []
    for row in existing:
        path = row['resolvedPath']
        dev_shas.add(row['sha256'].lower())
        dev_shas.add(sha_file(path))
        dev_groups.add(row['sourceGroup'].strip().casefold())
        dev_visuals.append(visual_hash(path))
    return dev_shas, dev_groups, dev_visuals


def inspect_candidates(holdout, development):
    dev_shas, dev_groups, dev_visuals = read_development(development)
    found = []
    image_shas = set()
    similar_to_training = 0
    for path in candidates(holdout):
        digest = sha_file(path)
        visual = visual_hash(path)
        if digest in dev_shas or digest in image_shas:
            raise ValueError('holdout_duplicate_image_hash')
        image_shas.add(digest)
        if any(hamming(visual, previous) <= DUPLICATE_DISTANCE
               for previous in dev_visuals):
            similar_to_training += 1
            raise ValueError('holdout_visual_near_duplicate_to_development')
        found.append({
            'imagePath': 'images/' + path.name,
            'sha256': digest,
            'dhash': visual,
        })
    return found, dev_groups, similar_to_training


def scan(development, holdout):
    root = holdout.resolve()
    draft = root / 'holdout-draft.json'
    if draft.exists():
        raise ValueError('holdout_draft_already_exists_do_not_overwrite_human_labels')
    images, _, _ = inspect_candidates(root, development)
    if not images:
        raise ValueError('no_new_independent_images_found')
    rows = []
    for image in images:
        rows.append({
            **image,
            'sourceGroup': '',
            'sexualContext': '',
            'nudity': '',
            'adultSubjectsVerified': False,
            'useRightsConfirmed': False,
            'rightsEvidenceRef': '',
            'artesResearchNoveltyConfirmed': False,
            'independenceNote': '',
        })
    result = {
        'schemaVersion': 1,
        'intendedUse': 'independent_holdout_research_only',
        'manuallyLabeledBeforeInference': True,
        'images': rows,
    }
    draft.write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    return {'candidateImages': len(rows), 'draftCreated': True, 'nextStep': 'human_labels_and_rights_required'}


def validate_draft(draft, scan_images, dev_groups):
    if draft.get('schemaVersion') != 1 or draft.get('intendedUse') != 'independent_holdout_research_only':
        raise ValueError('invalid_holdout_manifest_schema')
    rows = draft.get('images')
    if not isinstance(rows, list) or len(rows) != len(scan_images) or not rows:
        raise ValueError('incomplete_holdout_manifest')
    expected = {img['sha256']: img for img in scan_images}
    seen = set()
    groups = {}
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError('invalid_holdout_annotation')
        digest = row.get('sha256')
        expected_image = expected.get(digest)
        if not expected_image or digest in seen:
            raise ValueError('unexpected_or_duplicate_holdout_image')
        seen.add(digest)
        if (row.get('imagePath') != expected_image['imagePath']
                or row.get('dhash') != expected_image['dhash']):
            raise ValueError('image_identity_mismatch')
        group = row.get('sourceGroup')
        if not isinstance(group, str) or not group.strip() or group.strip().casefold() in dev_groups:
            raise ValueError('holdout_source_group_missing_or_development_overlap')
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.:]{2,79}', group):
            raise ValueError('holdout_group_must_be_nonidentifying_code')
        if row.get('sexualContext') not in LABELS or row.get('nudity') not in NUDITY:
            raise ValueError('missing_or_invalid_independent_human_label')
        if any(row.get(flag) is not True for flag in (
                'adultSubjectsVerified', 'useRightsConfirmed',
                'artesResearchNoveltyConfirmed')):
            raise ValueError('holdout_consent_rights_and_independence_required')
        if not isinstance(row.get('rightsEvidenceRef'), str) or not row['rightsEvidenceRef'].strip():
            raise ValueError('holdout_rights_reference_required')
        if not isinstance(row.get('independenceNote'), str) or not row['independenceNote'].strip():
            raise ValueError('holdout_source_independence_explanation_required')
        groups.setdefault(group, []).append(row)
    if set(expected) != seen:
        raise ValueError('incomplete_holdout_labels')
    # Images with visually similar content from unrelated source groups may
    # indicate a mislabeled duplicate source, or a shared reused stock image.
    for i, a in enumerate(rows):
        for b in rows[i+1:]:
            if a['sourceGroup'] != b['sourceGroup'] and hamming(a['dhash'], b['dhash']) <= DUPLICATE_DISTANCE:
                raise ValueError('holdout_cross_group_visual_near_duplicate')
    return {'total': len(rows),
            'groups': len(groups),
            'contexts': dict(Counter(row['sexualContext'] for row in rows)),
            'allowedNudes': sum(row['sexualContext'] != 'explicit_act'
                                and row['nudity'] != 'none' for row in rows)}


def seal(development, holdout):
    root = holdout.resolve()
    sealed_path = root / 'holdout-sealed.json'
    if sealed_path.exists():
        raise ValueError('holdout_already_sealed_never_modify_final_test_labels')
    draft_path = root / 'holdout-draft.json'
    if not draft_path.is_file():
        raise ValueError('holdout_draft_missing_run_scan_first')
    data = json.loads(draft_path.read_text(encoding='utf-8'))
    discovered, dev_groups, _ = inspect_candidates(root, development)
    summary = validate_draft(data, discovered, dev_groups)
    sealed = dict(data)
    sealed['sealingStatus'] = 'sealed_before_any_model_inference'
    payload = json.dumps(sealed, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
    seal_hash = hashlib.sha256(payload.encode()).hexdigest()
    sealed['sealSha256'] = seal_hash
    sealed_path.write_text(json.dumps(sealed, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    summary.update({'status': 'sealed_local_only_no_model_scoring',
                    'noveltyClaim': 'human_attestation_plus_exact_and_dhash_checks_not_full_proof',
                    'sealedManifestSha256': seal_hash})
    # Only counts and an opaque seal digest leave Codespaces.
    output = root / 'holdout-intake-aggregate.json'
    output.write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')
    return summary


def main():
    p = argparse.ArgumentParser(description='Rights-checked independent private Artes holdout intake')
    p.add_argument('command', choices=('scan', 'seal'))
    p.add_argument('--development', type=Path, required=True)
    p.add_argument('--holdout', type=Path, required=True)
    args = p.parse_args()
    result = scan(args.development, args.holdout) if args.command == 'scan' else seal(args.development, args.holdout)
    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
