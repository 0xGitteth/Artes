"""Run *frozen* Luke + RedDesert heads on a new, manually labeled Artes holdout.

All media, predictions, rights records and head coefficients remain in gitignored
Codespaces .tmp. Only aggregate statistics may be shared with ChatGPT.

The holdout must be sealed BEFORE model scoring and independent from 375 dev
images/sources. Scoring uses already-cached pinned, verified model weights,
without model downloads, remote code, provider API calls or training.
"""
import argparse
import hashlib
import json
import math
import os
from collections import Counter
from pathlib import Path

from prepare_independent_holdout import (
    inspect_candidates, validate_draft, sha_file,
)
from compare_three_nsfw import REV_LUKE, MODELS, safe_scores
from evaluate_reddesert_artes import (
    CLASSES as RED_LABELS, FILE_SHA256 as RED_SHA,
    FILE_BYTES as RED_BYTES, validate_probabilities,
    infer_publisher_layout, build_local_publisher_model,
)
from nsfw_shadow import MODEL_LABELS as LUKE_LABELS
from audit_fusion_readiness import wilson_lower

FROZEN_THRESHOLD = 0.25
MODELS_TO_EVALUATE = ('luke_scores', 'red_desert_scores', 'combined_scores')
TARGETS = ('explicit_act', 'bdsm_kink', 'suggestive')
NUDITY = frozenset(('implied_nude', 'bare_buttocks', 'female_bare_breasts', 'genitalia'))


