# Contributor acquisition batch v1

Purpose: acquire real, modern Artes-like photography for the first supervised nudity head without lowering rights, adulthood, model-rights, source-pool or human-label requirements.

## Normal review batch floor

Do not ask a human reviewer to process an ordinary batch unless it contains at least:

- 5 new images; and
- 2 independent leakage-relevant source pools.

Single-image review is reserved for explicit technical smoke tests or unusual edge cases and must not be presented as meaningful class coverage.

Preferred acquisition batch: 8–12 images from at least 3 independent source pools.

## Current priority order

1. `implied_nude`
2. `male_topless`
3. additional independent pools for `bare_buttocks`, `female_bare_breasts`, `genitalia`, `underwear_swimwear`, and `none`

The first offline diagnostic probe still requires at least 15 human-labelled images and 3 independent source pools per nudity class. Acquisition alone never makes an item training-ready.

## What a useful contributor batch looks like

Prefer contemporary real photography that is visually representative of Artes, including editorial, portrait, boudoir, art-nude and non-explicit body-focused work.

Within a batch, deliberately vary:

- creator/photographer;
- recognizable subject/model;
- body type and gender presentation;
- skin tone;
- crop and camera distance;
- indoor/outdoor setting;
- lighting and photographic style;
- pose and amount/location of visible skin.

Do not solve a class deficit mostly by adding more frames from one shoot or one creator/model combination.

## Source pool rule

`sourcePoolId` is a conservative leakage grouping, not a marketing category.

Images should share a source pool when they are likely to let a model memorize the same creator, recognizable subject, session or strongly repeated visual setup. Do not artificially split the same recognizable person or near-identical session across source pools just to increase the pool count.

When uncertain, group more conservatively rather than less.

## Authorization required per image

Every image must have explicit local authorization covering:

- copyright holder permission for Artes moderation-model development and evaluation;
- confirmation that all recognizable people are adults;
- model/personality-rights permission for the stated moderation ML use when recognizable people are present;
- a stable `sourcePoolId`;
- a short human-readable authorization scope.

The existing contributor intake remains fail-closed and local-only. It does not infer labels or age and it never makes an image `trainingReady`.

## Suggested first contributor target

For the next meaningful review round, aim for at least:

- 3–5 `implied_nude` candidates from at least 2 source pools; and
- 3–5 `male_topless` candidates from at least 2 source pools.

These are acquisition targets only. Final detector labels are assigned by human review after the images are locally embedded.

## Exclusions

- synthetic/generated images for this pilot;
- images with unclear copyright ownership;
- recognizable people without confirmed adulthood and model/personality-rights permission;
- ordinary stock/social-platform images without explicit moderation-ML permission;
- one-source batches used to claim class diversity;
- DINOv2 neighbor similarity used as a label or semantic-cluster approval signal.
