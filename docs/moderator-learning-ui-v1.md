# Moderator learning UI v1

Status: implementation contract for the moderation-intelligence branch. No production behavior change until explicitly approved.

## Goal

A moderator should not fill out a dataset form for every image. Normal moderation remains the primary task. Learning evidence is collected with the fewest additional actions possible.

The visual detector and Artes policy remain separate:

- visual learning fields describe what is visible;
- `reasonCode`, corrected taxonomy, and final moderation action describe the human policy decision;
- a visual label never directly decides `allowed`, `18+`, `review`, or `forbidden`.

## Adaptive flow

### When a future detector already supplies a valid full Artes detector label

Show the AI observation in compact form and offer:

1. `Waarneming klopt` — one action confirms the complete detector label as human-verified learning data.
2. `Aanpassen` — reveal only the fields most relevant to the selected moderation reason, while allowing the moderator to expand all fields if needed.

The moderator confirmation is stored separately from model confidence. The resulting human training label gets human provenance.

### When no valid full detector label exists

Do not make the moderator fill every field. Ask only fields relevant to the chosen moderation reason. Store these as partial human visual evidence.

Partial evidence must never be padded with guessed neutral values merely to make a complete label.

## Suggested fields by current reason code

| Reason code | Suggested visual confirmation |
| --- | --- |
| `allowed_art_nude` | Nudity + sexual context |
| `allowed_boudoir` | Nudity + sexual context |
| `allowed_non_sensitive` | Nudity + sexual context |
| `review_borderline_adult` | Nudity + sexual context + possible minor concern |
| `forbidden_explicit_sexual` | Nudity; sexual context is already fixed to `explicit_act` by the reason |
| `forbidden_non_consensual_context` | Nudity + sexual context; non-consent itself is not treated as a reliable pixel-only label |
| `forbidden_self_harm_instruction` | Graphic injury; `selfHarm` signal is fixed by the reason |
| `forbidden_suicide_instruction` | Graphic injury; `suicide` signal is fixed by the reason |
| `forbidden_eating_disorder_instruction` | `eatingDisorder` signal is fixed by the reason |
| `forbidden_harmful_drug_instruction` | `substanceDistress` signal is fixed by the reason |
| `forbidden_other_safety` | Graphic injury + sensitive signals + possible minor concern |
| `wrong_theme_or_label` | All detector fields because the previous classification is explicitly being corrected |
| `unclear_ai_result` | All detector fields because there is no trustworthy detector observation to confirm |

## Visual field choices

### Nudity

- none
- underwear / swimwear
- implied nude
- bare buttocks
- female bare breasts
- genitalia
- male topless

### Sexual context

- none
- suggestive
- BDSM / kink
- explicit sexual act

### Graphic injury

- none
- mild
- graphic

### Sensitive signals

Multi-select:

- blood / injury
- self-harm
- suicide
- eating disorder
- substance distress / overdose
- violence
- horror / scare

### Possible minor concern

Boolean safety flag. This is evidence for routing/review and must not be inferred from appearance alone when the moderator is not actually making that judgement.

## Storage contract

`moderatorDecision.learningEvidence` may contain:

- `schemaVersion`
- `source`: `moderator_confirmed_ai_detector_label` or `moderator_visual_evidence`
- `reasonCode`
- `completeness`: `partial | full`
- `confirmedFields`
- `visualEvidence`
- `detectorLabel` only when all detector fields are actually confirmed

Partial evidence remains useful for analysis and future specialized training, but does not automatically become `trainingReady` for the full Artes detector.

## Legacy moderation decisions

The production audit found 39 stored moderation examples and 9 additional decided upload review cases without a moderation example.

Those 9 legacy cases are reconstructable only partially:

- all 9 have a linked upload and SHA256;
- all 9 have an allowed final decision;
- all 9 lack the historical reason code;
- all 9 lack a policy version;
- 3/9 still contain AI evidence;
- none contains corrected taxonomy.

They must therefore remain human-approved historical evidence without an invented category. If their media is still legitimately available for learning/relabeling, they can later enter a small legacy relabel queue. No production media is copied or retained for this purpose merely because this document exists.

## UX requirement

The extra learning interaction should normally be zero or one extra tap when the detector is correct, and at most a small set of concrete visual corrections when it is wrong. The moderator should never have to reason about model architecture, training splits, embeddings, or confidence calibration during normal moderation.
