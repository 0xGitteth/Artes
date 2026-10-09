"""Search Openverse's MULTIPLE public source catalogs for photo metadata only.

No image download, no model inference and no approved training labels. Source
links, indicative licenses, creator clues and query diagnostics stay in .tmp.
An empty result is reported as a possible network/filter issue, NOT success.
"""
import argparse
import ipaddress
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

API = "https://api.openverse.org/v1/images/"
CATEGORIES = {
    "editorial_fashion": ("fashion portrait", "editorial fashion photography"),
    "portrait_general": ("studio portrait", "portrait photography"),
    "boudoir_suggestive": ("boudoir photography", "lingerie portrait"),
    "art_nude": ("fine art nude photography", "artistic nude portrait"),
    "male_body": ("male nude photography", "male body portrait"),
    "bdsm_nonexplicit": ("shibari fine art photography", "rope bondage photography"),
    "couples": ("sensual couple portrait", "intimate couples photograph"),
    "explicit_act": ("adult sexual act photographs", "explicit adult couples photography"),
}
BLOCK = ("painting", "sculpture", "drawing", "illustration", "museum",
         "oil on canvas", "lithograph", "rawpixel", "public domain illustrations",
         "vintage engraving", "ai-generated", "generated with ai",
         "midjourney", "stable diffusion", "computer generated",
         "child", "children", "teenager", "schoolgirl", "schoolboy",
         "underage", "preteen")
LICENSES = {"cc0", "by"}
LIMIT_PER_CREATOR = 3
LIMIT_PER_SOURCE = 30
LIMIT_WIKIMEDIA = 6


def public_https(raw):
    if not isinstance(raw, str) or len(raw) > 1300:
        return False
    url = urllib.parse.urlparse(raw)
    if url.scheme != "https" or not url.hostname or url.username or url.password:
        return False
    if url.hostname in {"localhost", "localhost.localdomain"} or url.hostname.endswith(".local"):
        return False
    try:
        ip = ipaddress.ip_address(url.hostname)
        return ip.is_global
    except ValueError:
        return "." in url.hostname


def validate_candidate(item, scene, query):
    if not isinstance(item, dict):
        return None, "invalid_record"
    if str(item.get("license", "")).lower() not in LICENSES:
        return None, "license_outside_cc0_by"
    if item.get("category") != "photograph":
        return None, "not_photograph"
    original = item.get("foreign_landing_url")
    if not public_https(original):
        return None, "invalid_original_link"
    # Never fetch the image URL; it is deliberately excluded from shareable output.
    if not public_https(item.get("url")):
        return None, "invalid_image_metadata"
    source = str(item.get("source") or "").lower()
    if not re.fullmatch(r"[a-z0-9_]{2,64}", source):
        return None, "unrecognized_source"
    creator = str(item.get("creator") or "").strip()[:140]
    if not creator:
        return None, "no_identified_creator"
    title = str(item.get("title") or "")[:220]
    tags = item.get("tags")
    tags = tags if isinstance(tags, list) else []
    searchtext = " ".join(
        [title, creator] + [str(tag.get("name") or "") for tag in tags
                            if isinstance(tag, dict)]).lower()
    if any(re.search(r"\b" + re.escape(term) + r"\b", searchtext) for term in BLOCK):
        return None, "obvious_unsuitable_or_age_ambiguity"
    width, height = item.get("width"), item.get("height")
    if type(width) is not int or type(height) is not int or min(width, height) < 350:
        return None, "insufficient_dimensions"
    return {
        "source": source,
        "sceneHintNotLabel": scene,
        "query": query,
        "title": title,
        "creator": creator,
        "originalSourceUrl": original,
        "indicativeLicense": str(item["license"]).lower(),
        "status": "unverified_public_metadata_only",
        "approvedForHoldoutOrTraining": False,
    }, "accepted_metadata"


def fetch_json(url, opener=urllib.request.urlopen, sleep=time.sleep):
    for attempt in range(3):
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "Artes-moderation-research/2.0"})
            with opener(req, timeout=25) as response:
                if response.status != 200:
                    raise ValueError("unexpected_http_response")
                body = response.read(3 * 1024 * 1024 + 1)
            if len(body) > 3 * 1024 * 1024:
                raise ValueError("response_too_large")
            data = json.loads(body)
            if not isinstance(data, dict) or not isinstance(data.get("results"), list):
                raise ValueError("invalid_api_response")
            return data
        except urllib.error.HTTPError as error:
            if error.code != 429 or attempt == 2:
                raise
            sleep(min(15, max(2, int(error.headers.get("Retry-After") or "3"))))
    raise RuntimeError("retries_exhausted")


