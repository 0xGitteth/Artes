"""Discover NEW photo-source candidates for Artes without fetching or labeling images.

This is discovery only, never an approved data set or human-labeled holdout.
Only public Openverse metadata for ORIGINAL Flickr photographs with an
indicative CC0 or CC BY license is considered. Original source and consent
still need individual verification, particularly for adults/art nudes.

No image binaries, private Artes data, embeddings, hashes, or labels uploaded.
Candidate metadata stays under gitignored .tmp in Codespaces.
"""
import argparse
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

BASE = 'https://api.openverse.org/v1/images/'
VERSION = 1
MAX_PER_CREATOR = 3
MAX_TOTAL = 240
PAGE_SIZE = 40
ALLOW_LICENSES = {'by', 'cc0'}
ALLOW_SOURCES = {'flickr'}
EXCLUDE_KEYWORDS = frozenset((
    'painting', 'illustration', 'watercolor', 'watercolour', 'drawing',
    'sculpture', 'engraving', 'lithograph', 'museum', 'statue', 'plaster',
    'antique', 'retro illustration', 'public domain illustration',
    'old master', 'oil on canvas', '18th century', '19th century',
    'poster', 'stock photo', 'clipart', 'cartoon', 'manga',
    'virtual world', 'second life', 'secondlife', '3d render',
    'rendered', 'cgi', 'synthetic', 'midjourney', 'stable diffusion',
    'ai generated', 'ai-generated', 'generative ai', 'rawpixel',
    'wallpaper', 'teenager', 'schoolgirl', 'schoolboy', 'underage',
    'preteen', 'pre-teen', 'child', 'children', 'minor', 'lolita',
))
QUERIES = {
    'editorial_fashion': (
        'fashion editorial portrait', 'editorial fashion photography',
        'fashion portrait photography',
    ),
    'portrait_diversity': (
        'studio portrait photography', 'male portrait photography',
        'portrait natural light',
    ),
    'swimwear_lingerie': (
        'swimwear editorial photo', 'lingerie portrait photography',
        'boudoir photography',
    ),
    'implied_art_nude': (
        'implied nude photography', 'fine art nude photography',
        'nude portrait fine art photography',
    ),
    'male_nude_body': (
        'male fine art nude photography', 'male topless studio photography',
        'bodyscape body photography',
    ),
    'bdsm_kink_nonexplicit': (
        'shibari rope bondage', 'fetish fashion portrait',
        'BDSM fine art photography',
    ),
    'couples_suggestive': (
        'romantic couples artistic nude photography',
        'sensual couples photography',
    ),
    'explicit_act': (
        'explicit sexual intercourse photography',
        'adult sexual act photographs',
    ),
    'ordinary_non_sensitive': (
        'street portrait photography', 'studio headshot adult',
    ),
}


def request_json(url, opener=urllib.request.urlopen, retries=2, pause=time.sleep):
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(
                url, headers={'User-Agent': 'Artes-private-research-intake/1.0'})
            with opener(req, timeout=35) as response:
                if response.status != 200:
                    raise ValueError('unexpected_openverse_status')
                raw = response.read(5 * 1024 * 1024 + 1)
            if len(raw) > 5 * 1024 * 1024:
                raise ValueError('oversized_openverse_response')
            result = json.loads(raw)
            if not isinstance(result, dict) or not isinstance(result.get('results'), list):
                raise ValueError('invalid_openverse_schema')
            return result
        except urllib.error.HTTPError as exc:
            if exc.code != 429 or attempt == retries:
                raise
            delay = min(35, max(5, int(exc.headers.get('Retry-After', '5'))))
            pause(delay)
    raise ValueError('openverse_request_retry_exhausted')


def validate_original_url(link, allowed_hosts):
    if not isinstance(link, str) or len(link) > 1000:
        return False
    parts = urlparse(link)
    return parts.scheme == 'https' and parts.hostname in allowed_hosts and not parts.username


