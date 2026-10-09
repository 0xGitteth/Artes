"""Side-by-side developmental test of exactly three existing NSFW model candidates.

Never treat a model's 'porn' score as a confirmed sexual act. No deployment.
No image leaves Codespaces; reports are aggregate; per-photo cache is private.
Historical test images are intentionally excluded. No training occurs.
"""
import argparse
import json
import math
import statistics
import time
from pathlib import Path

from evaluate_nsfw_development import load_development_rows
from nsfw_shadow import MODEL_LABELS
from sklearn.metrics import roc_auc_score, average_precision_score

REV_MINI = '7c914c1a94ac1a8d16af7982101756f5650b870a'
REV_LUKE = '852ab7f43d70bb4b9d7d62f42ffa446e85f11670'
REV_GANTMAN = 'nsfwjs@4.1.0/MobileNetV2'
MODELS = {
    'mini': ('viddexa/nsfw-detection-2-mini', REV_MINI, 'nsfw-private-development-scores.jsonl'),
    'luke': ('LukeJacob2023/nsfw-image-detector', REV_LUKE, 'nsfw-luke-private-scores.jsonl'),
    'gantman': ('nsfwjs/MobileNetV2 (GantMan model family)', REV_GANTMAN, 'nsfw-gantman-private-scores.jsonl'),
}
NUDE = {'implied_nude', 'bare_buttocks', 'female_bare_breasts', 'genitalia'}


def safe_scores(scores):
    if not isinstance(scores, dict) or set(scores) != set(MODEL_LABELS):
        raise ValueError('unexpected_model_classes')
    if any(type(v) not in (int, float) or not math.isfinite(v) or v < 0 or v > 1 for v in scores.values()):
        raise ValueError('invalid_model_scores')
    if abs(sum(scores.values()) - 1.0) > 0.005:
        raise ValueError('invalid_score_sum')
    return {k: float(v) for k, v in scores.items()}


def manifest(data_dir, output_dir):
    rows = load_development_rows(data_dir)
    dest = Path(output_dir) / 'nsfw-development-manifest.jsonl'
    dest.parent.mkdir(parents=True, exist_ok=True)
    with dest.open('w', encoding='utf-8') as file:
        for row in rows:
            file.write(json.dumps({
                'sha256': row['sha256'],
                'imagePath': str(row['resolvedPath']),
            }) + '\n')
    print('Private image manifest prepared in .tmp (not for sharing).')
    return rows


def cache_records(filename, rows, model_key):
    model_id, revision, _ = MODELS[model_key]
    dataset = {r['sha256']: r for r in rows}
    results = {}
    path = Path(filename)
    if not path.exists():
        return results
    with path.open(encoding='utf-8') as file:
        for line in file:
            if not line.strip():
                continue
            record = json.loads(line)
            sha = record.get('sha256')
            if sha not in dataset or sha in results:
                raise ValueError(f'invalid_duplicate_or_unknown_cache:{model_key}')
            if record.get('modelRevision') != revision:
                raise ValueError(f'incorrect_model_revision:{model_key}')
            # First candidate's old cache lacks modelId, but has same exact pinned revision.
            if 'modelId' in record and record['modelId'] != model_id:
                raise ValueError(f'wrong_model_identifier:{model_key}')
            for key in ('sourceGroup', 'sexualContext', 'nudity'):
                if key in record and record[key] != dataset[sha][key]:
                    raise ValueError(f'cache_human_label_mismatch:{model_key}')
            safe_scores(record.get('scores'))
            results[sha] = record
    return results


def run_luke(rows, output_dir, max_new=None):
    import torch
    from PIL import Image
    from transformers import AutoImageProcessor, AutoModelForImageClassification

    model_id, revision, filename = MODELS['luke']
    path = Path(output_dir) / filename
    cached = cache_records(path, rows, 'luke')
    pending = [row for row in rows if row['sha256'] not in cached]
    if max_new:
        pending = pending[:max_new]
    if not pending:
        print('LukeJacob: all required predictions already cached.', flush=True)
        return

    print(f'Loading {model_id} on CPU (weights about 343 MB; no paid service).', flush=True)
    processor = AutoImageProcessor.from_pretrained(model_id, revision=revision, use_fast=False, trust_remote_code=False)
    model = AutoModelForImageClassification.from_pretrained(
        model_id, revision=revision, use_safetensors=True, trust_remote_code=False)
    model.to('cpu').eval()
    id2label = {int(k): str(v).strip().lower() for k, v in model.config.id2label.items()}
    if set(id2label.values()) != {'drawings', 'hentai', 'neutral', 'porn', 'sexy'}:
        raise ValueError('unexpected_luke_model_labels')

    failures = 0
    successes = 0
    with path.open('a', encoding='utf-8') as output:
        for i, row in enumerate(pending, 1):
            start = time.perf_counter()
            start_cpu = time.process_time()
            try:
                with Image.open(row['resolvedPath']) as src:
                    img = src.convert('RGB')
                tensor = processor(images=img, return_tensors='pt')
                with torch.inference_mode():
                    logits = model(**tensor).logits[0]
                    probabilities = torch.softmax(logits, dim=-1).cpu().tolist()
                scores = {
                    ('normal' if id2label[j] == 'neutral' else 'drawing' if id2label[j] == 'drawings' else id2label[j]): float(value)
                    for j, value in enumerate(probabilities)
                }
                record = {
                    'sha256': row['sha256'], 'modelId': model_id, 'modelRevision': revision,
                    'scores': safe_scores(scores),
                    'wallSeconds': round(time.perf_counter() - start, 6),
                    'cpuSeconds': round(time.process_time() - start_cpu, 6),
                }
                output.write(json.dumps(record, separators=(',', ':')) + '\n')
                output.flush()
                successes += 1
            except Exception:
                failures += 1
                # Intentionally avoid logging private file paths or image contents.
                print(f'LukeJacob: image {i} could not be processed; rerunning later is safe.', flush=True)
            if i % 25 == 0 or i == len(pending):
                print(f'LukeJacob processed {i}/{len(pending)} newly attempted images.', flush=True)

    if successes == 0 and pending:
        raise RuntimeError('luke_model_smoke_failed_no_images_scored')
    if failures:
        print(f'LukeJacob incomplete; {failures} images can be retried.', flush=True)


