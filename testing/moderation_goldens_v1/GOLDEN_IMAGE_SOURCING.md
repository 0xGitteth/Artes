# Moderation golden image sourcing

This file is intentionally on the temporary expansion branch until the enlarged real-image gate is validated.

## Storage rule

Do not add newly sourced sensitive or adult images to the public Git repository unless Artes clearly has permission to redistribute them publicly. Prefer a private `artes-staging` Cloud Storage fixture bucket for the expanded set. Existing committed goldens remain unchanged.

## Batch A — creator/portfolio boundaries

These are the first images to source because they validate the highest-risk false-positive boundaries for an Artes-style creative platform.

1. `GENERAL_PORTRAIT_01` — ordinary portrait/fashion, no sensitive or adult context.
2. `MALE_TOPLESS_GENERAL_01` — adult male bare chest, ordinary portrait/editorial, non-erotic.
3. `SWIMWEAR_GENERAL_01` — ordinary swimwear, intimate areas covered, non-erotic.
4. `BOUDOIR_COVERED_02` — ordinary lingerie/boudoir, intimate areas covered, not clearly erotic.
5. `THONG_STRING_GENERAL_01` — thong/string/lingerie with intimate areas covered, non-erotic context.
6. `EROTIC_CLOTHED_ADULT_01` — fully covered/clothed but clearly erotic or sexually suggestive; no nudity or sex act.
7. `IMPLIED_NUDE_ADULT_01` — clearly implied nudity via crop/pose/hands/object/fabric, no sex act.
8. `BARE_BUTTOCKS_ADULT_01` — bare adult buttocks, no sex act.
9. `ART_NUDE_ADULT_01` — non-explicit artistic nude, preferably with an unambiguous nudity boundary such as visible adult breast/nipple, no sex act.

Existing fixtures already cover covered BDSM/kink, visible genitalia without a sex act, and a clear explicit sexual act.

## Batch B — nonsexual sensitive boundaries

Source after Batch A is stable:

- minor blood that should stay general;
- warning-worthy non-extreme wound;
- non-extreme convincing SFX wound;
- posed/editorial weapon without victim;
- direct interpersonal violence/threat with victim but without extreme gore;
- harmless horror costume/theme;
- genuinely disturbing but non-extreme horror/SFX.

## Batch C — confidence expansion

Only after the release gate is stable:

- healed scars without self-harm context;
- self-harm recovery/awareness;
- ordinary substance use versus serious substance distress;
- eating-disorder false-positive boundary versus explicit recovery/awareness;
- documentary childbirth;
- exceptionally graphic gore threshold.

## Selection requirements

- The depicted people must be adults for all adult/erotic/nude fixtures.
- Prefer real photography over AI-generated images for the release gate because the product moderates real creative work.
- Choose visually clear examples rather than ambiguous composites.
- Do not intentionally include minors in erotic/nude fixtures.
- Avoid embedding personal metadata where possible; strip EXIF before fixture upload.
- Record provenance/permission separately when a fixture is retained long-term.
