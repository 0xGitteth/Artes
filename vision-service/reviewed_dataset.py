"""Read confirmed Artes labels without changing labels or the held-out split."""
import hashlib
import json
from collections import Counter
from pathlib import Path

LABEL_DEFINITION = 'artes_nudity_visible_pubic_region_v2_2026_10_06'
NUDITY_CLASSES = ('none', 'male_topless', 'underwear_swimwear', 'implied_nude',
                  'female_bare_breasts', 'bare_buttocks', 'genitalia')
CONTEXT_CLASSES = ('none', 'suggestive', 'bdsm_kink', 'explicit_act')
HEAD_CLASSES = {'nudity': NUDITY_CLASSES, 'sexualContext': CONTEXT_CLASSES}


def file_sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def confined_path(root, relative):
    if not isinstance(relative, str) or Path(relative).is_absolute():
        raise ValueError('invalid_relative_path')
    path = (root / relative).resolve(strict=True)
    if not path.is_relative_to(root):
        raise ValueError('path_outside_dataset')
    return path


def load_reviewed_dataset(dataset_path, split='train', verify_files=True, selection_path=None):
    if split not in ('train', 'test'):
        raise ValueError('invalid_split')
    path = Path(dataset_path).resolve(strict=True)
    root = path.parent
    dataset = json.loads(path.read_text())
    if (dataset.get('schemaVersion') != 4
            or dataset.get('labelDefinitionVersion') != LABEL_DEFINITION
            or dataset.get('humanLabelsAuthoritative') is not True):
        raise ValueError('unsupported_dataset_or_label_definition')
    omitted = set()
    if selection_path:
        selection = json.loads(Path(selection_path).read_text())
        if selection.get('datasetSha256') != file_sha256(path):
            raise ValueError('selection_dataset_mismatch')
        omitted = set(selection.get('omitFromTraining', []))
    rows, ids, hashes, assignments = [], set(), set(), {}
    excluded = 0
    for row in dataset['items']:
        cid = row.get('candidateId')
        if not cid or cid in ids:
            raise ValueError('missing_or_duplicate_candidate_id')
        ids.add(cid)
        if (row.get('labelStatus') == 'human_excluded'
                and row.get('includedInReviewedResearchDataset') is False):
            excluded += 1
            continue
        if (row.get('labelStatus') != 'human_confirmed'
                or row.get('humanLabelConfirmed') is not True
                or row.get('includedInReviewedResearchDataset') is not True
                or row.get('needsManualReview') is not False
                or not row.get('humanReviewConfirmedAt')
                or not row.get('humanReviewExportSha256')
                or row.get('labelDefinitionVersion') != LABEL_DEFINITION):
            raise ValueError(f'unconfirmed_label:{cid}')
        for head, classes in HEAD_CLASSES.items():
            if row.get(head) not in classes or row.get('detectorLabel', {}).get(head) != row[head]:
                raise ValueError(f'invalid_or_conflicting_label:{cid}:{head}')
        row_split = row.get('proposedSplit')
        if row_split not in ('train', 'test') or not row.get('sourcePoolId'):
            raise ValueError(f'missing_split_or_source_pool:{cid}')
        if not row.get('sha256') or row['sha256'] in hashes:
            raise ValueError(f'missing_or_duplicate_image_hash:{cid}')
        hashes.add(row['sha256'])
        if cid in omitted:
            if row_split != 'train':
                raise ValueError('selection_must_not_omit_heldout_image')
            continue
        # An overlap in any recorded maker/scene group fails, including an overlap
        # that would be missed by checking only sourcePoolId.
        for key in ('sourcePoolId', 'leakageGroupId', 'shootGroupId'):
            group = row.get(key)
            if group:
                earlier = assignments.setdefault((key, group), row_split)
                if earlier != row_split:
                    raise ValueError(f'heldout_group_leakage:{key}:{group}')
        if row_split == split:
            selected = dict(row)
            if verify_files:
                image = confined_path(root, row['localPath'])
                evidence = confined_path(root, row['finalSourceEvidencePath'])
                if file_sha256(image) != row['sha256']:
                    raise ValueError(f'image_hash_mismatch:{cid}')
                if file_sha256(evidence) != row['finalSourceEvidenceSha256']:
                    raise ValueError(f'source_evidence_hash_mismatch:{cid}')
                selected['absolutePath'] = str(image)
            rows.append(selected)
    if not omitted.issubset(ids):
        raise ValueError('selection_contains_unknown_candidate')
    return {
        'datasetSha256': file_sha256(path),
        'datasetVersion': dataset['datasetVersion'],
        'labelDefinitionVersion': LABEL_DEFINITION,
        'root': str(root), 'split': split, 'rows': rows,
        'excludedImages': excluded,
        'omittedFromTraining': sorted(omitted),
        'selectionSha256': file_sha256(selection_path) if selection_path else None,
        'heldoutGroupSeparationVerified': True,
    }


