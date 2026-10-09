"""Evaluate verified publisher RedDesert weights on private existing Artes development photos.

No source code from the model publisher is executed: a torchvision ResNet34 is
built locally and verified safetensors are loaded strictly. No external image
API, no output photos, no moderation/policy changes, no model release.
"""
import argparse
import hashlib
import json
import math
import os
import re
import urllib.request
from collections import Counter
from pathlib import Path

from evaluate_nsfw_development import load_development_rows

MODEL_ID = 'reddesert/nsfw_detection'
API_URL = 'https://huggingface.co/api/models/' + MODEL_ID
MODEL_FILE = 'nsfw_model.safetensors'
FILE_BYTES = 85248972
FILE_SHA256 = '1d3aadfd504444da3252f8e53e2609f4adc38e0f5f82fdf188d066d68b4b42f3'
CLASSES = ('bdsm', 'disgusting', 'drawings', 'gore', 'hentai',
           'unnamed_a', 'neutral', 'q', 'sexy', 'unnamed_b', 'x')
CONTEXTS = ('none', 'suggestive', 'bdsm_kink', 'explicit_act')
NUDE = frozenset(('implied_nude', 'bare_buttocks', 'female_bare_breasts', 'genitalia'))
IMAGE_SIZE = 320
MAX_METADATA_BYTES = 1024 * 1024


def read_revision():
    request = urllib.request.Request(API_URL, headers={'User-Agent': 'Artes-research/1'})
    with urllib.request.urlopen(request, timeout=35) as response:
        raw = response.read(MAX_METADATA_BYTES + 1)
    if len(raw) > MAX_METADATA_BYTES:
        raise ValueError('publisher_metadata_oversized')
    meta = json.loads(raw)
    sha = meta.get('sha')
    if not isinstance(sha, str) or not re.fullmatch('[0-9a-f]{40}', sha):
        raise ValueError('unverified_model_revision')
    if MODEL_FILE not in {f.get('rfilename') for f in meta.get('siblings', [])}:
        raise ValueError('publisher_model_weights_missing')
    return sha


