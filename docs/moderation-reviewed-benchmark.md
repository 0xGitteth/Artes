# Measurement against confirmed Artes labels

The reviewed photo bundle stays outside the public repository. The benchmark reads its existing `dataset.json` and exact image bytes locally; it never changes human labels or moves images between training and test. It supports the schema 4 bundle with label definition `artes_nudity_visible_pubic_region_v2_2026_10_06` and the existing context values `none`, `suggestive`, `bdsm_kink`, `explicit_act`. Earlier reviewed datasets use their own definitions and are not silently mixed in.

Run the local integrity check first:

```bash
npm run moderation:benchmark-reviewed -- --dataset /path/to/artes-moderatie-batch-350/dataset.json
```

This verifies confirmations, label consistency, image hashes, unique files and separation of source pools. The default selection is training. It makes no external AI calls. Creator separation alone does not establish independence of scenes, subjects or near duplicates.

Classifier evaluation clearance is separate from permission to train a model. A clearance file must reference the exact `datasetSha256` printed by the check and contain an `items` array. Each approved entry contains `candidateId`, the matching image `sha256`, `approvedForClassifierEvaluation: true`, and an `evidence` string documenting the source/use assessment. A public copyright licence, an apparent-age judgment or a confirmed content label alone does not establish all of those permissions. The importer does not invent clearance, training release or adult-age evidence. Existing labels do not need to be reconfirmed for a source assessment.

After completing that assessment, measure the training selection in staging:

```bash
GOOGLE_CLOUD_PROJECT=artes-staging ENABLE_GEMINI_CLASSIFIER=true npm run moderation:benchmark-reviewed -- --dataset /path/to/artes-moderatie-batch-350/dataset.json --clearance /path/to/evaluation-clearance.json --run
```

The runner writes a checkpoint after every image. If interrupted, repeat the same command with `--resume`; it skips already recorded images and rejects a different dataset, model, prompt or split. Use a fresh `--out` path for a new run. Reports preserve the human labels, image identities, model, prompt version, parsed predictions and provider diagnostics. They do not publish image files or update the app database.

The report separates valid model predictions, provider safety blocks, provider errors and missing/invalid results. A block requires review and never counts as a correct classification. It measures nudity/adult decisions, sexual context and the existing pure policy projection separately, including false general access, false prohibition and missed explicit acts. It groups outcomes by the seven **human** nudity categories; the current Gemini contract does not predict seven nudity subclasses, so this is not seven-class accuracy. Model confidence is not measured correctness. A known wrong automatic decision remains an error even if it did not enter the review queue.

Use training results for development. Freeze the model, prompt and source/scene grouping before executing the held-out selection with `--split test --final-test`. The current 70-image test selection has no explicit acts and only one BDSM/kink case, so it cannot establish reliability for all sexual-content moderation. The proposed supplementation and redistribution remain a separate, unapplied plan.

The four existing smoke-test images remain available through:

```bash
GOOGLE_CLOUD_PROJECT=artes-staging ENABLE_GEMINI_CLASSIFIER=true npm run golden:moderation-v2:classifier -- --summary
```

The full report is saved at `.tmp/moderation-benchmarks/golden-classifier.json`. Each of these four clear fixtures must receive an automatic Artes decision: covered ordinary boudoir is general, covered non-explicit BDSM is adult content, non-explicit nudity is adult content, and a clear explicit act is forbidden. Provider refusal or routing a clear fixture to review fails this automation expectation and makes `automaticDecisionGoalMet` false. A safe temporary review route does not satisfy the target behavior. This command tests only Gemini. The reviewed benchmark adds the pure policy projection, but neither command exercises the upload endpoint, SafeSearch, Firestore lifecycle or publication. Neither trains a model or clears the application for production.

The intended application route uses image detectors that supply evidence for Artes rules. A provider refusal is not an Artes content verdict. An independently validated detector can provide the missing evidence; if no reliable evidence is available, the application currently retains the temporary review route. The present DINOv2 service only returns embeddings and `detectorResult: null`, so that independent classification path does not exist yet. A nudity-only classifier will not establish whether a sexual act is visible. The implementation must assess sexual context separately and preserve minor-safety and other safety concerns. Measuring or improving Gemini alone is insufficient to complete this migration.

Validation commands:

```bash
npm run test:moderation-benchmark
npm run test:moderation-policy
```
