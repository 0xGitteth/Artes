# Authorized Flickr research v1

Status: local research only. Not training-approved, not production-eligible, not runtime authority.

## Why this lane exists

The public logged-out Flickr route exposes Safe content only. That creates a systematic blind spot for the exact classes Artes currently under-represents, because Flickr classifies full-frontal nudity, genitalia and sexual acts as Restricted content.

This lane uses Flickr's official API with a normally authenticated adult Flickr account and read-only OAuth. It is not a login, age, paywall, geo or safety-control bypass.

## Research rules

- Use the official Flickr API and OAuth flow.
- Read permission only.
- Do not store Flickr passwords, browser cookies or session cookies.
- Consumer credentials and OAuth access tokens stay under `.tmp/moderation-flickr-oauth/` and are never committed.
- The first probe downloads metadata only, not image bytes.
- `safe_search=3` is a discovery setting, never a detector label.
- Restricted visibility does not prove any content class or age.
- Human visual screening remains authoritative.
- No item becomes `trainingReady`, `productionEligible` or runtime authority through this lane.
- Photographer rights/licence metadata remains provenance. API visibility is not a training or redistribution licence.

## Flickr API prerequisite

Flickr currently limits new API-key requests to Pro subscribers. If the research account is not Pro and has no existing API key, stop before purchasing anything. Re-evaluate whether another public-source route is preferable.

If requesting a key, describe the intended use accurately. Do not misrepresent commercial/non-commercial status to obtain a different key type.

Official start page: `https://www.flickr.com/services/apps/create/`

## Local setup

After obtaining an API key and secret, in the Codespace terminal:

```bash
export FLICKR_API_KEY='YOUR_KEY'
export FLICKR_API_SECRET='YOUR_SECRET'
node scripts/flickrAuthorizedResearchOAuth.js setup
unset FLICKR_API_KEY FLICKR_API_SECRET
```

The values are stored only in `.tmp/moderation-flickr-oauth/consumer.json` with local restrictive permissions.

Then authorize read-only access from the same Codespace:

```bash
node scripts/authorizeFlickrResearchInCodespace.js
```

The script starts a temporary callback server on port `53682`, prints a Flickr authorization URL and waits up to ten minutes. Open the authorization URL, approve read access and let Flickr redirect back to the Codespace callback. The resulting access token is stored locally and is not printed.

If automatic Codespace callback detection is unavailable, set an explicit HTTPS callback ending in `/flickr/callback` with `FLICKR_OAUTH_CALLBACK` before starting the authorizer.

## First proof

Run:

```bash
bash vision-service/run_authorized_flickr_restricted_probe_v1.sh
```

The proof compares:

- authenticated `safe_search=1` visibility for the erosunfoto account;
- authenticated `safe_search=3` visibility for the same account;
- authenticated `flickr.photosets.getPhotos` counts for the known `nude / self-arousal` and `nude / erotic` photosets.

Output:

`.tmp/moderation-research-discovery/authorized-flickr-v1/restricted-visibility-probe.json`

No image bytes are downloaded by this proof.

## Promotion decision

Only build a Restricted image-preview fetcher if this proof demonstrates materially broader visibility than the existing logged-out public route. If it does not, keep the current public Flickr/portfolio/Commons strategy and do not add OAuth complexity to the image pipeline.