def assess_training_data(loaded):
    rows = loaded['rows']
    counts = {head: dict(Counter(row[head] for row in rows)) for head in HEAD_CLASSES}
    pools = Counter(row['sourcePoolId'] for row in rows)
    pools_by_class = {
        head: {label: len({r['sourcePoolId'] for r in rows if r[head] == label})
               for label in labels}
        for head, labels in HEAD_CLASSES.items()
    }
    largest = max(pools.values(), default=0) / max(len(rows), 1)
    probe = (len(rows) >= 140 and len(pools) >= 10 and largest <= .25
             and all(counts['nudity'].get(c, 0) >= 15 for c in NUDITY_CLASSES)
             and all(pools_by_class['nudity'][c] >= 3 for c in NUDITY_CLASSES))
    pilot = (len(rows) >= 280 and len(pools) >= 18 and largest <= .15
             and all(counts['nudity'].get(c, 0) >= 30 for c in NUDITY_CLASSES)
             and all(pools_by_class['nudity'][c] >= 4 for c in NUDITY_CLASSES))
    return {'split': loaded['split'], 'images': len(rows), 'counts': counts,
            'sourcePools': len(pools), 'sourcePoolsByClass': pools_by_class,
            'largestSourcePoolFraction': largest,
            'experimentalNudityCountGatePassed': probe,
            'preferredPilotCountGatePassed': pilot,
            'trainingUseClearedInOriginalDataset': sum(r.get('trainingReady') is True for r in rows),
            'runtimeEligible': False, 'productionEligible': False}


def validate_training_clearance(loaded, clearance_path, execution_scope='existing_workspace', purpose='training'):
    """A scoped use assessment is required; content review is not use clearance."""
    release = json.loads(Path(clearance_path).read_text())
    if (release.get('schemaVersion') != 1
            or release.get('scope') != 'offline_research_probe'
            or release.get('datasetSha256') != loaded['datasetSha256']
            or release.get('labelDefinitionVersion') != LABEL_DEFINITION
            or release.get('runtimeEligible') is not False
            or release.get('productionEligible') is not False
            or release.get('executionScope') != execution_scope
            or not release.get('assessmentEvidence')):
        raise ValueError('invalid_training_use_assessment')
    approvals = {}
    if purpose not in ('training', 'evaluation'):
        raise ValueError('invalid_use_assessment_purpose')
    permission_key = ('approvedForOfflineSupervisedTraining' if purpose == 'training'
                      else 'approvedForOfflineEvaluation')
    for item in release.get('items', []):
        if not item.get('candidateId') or item['candidateId'] in approvals:
            raise ValueError('invalid_or_duplicate_training_clearance')
        approvals[item['candidateId']] = item
    for row in loaded['rows']:
        approval = approvals.get(row['candidateId'], {})
        if (approval.get(permission_key) is not True
                or approval.get('sha256') != row['sha256']
                or approval.get('sourceEvidenceSha256') != row['finalSourceEvidenceSha256']
                or not approval.get('evidence')):
            raise ValueError(f'{purpose}_use_not_cleared:{row["candidateId"]}')
    return release
