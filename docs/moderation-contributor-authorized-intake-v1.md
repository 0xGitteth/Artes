# Contributor-authorized moderation image intake v1

Purpose: provide a local, fail-closed route for real Artes-like moderation images when public rights-cleared sourcing is insufficient.

This intake is for detector research and dataset curation. It does not make any image training-ready by itself and it never uploads media to Firebase, Google Cloud, GitHub, or another service.

## Required authorization per image

Every image must have an entry in a local `authorization.json` file with:

- `fileName`: exact local image filename.
- `sourcePoolId`: stable identifier for the same creator/model/session or other leakage-relevant source pool.
- `rightsHolderConfirmed: true`: the contributor confirms they own the relevant copyright or have permission from the rights holder for the stated ML use.
- `moderationMlUseAuthorized: true`: permission explicitly covers Artes moderation-model development, evaluation, and related derived numeric features.
- `recognizablePeople`: `none` or `present`.
- `allRecognizablePeopleAdultsConfirmed: true` when recognizable people are present.
- `modelPersonalityRightsConfirmed: true` when recognizable people are present.
- `authorizationScope`: short human-readable description of who authorized the image and for what use.

The script fails closed if any required authorization is absent. It does not infer age, copyright, consent, or model rights from image content.

## Local folders

Default image folder:

`.tmp/moderation-contributor-images`

Place supported JPEG, PNG, or WebP files directly in that folder. The intake intentionally does not recurse into subfolders.

Place `authorization.json` in the same folder. Example:

```json
{
  "schemaVersion": 1,
  "items": [
    {
      "fileName": "example.webp",
      "sourcePoolId": "creator-model-session-001",
      "rightsHolderConfirmed": true,
      "moderationMlUseAuthorized": true,
      "recognizablePeople": "present",
      "allRecognizablePeopleAdultsConfirmed": true,
      "modelPersonalityRightsConfirmed": true,
      "authorizationScope": "Photographer and adult model authorized Artes moderation ML research and evaluation."
    }
  ]
}
```

## Safety properties

- Explicit `--confirm-authorized` flag required.
- Local `.tmp` paths only.
- No network access.
- No child processes.
- Supported image extensions only.
- Bounded maximum file size.
- SHA-256 calculated locally for identity/provenance.
- `sourcePoolId` required up front for leakage control.
- No detector label is inferred from the filename, authorization metadata, captions, or source category.
- `trainingReady` remains `false`.
- Human detector labeling remains a separate step.

## Promotion

A contributor-authorized item can only move beyond intake after image-level human detector labeling, source-pool-aware leakage grouping, semantic-cluster review/approval, durable training-asset approval, and benchmark separation. DINOv2 neighbor proximity is never sufficient to promote a semantic cluster.