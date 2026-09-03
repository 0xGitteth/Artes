# Artes custom moderation vision service

Staging/local proof of concept only. This service is not a moderation policy engine and must not be deployed to production from this branch.

## Current output

`POST /v1/infer` accepts a JPEG, PNG, or WebP image as base64 and returns:

- provider: `artes_custom_vision`
- model: `dinov2_vitb14`
- a normalized 768-dimensional DINOv2 embedding
- `detectorResult: null`

The detector is intentionally absent until Artes has a curated labeled dataset and a trained detector artifact. The service never returns `finalOutcome`, `policyDecision`, or `accessLevel`.

## Local POC

Create an isolated Python environment, install `requirements.txt`, and start:

```bash
uvicorn app:app --host 127.0.0.1 --port 8787
```

Run that command from the `vision-service` directory.

The first inference downloads the configured DINOv2 model (`facebook/dinov2-base` by default), so it can take noticeably longer and consume local disk/cache space. Do not start that download merely to run the JavaScript contract tests.

## Privacy boundary

Images are decoded in memory for inference. This service does not intentionally write uploaded image bytes to disk or a training store. Training retention is a separate, explicit Artes data decision.

## Promotion boundary

A later staging integration may call this service only after:

1. an authorized image test set exists;
2. embedding output passes the Artes provider contract;
3. detector labels are separately curated;
4. any detector artifact is benchmarked against the frozen golden set;
5. runtime and infrastructure costs are explicitly reviewed before hosted deployment.