def statistics_for_model(rows, cache, key):
    result = {
        'model': MODELS[key][0],
        'modelRevision': MODELS[key][1],
        'scored': len(cache),
        'expected': len(rows),
        'complete': len(cache) == len(rows),
        'notes': 'Pretrained porn score is not an explicit-act diagnosis; development data only.',
    }
    if not cache:
        return result
    joined = [(r, cache[r['sha256']]) for r in rows if r['sha256'] in cache]
    positives = [(r, p) for r, p in joined if r['sexualContext'] == 'explicit_act']
    negatives = [(r, p) for r, p in joined if r['sexualContext'] != 'explicit_act']
    nude_neg = [(r, p) for r, p in negatives if r['nudity'] in NUDE]
    flagged = lambda pairs: sum(p['scores']['porn'] >= 0.5 for _, p in pairs)
    result['descriptiveAtPornScore0_5'] = {
        'explicitCount': len(positives),
        'explicitFlagged': flagged(positives),
        'explicitMissed': len(positives) - flagged(positives),
        'nonExplicitCount': len(negatives),
        'nonExplicitFlagged': flagged(negatives),
        'nonExplicitNudityCount': len(nude_neg),
        'nonExplicitNudityFlagged': flagged(nude_neg),
    }
    if positives and negatives:
        truth = [r['sexualContext'] == 'explicit_act' for r, _ in joined]
        scores = [p['scores']['porn'] for _, p in joined]
        result['pornScoreRanking'] = {
            'auroc': round(float(roc_auc_score(truth, scores)), 4),
            'averagePrecision': round(float(average_precision_score(truth, scores)), 4),
        }
    if all('wallSeconds' in record for record in cache.values()):
        timings = sorted(record['wallSeconds'] for record in cache.values())
        result['meanInferenceWallMs'] = round(statistics.mean(timings) * 1000, 2)
        result['p95InferenceWallMs'] = round(timings[math.ceil(0.95 * len(timings))-1] * 1000, 2)
    if all('cpuSeconds' in record for record in cache.values()):
        result['cpuHoursPer1000ImagesEstimate'] = round(
            statistics.mean(r['cpuSeconds'] for r in cache.values()) * 1000 / 3600, 4)
    return result


def report(rows, output_dir):
    root = Path(output_dir)
    summaries = {}
    for key, (_, _, filename) in MODELS.items():
        cache = cache_records(root / filename, rows, key)
        summaries[key] = statistics_for_model(rows, cache, key)
    if not summaries['mini']['complete']:
        raise ValueError('mini_development_cache_incomplete')
    summary = {
        'status': 'development_comparison_only_not_a_release_decision',
        'expectedDevelopmentImages': len(rows),
        'developmentSourceGroups': len({r['sourceGroup'] for r in rows}),
        'historicalTestImagesUsed': 0,
        'models': summaries,
        'comparisonComplete': all(v['complete'] for v in summaries.values()),
        'notes': [
            'All 375 development images were already used in research; performance is not independently held-out.',
            'The 0.5 cutoff is descriptive only, not calibrated or suitable for auto rejection.',
            'Never choose a production threshold or start auto moderation from this report alone.',
            'A model with unavailable dependencies is not silently marked as evaluated.',
        ],
    }
    path = root / 'nsfw-three-way-summary.json'
    path.write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')
    print(f'Aggregate result: {path}', flush=True)
    for key, item in summaries.items():
        print(f'{key}: {item["scored"]}/{item["expected"]} images, '
              f'{item.get("descriptiveAtPornScore0_5", {})}', flush=True)
    return summary


def main():
    parser = argparse.ArgumentParser(description='Three preselected NSFW detectors: local, no deployment')
    parser.add_argument('action', choices=['prepare', 'luke', 'report'])
    parser.add_argument('--data-dir', required=True)
    parser.add_argument('--output-dir', required=True)
    parser.add_argument('--max-new', type=int)
    args = parser.parse_args()
    if args.max_new is not None and args.max_new < 1:
        parser.error('--max-new must be positive')
    rows = load_development_rows(args.data_dir)
    if args.action == 'prepare':
        manifest(args.data_dir, args.output_dir)
    elif args.action == 'luke':
        run_luke(rows, args.output_dir, args.max_new)
    else:
        report(rows, args.output_dir)


if __name__ == '__main__':
    main()