def download_verified_weight(work, revision):
    path = work / ('reddesert-' + FILE_SHA256[:16] + '.safetensors')
    if path.is_file():
        if path.stat().st_size != FILE_BYTES:
            raise ValueError('existing_model_weight_size_mismatch')
        with path.open('rb') as f:
            digest = hashlib.file_digest(f, 'sha256').hexdigest()
        if digest != FILE_SHA256:
            raise ValueError('existing_model_weight_sha256_mismatch')
        print('Verified existing publisher weights. No re-download.', flush=True)
        return path
    url = f'https://huggingface.co/{MODEL_ID}/resolve/{revision}/{MODEL_FILE}'
    request = urllib.request.Request(url, headers={'User-Agent': 'Artes-research/1'})
    partial = path.with_name(path.name + '.partial')
    partial.unlink(missing_ok=True)
    got = 0
    hasher = hashlib.sha256()
    try:
        with urllib.request.urlopen(request, timeout=90) as response, partial.open('xb') as out:
            while chunk := response.read(1024 * 1024):
                got += len(chunk)
                if got > FILE_BYTES:
                    raise ValueError('publisher_weights_larger_than_manifest')
                out.write(chunk)
                hasher.update(chunk)
                if got % (20 * 1024 * 1024) < len(chunk):
                    print('Downloaded:', got // (1024 * 1024), 'MiB', flush=True)
        if got != FILE_BYTES or hasher.hexdigest() != FILE_SHA256:
            raise ValueError('publisher_model_weights_do_not_match_immutable_manifest')
        partial.replace(path)
        return path
    finally:
        partial.unlink(missing_ok=True)


def validate_probabilities(scores):
    if not isinstance(scores, (list, tuple)) or len(scores) != len(CLASSES):
        raise ValueError('unexpected_red_desert_output_dim')
    if any(not isinstance(x, (int, float)) or not math.isfinite(x) or x < 0 or x > 1 for x in scores):
        raise ValueError('invalid_probability')
    if abs(sum(scores) - 1) > .005:
        raise ValueError('invalid_probability_sum')
    return dict(zip(CLASSES, map(float, scores)))


def read_cache(path, rows):
    allowed = {r['sha256']: r for r in rows}
    records = {}
    if not path.is_file():
        return records
    for line in path.read_text(encoding='utf-8').splitlines():
        if not line.strip():
            continue
        obj = json.loads(line)
        sha = obj.get('sha256')
        if sha not in allowed or sha in records or obj.get('weightsSha256') != FILE_SHA256:
            raise ValueError('unknown_duplicate_or_wrong_model_score')
        if obj.get('sourceGroup') != allowed[sha]['sourceGroup']:
            raise ValueError('source_group_mismatch')
        records[sha] = validate_probabilities(obj['scores'])
    return records


def score_local_images(rows, path, weights):
    cached = read_cache(path, rows)
    remaining = [r for r in rows if r['sha256'] not in cached]
    if not remaining:
        print('All cached classifications reused.', flush=True)
        return cached
    import numpy as np
    import torch
    from PIL import Image
    from safetensors.torch import load_file
    from torchvision.models import resnet34
    torch.set_num_threads(min(2, max(1, os.cpu_count() or 1)))
    model = resnet34(weights=None, num_classes=len(CLASSES))
    state = load_file(str(weights), device='cpu')
    model.load_state_dict(state, strict=True)
    model.eval().to('cpu')
    print('Publisher ResNet34 weights verified and loaded without remote Python code.', flush=True)
    mean = np.asarray((.485, .456, .406), dtype='float32').reshape(3, 1, 1)
    std = np.asarray((.229, .224, .225), dtype='float32').reshape(3, 1, 1)
    with path.open('a', encoding='utf-8') as out:
        for n, row in enumerate(remaining, 1):
            with Image.open(row['resolvedPath']) as im:
                rgb = im.convert('RGB').resize((IMAGE_SIZE, IMAGE_SIZE), Image.Resampling.BILINEAR)
                arr = np.asarray(rgb, dtype='float32')
            data = ((arr.transpose(2, 0, 1) / 255.0 - mean) / std).copy()
            with torch.inference_mode():
                logits = model(torch.from_numpy(data).unsqueeze(0))
                scores = torch.softmax(logits, dim=-1)[0].tolist()
            prediction = validate_probabilities(scores)
            out.write(json.dumps({
                'sha256': row['sha256'],
                'sourceGroup': row['sourceGroup'],
                'weightsSha256': FILE_SHA256,
                'scores': prediction,
            }, separators=(',', ':')) + '\n')
            out.flush()
            cached[row['sha256']] = prediction
            if n % 25 == 0 or n == len(remaining):
                print(f'Local inference: {n}/{len(remaining)}', flush=True)
    return cached


def aggregate(rows, predictions, revision):
    from sklearn.metrics import roc_auc_score
    contexts = {c: [r for r in rows if r['sexualContext'] == c] for c in CONTEXTS}
    def summary(subset):
        top = Counter(max(predictions[r['sha256']], key=predictions[r['sha256']].get) for r in subset)
        return {'count': len(subset), 'topClassCounts': dict(top),
                'meanClassProbabilities': {
                    c: round(sum(predictions[r['sha256']][c] for r in subset) / len(subset), 5)
                    for c in CLASSES
                } if subset else {}}
    def rank_aucs(target):
        y = [int(target(r)) for r in rows]
        if min(y) == max(y):
            return {}
        return {c: round(float(roc_auc_score(
            y, [predictions[r['sha256']][c] for r in rows])), 4) for c in CLASSES}
    bdsm = contexts['bdsm_kink']
    bdsm_top = sum(max(predictions[r['sha256']], key=predictions[r['sha256']].get) == 'bdsm' for r in bdsm)
    other = [r for r in rows if r['sexualContext'] != 'bdsm_kink']
    other_bdsm_top = sum(max(predictions[r['sha256']], key=predictions[r['sha256']].get) == 'bdsm' for r in other)
    return {
        'status': 'development_only_not_independent_not_an_explicit_act_verdict',
        'modelId': MODEL_ID,
        'modelRevision': revision,
        'modelWeightSha256': FILE_SHA256,
        'modelClasses': list(CLASSES),
        'totalImages': len(rows),
        'sourceGroups': len({r['sourceGroup'] for r in rows}),
        'contextBreakdown': {name: summary(subset) for name, subset in contexts.items()},
        'artNudeNonExplicit': summary([
            r for r in rows if r['sexualContext'] != 'explicit_act' and r['nudity'] in NUDE]),
        'bdsmTopClass': {'detectedAsTop': bdsm_top, 'bdsmImages': len(bdsm),
                         'falseTopAmongOthers': other_bdsm_top, 'otherImages': len(other)},
        'exploratoryClassScoreAuc': {
            'bdsmKinkVsRest': rank_aucs(lambda r: r['sexualContext'] == 'bdsm_kink'),
            'explicitActVsRest': rank_aucs(lambda r: r['sexualContext'] == 'explicit_act')},
        'notes': [
            'No trained sexual_act class: scores labeled x/q/unnamed have no verified sex-act semantics.',
            'Do NOT treat unsafe, sexy, x or bdsm as proof of prohibited content.',
            'Unmodified pretrained RedDesert model, not trained on Artes examples.',
            'Scores are ranking diagnostics on reused development images only.',
            'Zero Artes images uploaded; cache contains private per-image scores.',
            'No auto-publication, rejection or runtime deployment authorized.'
        ],
    }


def main():
    parser = argparse.ArgumentParser(description='Safe local RedDesert contextual research comparison')
    parser.add_argument('--dataset', required=True)
    parser.add_argument('--work', required=True)
    args = parser.parse_args()
    data = Path(args.dataset)
    work = Path(args.work)
    if not work.is_dir() or not data.is_dir():
        raise ValueError('expected_existing_private_codespace_paths')
    rows = load_development_rows(data)
    if len(rows) != 375:
        raise ValueError('expected_375_existing_reviewed_development_photos')
    revision = read_revision()
    weights = download_verified_weight(work, revision)
    cache = work / 'reddesert-private-scores.jsonl'
    scores = score_local_images(rows, cache, weights)
    if len(scores) != len(rows):
        raise ValueError('incomplete_local_score_cache')
    report = aggregate(rows, scores, revision)
    output = work / 'reddesert-artes-aggregate.json'
    output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print('SHARE ONLY:', output)
    print('No Artes photos or individual predictions were uploaded.')


if __name__ == '__main__':
    main()