def sealed_rows(holdout, development):
    path = holdout / 'holdout-sealed.json'
    if not path.is_file():
        raise ValueError('independent_holdout_not_sealed')
    payload = json.loads(path.read_text(encoding='utf-8'))
    expected = payload.pop('sealSha256', '')
    if payload.get('sealingStatus') != 'sealed_before_any_model_inference':
        raise ValueError('holdout_not_sealed_before_inference')
    canonical = json.dumps(payload, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
    if hashlib.sha256(canonical.encode()).hexdigest() != expected:
        raise ValueError('holdout_seal_content_changed')
    identified, development_groups, _ = inspect_candidates(holdout, development)
    summary = validate_draft(payload, identified, development_groups)
    return payload['images'], expected, summary


def frozen_heads(path, development):
    from evaluate_nsfw_development import load_development_rows
    if not path.is_file():
        raise ValueError('frozen_research_heads_not_present')
    item = json.loads(path.read_text(encoding='utf-8'))
    if (item.get('status') != 'research_only_private_not_approved_for_moderation'
        or item.get('automatedModerationAllowed') is not False
        or item.get('schemaVersion') != 1
        or item.get('sampleCount') != 375
        or item.get('sourceGroups') != 103):
        raise ValueError('unexpected_or_approved_private_head_artifact')
    original_rows = load_development_rows(development)
    fingerprint = hashlib.sha256(
        ''.join(sorted(r['sha256'] for r in original_rows)).encode()).hexdigest()
    if item.get('datasetSha256Fingerprint') != fingerprint:
        raise ValueError('frozen_heads_do_not_match_original_375_images')
    if set(item.get('models', {})) != set(MODELS_TO_EVALUATE):
        raise ValueError('unexpected_fusion_head_sets')
    for name in MODELS_TO_EVALUATE:
        if set(item['models'][name]) != set(TARGETS):
            raise ValueError('missing_frozen_classification_axis')
    return item


def predict_head(head, vector):
    if 'constant' in head:
        value = head['constant']
        if type(value) not in (float, int) or not 0 <= value <= 1:
            raise ValueError('invalid_constant_fusion_head')
        return float(value)
    mean, scale, coef = [head[k] for k in ('mean', 'scale', 'coefficients')]
    if head.get('decisionClasses') != [0, 1]:
        raise ValueError('unexpected_binary_head_label_order')
    if len(mean) != len(scale) or len(scale) != len(coef) or len(coef) != len(vector):
        raise ValueError('frozen_head_dimension_mismatch')
    if not all(math.isfinite(float(v)) for v in mean + scale + coef):
        raise ValueError('invalid_frozen_head_weights')
    if not all(float(s) > 0 for s in scale):
        raise ValueError('invalid_frozen_scaler')
    logit = float(head['intercept']) + sum(
        ((float(x) - float(m)) / float(s)) * float(c)
        for x, m, s, c in zip(vector, mean, scale, coef))
    if not math.isfinite(logit):
        raise ValueError('nonfinite_frozen_head_logit')
    if logit >= 0:
        return 1 / (1 + math.exp(-logit))
    z = math.exp(logit)
    return z / (1 + z)


def cache_records(path, rows, seal):
    expected = {r['sha256'] for r in rows}
    existing = {}
    if not path.exists():
        return existing
    for raw in path.read_text(encoding='utf-8').splitlines():
        if not raw.strip():
            continue
        record = json.loads(raw)
        key = record.get('sha256')
        if (key not in expected or key in existing or record.get('sealSha256') != seal
            or record.get('lukeRevision') != REV_LUKE
            or record.get('redDesertWeightsSha256') != RED_SHA):
            raise ValueError('untrusted_or_mixed_holdout_cache')
        luke = safe_scores(record.get('luke'))
        red = validate_probabilities(record.get('redDesert'))
        existing[key] = {'luke': luke, 'redDesert': red}
    return existing


def score_new_images(rows, holdout, work, seal):
    scorefile = holdout / 'holdout-private-scores.jsonl'
    existing = cache_records(scorefile, rows, seal)
    pending = [r for r in rows if r['sha256'] not in existing]
    if not pending:
        print('Every independent example already scored: no model reload.', flush=True)
        return existing

    # Cached artifacts only. Never download unknown model bytes during test.
    from PIL import Image
    import numpy as np
    import torch
    from transformers import AutoImageProcessor, AutoModelForImageClassification
    from safetensors.torch import load_file

    torch.set_num_threads(min(2, max(1, os.cpu_count() or 1)))
    weights = work / ('reddesert-' + RED_SHA[:16] + '.safetensors')
    if not weights.is_file() or weights.stat().st_size != RED_BYTES or sha_file(weights) != RED_SHA:
        raise ValueError('verified_existing_red_desert_weights_required_no_download')
    state = load_file(str(weights), device='cpu')
    layout = infer_publisher_layout(state.keys())
    red_model = build_local_publisher_model(layout, len(RED_LABELS))
    red_model.load_state_dict(state, strict=True)
    red_model.eval().to('cpu')
    del state

    luke_id = MODELS['luke'][0]
    proc = AutoImageProcessor.from_pretrained(
        luke_id, revision=REV_LUKE, use_fast=False, trust_remote_code=False,
        local_files_only=True,
    )
    luke = AutoModelForImageClassification.from_pretrained(
        luke_id, revision=REV_LUKE, use_safetensors=True,
        trust_remote_code=False, local_files_only=True,
    )
    id2label = {int(k): str(v).strip().lower() for k, v in luke.config.id2label.items()}
    if set(id2label.values()) != {'neutral', 'porn', 'hentai', 'drawings', 'sexy'}:
        raise ValueError('unexpected_cached_luke_label_set')
    luke.eval().to('cpu')

    mean = np.asarray((.485, .456, .406), dtype='float32').reshape(3, 1, 1)
    std = np.asarray((.229, .224, .225), dtype='float32').reshape(3, 1, 1)
    with scorefile.open('a', encoding='utf-8') as cache:
        for i, row in enumerate(pending, 1):
            image_path = holdout / row['imagePath']
            with Image.open(image_path) as original:
                rgb = original.convert('RGB')
                # Follow *exactly* the existing research preprocessing.
                red_im = rgb.resize((320, 320), Image.Resampling.BILINEAR)
                red_data = ((np.asarray(red_im, dtype='float32').transpose(2, 0, 1) / 255
                             - mean) / std).copy()
                luke_inputs = proc(images=rgb, return_tensors='pt')
            with torch.inference_mode():
                red_logits = red_model(torch.from_numpy(red_data).unsqueeze(0))[0]
                luke_logits = luke(**luke_inputs).logits[0]
            red_scores = validate_probabilities(
                torch.softmax(red_logits, dim=-1).tolist())
            luke_scores = {
                ('normal' if label == 'neutral' else
                 'drawing' if label == 'drawings' else label): float(prob)
                for label, prob in zip(id2label.values(),
                    torch.softmax(luke_logits, dim=-1).tolist())
            }
            luke_scores = safe_scores(luke_scores)
            record = {
                'sha256': row['sha256'], 'sealSha256': seal,
                'lukeRevision': REV_LUKE, 'redDesertWeightsSha256': RED_SHA,
                'luke': luke_scores, 'redDesert': red_scores,
            }
            cache.write(json.dumps(record, separators=(',', ':')) + '\n')
            cache.flush()
            existing[row['sha256']] = {'luke': luke_scores, 'redDesert': red_scores}
            if i % 25 == 0 or i == len(pending):
                print(f'Independent local inference: {i}/{len(pending)}', flush=True)
    return existing


def summarize(rows, predictions, head_artifact, seal):
    from sklearn.metrics import roc_auc_score, average_precision_score
    feature_maps = {
        'luke_scores': lambda pred: [pred['luke'][k] for k in LUKE_LABELS],
        'red_desert_scores': lambda pred: [pred['redDesert'][k] for k in RED_LABELS],
        'combined_scores': lambda pred: [pred['luke'][k] for k in LUKE_LABELS] +
                                        [pred['redDesert'][k] for k in RED_LABELS],
    }
    if len(predictions) != len(rows):
        raise ValueError('holdout_inference_incomplete')
    result = {
        'status': 'independent_artes_research_holdout_not_release_approval',
        'images': len(rows),
        'groups': len({r['sourceGroup'] for r in rows}),
        'humanLabels': dict(Counter(r['sexualContext'] for r in rows)),
        'explicitThresholdFrozenFromDevelopment': FROZEN_THRESHOLD,
        'sealValidated': True,
        'sourceIndependence': 'human_attested_and_exact_plus_perceptual_checked_against_375_dev',
        'modelComparisons': {},
        'approvedForAutomatedModeration': False,
        'notes': [
            'No classifier or threshold was refitted on these images.',
            'These are new relative to the Artes research set, not necessarily unseen during public base-model pretraining.',
            'Threshold 0.25 is a frozen research decision, not a production release threshold.',
            'Sexual-signal review flags are not the full Artes reviewCases routing result.',
            'This aggregate does not reveal images, image hashes, source IDs, or per-photo predictions.',
        ],
    }
    for model_name, features in feature_maps.items():
        outputs = {}
        for axis in TARGETS:
            y = [r['sexualContext'] == axis for r in rows]
            p = [predict_head(head_artifact['models'][model_name][axis],
                              features(predictions[r['sha256']])) for r in rows]
            summary = {
                'positive': sum(y), 'negative': len(rows) - sum(y),
                'auc': round(float(roc_auc_score(y, p)), 4) if 0 < sum(y) < len(y) else None,
                'averagePrecision': round(float(average_precision_score(y, p)), 4)
                if sum(y) else None,
            }
            if axis == 'explicit_act':
                flagged = [v >= FROZEN_THRESHOLD for v in p]
                tp = sum(a and b for a, b in zip(y, flagged))
                fp = sum(not a and b for a, b in zip(y, flagged))
                summary.update({
                    'detectedExplicit': tp,
                    'missedExplicit': sum(y) - tp,
                    'flaggedNonExplicit': fp,
                    'flaggedAllowedArtNudes': sum(
                        not y[i] and flagged[i] and r['nudity'] in NUDITY
                        for i, r in enumerate(rows)),
                    'potentialSexualReviewFlags': tp + fp,
                    'explicitRecall95WilsonLower': wilson_lower(tp, sum(y)),
                    'flaggedPrecision95WilsonLower': wilson_lower(tp, tp + fp),
                })
            outputs[axis] = summary
        result['modelComparisons'][model_name] = outputs
    return result


def run(holdout, development, work):
    rows, seal, _ = sealed_rows(holdout, development)
    heads = frozen_heads(work / 'luke-reddesert-fusion-private-heads.json', development)
    values = score_new_images(rows, holdout, work, seal)
    result = summarize(rows, values, heads, seal)
    output = holdout / 'holdout-independent-aggregate.json'
    output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print('SHARE ONLY:', output)
    print('No media uploaded, no API calls, no automatic moderation decisions.')


def main():
    parser = argparse.ArgumentParser(description='Frozen and offline Artes context fusion holdout')
    parser.add_argument('--holdout', required=True, type=Path)
    parser.add_argument('--development', required=True, type=Path)
    parser.add_argument('--work', required=True, type=Path)
    args = parser.parse_args()
    run(args.holdout.resolve(), args.development.resolve(), args.work.resolve())


if __name__ == '__main__':
    main()