def candidate_from_result(item, scene, query):
    """Filter metadata; NEVER imply the content, subject age, and rights were verified."""
    if not isinstance(item, dict):
        return None
    license_name = str(item.get('license') or '').lower().strip()
    source = str(item.get('source') or '').lower().strip()
    original = item.get('foreign_landing_url')
    file_url = item.get('url')
    if license_name not in ALLOW_LICENSES or source not in ALLOW_SOURCES:
        return None
    if item.get('category') != 'photograph':
        return None
    if not validate_original_url(original, {'www.flickr.com', 'flickr.com'}):
        return None
    if not validate_original_url(file_url, {'live.staticflickr.com', 'farm.staticflickr.com'}):
        return None
    if not re.fullmatch(r'[0-9a-f-]{36}', str(item.get('id') or '')):
        return None
    owner = str(item.get('creator') or '').strip()
    owner_url = item.get('creator_url') or ''
    if not owner or not validate_original_url(owner_url, {'www.flickr.com', 'flickr.com'}):
        return None
    description = ' '.join([
        str(item.get('title') or ''),
        owner,
        ' '.join(str(tag.get('name') or '') for tag in (item.get('tags') or []) if isinstance(tag, dict))
    ]).lower()
    if any(re.search(r'\b' + re.escape(bad) + r'\b', description) for bad in EXCLUDE_KEYWORDS):
        return None
    w, h = item.get('width'), item.get('height')
    if type(w) is not int or type(h) is not int or min(w, h) < 400:
        return None
    return {
        'candidateId': item['id'],
        'sceneHintNotHumanLabel': scene,
        'discoveryQuery': query,
        'title': str(item.get('title') or '')[:220],
        'creator': owner[:160],
        'creatorUrl': owner_url,
        'originalSourceUrl': original,
        'indicativePhotoUrlNotDownloaded': file_url,
        'indicativeLicense': license_name,
        'indicativeLicenseVersion': item.get('license_version'),
        'indicativeLicenseUrl': item.get('license_url'),
        'source': source,
        'width': w, 'height': h,
        'providerMatureFlag': bool(item.get('mature')),
        'status': 'candidate_only_original_rights_and_adulthood_not_verified',
        'independentResearchHoldoutEligible': False,
        'canDownloadOrTrain': False,
    }


def discover(fetch=request_json, max_total=MAX_TOTAL):
    if max_total < 1:
        raise ValueError('invalid_discovery_limit')
    by_id, per_creator, per_scene = {}, Counter(), Counter()
    results = []
    checks = []
    for scene, queries in QUERIES.items():
        for query in queries:
            if len(results) >= max_total:
                break
            url = BASE + '?' + urllib.parse.urlencode({
                'q': query, 'source': 'flickr',
                'license': 'by,cc0', 'category': 'photograph',
                'mature': 'true', 'page_size': str(PAGE_SIZE), 'page': '1',
            })
            try:
                response = fetch(url)
                count = int(response.get('result_count', 0))
                retrieved = response['results']
            except Exception as exc:
                # No silent success on failed source fetching; preserve only type.
                checks.append({'scene': scene, 'query': query,
                               'status': 'error', 'reasonType': type(exc).__name__})
                continue
            added = 0
            for raw in retrieved:
                candidate = candidate_from_result(raw, scene, query)
                if candidate is None:
                    continue
                key = candidate['originalSourceUrl']
                owner = candidate['creatorUrl'].lower().rstrip('/')
                if key in by_id or per_creator[owner] >= MAX_PER_CREATOR:
                    continue
                by_id[key] = candidate
                per_creator[owner] += 1
                per_scene[scene] += 1
                results.append(candidate)
                added += 1
                if len(results) >= max_total:
                    break
            checks.append({'scene': scene, 'query': query,
                           'status': 'searched', 'reportedResults': count,
                           'metadataCandidatesAdded': added})
    report = {
        'status': 'discovery_only_no_images_downloaded_no_approved_rights',
        'retrievedCandidateMetadata': len(results),
        'perSceneHintNotLabels': dict(per_scene),
        'uniqueCreators': len(per_creator),
        'sourceQueries': checks,
        'copyrightAgeAndImageReleaseVerified': False,
        'notes': [
            'These are discovery hints only, NOT labeled or approved media.',
            'Indicative CC0/CC BY photo copyright metadata does not verify rights of depicted persons.',
            'No one may train/deploy on these candidates without source, consent and adult age verification.',
            'Exclude all AI/synthetic content, minors, historical art, mirrors and irrelevant media on visual review.',
            'The sexually explicit query may yield few or zero rights-cleared results; never fake coverage.',
            'Do not use these candidates to tune frozen independent test metrics.',
        ],
    }
    return results, report


def main():
    parser = argparse.ArgumentParser(description='Local metadata-only Artes photo candidate discovery')
    parser.add_argument('--work', type=Path, required=True)
    parser.add_argument('--limit', type=int, default=MAX_TOTAL)
    args = parser.parse_args()
    work = args.work.resolve()
    if work != Path('/workspaces/Artes/.tmp/moderation-independent-discovery').resolve():
        raise ValueError('must_write_to_private_gitignored_research_directory')
    work.mkdir(parents=True, exist_ok=True)
    results, report = discover(max_total=args.limit)
    # Private source URLs stay local: no public GitHub commit of candidate inventory.
    (work / 'photo-discovery-candidates-private.json').write_text(
        json.dumps({'schemaVersion': VERSION, 'candidates': results}, indent=2) + '\n',
        encoding='utf-8')
    (work / 'photo-discovery-aggregate.json').write_text(
        json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print('Metadata candidates only:', len(results))
    print('Discovery categories:', dict(report['perSceneHintNotLabels']))
    print('Share ONLY:', work / 'photo-discovery-aggregate.json')
    print('No images, rights, labels, weights, datasets, or individual URLs uploaded.')


if __name__ == '__main__':
    main()
