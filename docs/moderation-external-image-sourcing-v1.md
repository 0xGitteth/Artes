# Artes external moderation image sourcing v1

Status: POC sourcing policy for the custom moderation vision project. This document does not authorize production training, production deployment, or copying arbitrary public images into a durable Artes dataset.

## Goal

Build a small, modern, rights-aware external POC set that resembles the photography Artes is expected to receive. Prefer contemporary editorial, fashion, boudoir, lingerie, implied nude, art nude, male topless, and non-explicit kink/BDSM photography over archival, encyclopedic, or historically representative imagery.

External images are discovery/evaluation material first. They become training material only after the rights, adult-status, provenance, and curation gates below are satisfied.

## Source policy

### Excluded for Artes ML sourcing

- Pexels: current Terms/Help explicitly prohibit using the API/content collection for unauthorized machine-learning dataset/model development. Do not source Artes detector training or evaluation images from Pexels without explicit Pexels permission.
- Unsplash: current API/help guidance explicitly restricts using Unsplash images for machine-learning/artificial-intelligence purposes. Do not source Artes detector training or evaluation images from Unsplash without explicit permission.

### Discovery-only sources

- Openverse may be used to discover Creative Commons/public-domain works.
- Openverse metadata is not sufficient proof by itself; verify every candidate against the original landing page/license before use.
- Flickr search/tag pages may be used for discovery, but a generic “Some rights reserved” badge is not enough to approve a work.

### Preferred rights states

Prefer, in order:

1. direct contributor/photographer/model permission for Artes moderation R&D;
2. CC0 / an unambiguous public-domain dedication by the copyright holder;
3. Creative Commons Attribution where the exact license and creator are verifiable.

For this POC, skip NC, ND, SA, unclear custom licenses, and generic “Creative Commons” statements until their implications have been reviewed. This keeps the first dataset simple and auditable.

## Human-subject gate

Copyright permission alone is not enough for recognizable living people.

Before an external image can be processed as an approved POC item, record:

- creator/source provenance;
- exact copyright/license state;
- why the depicted person is reasonably verified as an adult;
- model/personality-rights evidence where available;
- whether creator and depicted person are the same person;
- whether the image is approved only for local POC evaluation or also for detector training.

If adult status is uncertain, exclude the image. Do not infer age from appearance alone for training approval.

## Visual-quality gate

Reject an otherwise legal candidate when it is not representative enough for Artes, including:

- obviously archival or dated imagery unless deliberately used as a negative/domain-shift example;
- low-resolution scans;
- stock imagery with unnatural posing that does not resemble creative portfolio work;
- AI-generated or materially generative-AI-edited images;
- images dominated by text, watermarks, collages, screenshots, or virtual/3D avatars;
- duplicate or near-duplicate frames unless a controlled similarity test specifically needs them.

## Data-use classes

- `external_candidate`: discovered but not yet rights/adult verified.
- `external_authorized_poc`: verified enough for local embedding/evaluation; not automatically approved for training.
- `external_training_approved`: explicit rights/adult/provenance gate passed and manually approved for detector training.
- `contributor_authorized`: supplied directly by an Artes contributor/creator with explicit R&D permission.
- `golden_benchmark`: separately frozen benchmark material; never silently reused for training.

## Current sourcing direction

The first external set should contain multiple photographers/sources and deliberately cover:

- clothed portrait/editorial;
- fashion/studio and fashion/location;
- underwear/swimwear;
- boudoir/lingerie;
- implied nude;
- bare buttocks;
- female bare breasts / art nude;
- male topless;
- non-explicit BDSM/kink visual signals;
- neutral controls with skin exposure that should not be treated as adult content.

Do not add explicit sexual acts to the first external POC batch. Those require a separate rights and safety review.

## Promotion rule

A candidate registry entry must remain non-training until all required fields are verified. Search-engine snippets, category pages, or vague reuse statements are never sufficient by themselves to promote an item to `external_training_approved`.