def search(fetch=fetch_json, limit=180):
    if not (1 <= limit <= 500):
        raise ValueError("invalid_search_limit")
    accepted, seen = [], set()
    artists, sources, scenes, dropped = Counter(), Counter(), Counter(), Counter()
    diagnostics = []
    failures = 0
    for scene, queries in CATEGORIES.items():
        for query in queries:
            if len(accepted) >= limit:
                break
            url = API + "?" + urllib.parse.urlencode({
                "q": query, "license": "by,cc0", "category": "photograph",
                "mature": "true", "page_size": "20", "page": "1",
                # No source restriction: Openverse indexes independent providers.
            })
            try:
                response = fetch(url)
                raw_results = response["results"]
                api_total = int(response.get("result_count") or 0)
            except Exception as error:
                failures += 1
                status = getattr(error, "code", None)
                diagnostics.append({
                    "scene": scene, "query": query, "status": "fetch_error",
                    "errorType": type(error).__name__,
                    "httpStatus": status if type(status) is int else None,
                })
                continue
            added = 0
            for item in raw_results:
                cand, reason = validate_candidate(item, scene, query)
                if cand is None:
                    dropped[reason] += 1
                    continue
                key = cand["originalSourceUrl"].split("#")[0]
                artist_key = (cand["source"], cand["creator"].casefold())
                cap = LIMIT_WIKIMEDIA if cand["source"] == "wikimedia" else LIMIT_PER_SOURCE
                if key in seen:
                    dropped["duplicate_url"] += 1
                elif artists[artist_key] >= LIMIT_PER_CREATOR:
                    dropped["creator_limit"] += 1
                elif sources[cand["source"]] >= cap:
                    dropped["source_limit"] += 1
                else:
                    seen.add(key)
                    artists[artist_key] += 1
                    sources[cand["source"]] += 1
                    scenes[scene] += 1
                    accepted.append(cand)
                    added += 1
                if len(accepted) >= limit:
                    break
            diagnostics.append({
                "scene": scene, "query": query, "status": "ok",
                "apiReportedResults": api_total,
                "recordsReturned": len(raw_results),
                "metadataAccepted": added,
            })
    result = {
        "status": ("metadata_candidates_found" if accepted
                   else "no_candidates_diagnose_errors_or_filters"),
        "candidates": len(accepted),
        "sources": dict(sources),
        "sceneHintsNotVerifiedLabels": dict(scenes),
        "rejectedMetadata": dict(dropped),
        "failedQueries": failures,
        "queries": diagnostics,
        "sourceAccessAndUsageRightsConfirmed": False,
        "imagesDownloaded": 0,
        "notes": [
            "Search is deliberately not Flickr-only; public results can include other providers.",
            "This searches Openverse's index; external professional photo libraries are a separate rights-negotiation channel.",
            "Openverse source/license metadata is not proof of adult age, model release, photo rights, or ML-training consent.",
            "No candidates may be added to an independent holdout without source-by-source checks and pre-inference human labels.",
            "Query results alone are not proof that an image actually depicts the searched scene.",
        ],
    }
    return accepted, result


def main():
    parser = argparse.ArgumentParser(description="Source-neutral public photo metadata discovery")
    parser.add_argument("--work", type=Path, required=True)
    parser.add_argument("--limit", type=int, default=180)
    args = parser.parse_args()
    root = args.work.resolve()
    if root != Path("/workspaces/Artes/.tmp/moderation-independent-discovery").resolve():
        raise ValueError("must_use_gitignored_private_research_workdir")
    root.mkdir(parents=True, exist_ok=True)
    candidates, report = search(limit=args.limit)
    (root / "photo-discovery-public-review-links.json").write_text(
        json.dumps({"schemaVersion": 2, "links": candidates}, indent=2,
                   ensure_ascii=False) + "\n", encoding="utf-8")
    (root / "photo-discovery-aggregate.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    for check in report["queries"]:
        if check["status"] == "fetch_error":
            print("BRONFOUT:", check["scene"], check["query"],
                  check["errorType"], check["httpStatus"])
    print("PUBLIEKE KANDIDATEN:", report["candidates"])
    print("BRONNEN:", report["sources"])
    print("FILTERREDENEN:", report["rejectedMetadata"])
    print("FOUTIEVE OPVRAGINGEN:", report["failedQueries"])
    print("Deel bronlinks voor mijn verdere selectie:",
          root / "photo-discovery-public-review-links.json")
    if not candidates:
        print("Geen bruikbare metadata. Deel ook:", root / "photo-discovery-aggregate.json")


if __name__ == "__main__":
    main()
