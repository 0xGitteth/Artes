# Artes moderation state machine

Status: canonical implementation contract for the moderation architecture simplification PR.

## Goal

Moderation state must have one authoritative path from image evaluation to publication. Safety must not depend on coordinating several partially overlapping caches, queues, timers, lifecycle aliases or client-side assumptions.

The implementation should prefer a small conservative rule over a more precise but non-transitive or timing-sensitive rule.

## Canonical trust boundaries

### 1. Fingerprint scope generation

Fresh-evaluation invalidation is global to the image fingerprint scope, because exact moderation caches and moderation examples are reusable across uploaders.

The canonical scope is the existing four-hex-character dHash prefix used for near-duplicate candidate lookup.

Each scope has one server-only document:

`moderationFreshScopes/{dhashPrefix}`

with at least:

- `generation`: non-negative integer
- `updatedAt`
- optional audit metadata for the most recent queue action

A moderator fresh-evaluation request increments the generation for every valid prefix represented by the review case.

There are no fresh-evaluation reservations, consumable overrides, fuzzy boundary replacement lists, boundary eviction floors or TTL-based reservation ownership.

A prefix-level generation deliberately invalidates every cache in that prefix, even if two images in the prefix are outside the near-duplicate Hamming threshold. This may cause a rare extra AI evaluation, but it removes non-transitive invalidation and is fail-closed.

### 2. Evaluation generation

Every persisted moderation upload stores exactly one `moderationGeneration`, equal to the current generation of its dHash prefix when the server accepts the moderation result.

Before persisting the final result, the transaction rereads the scope document. If the current generation differs from the request generation, the request is superseded and cannot become a reusable or publishable moderation result.

Multiple requests may evaluate concurrently at the same generation. They may all persist successfully. This is acceptable: it can cost an extra model call, but it creates no safety ambiguity.

If a moderator requeues while an older request is running, the generation increments. The older request therefore fails its persistence fence. No lease, timeout or reservation semantics are needed.

### 3. Cache reuse

A cache is reusable only when all existing cache requirements pass and:

`cachedUpload.moderationGeneration >= currentScopeGeneration`

Exact and near-duplicate cache selection use the same generation rule.

Legacy uploads without `moderationGeneration` are generation zero.

### 4. Moderator decisions and examples

`moderationExamples` is audit/learning data and may provide reusable human decisions, but a decision may never outrank the current fingerprint-scope generation.

Every new example stores the source upload's `moderationGeneration`. A final example is routeable only when:

`example.moderationGeneration >= currentScopeGeneration`

A fresh-evaluation queue example is audit evidence, not a special routing boundary. The generation document is the routing boundary.

Legacy examples without a generation are generation zero and cease to be routeable once the prefix has been requeued under the new system.

### 5. Upload lifecycle

The server owns upload lifecycle. AI/policy evidence and lifecycle are different concepts.

Canonical concepts:

- `moderationState`: moderation/review authority, for example `allowed`, `review_pending`, `correction_pending`, `rejected`, `superseded`
- `publicationState`: publication lifecycle, for example `pending`, `draft`, `published`, `discarded`, `expired`
- `mediaState`: preview/media lifecycle, for example `pending`, `ready`, `cleanup_pending`, `deleted`

`outcome`, `shouldReview`, `publishBlocked` and classifier details are evidence/result fields. They are not independent publication authorities.

During compatibility with existing documents, legacy `reviewStatus`, `publicationStatus` and `publishStatus` may be mirrored, but all server decisions should go through one lifecycle helper rather than reimplementing precedence rules.

### 6. Review cases

`reviewCaseId` means the current operational review case for the upload.

A routed correction's source case is provenance only and must be stored/read as provenance, not as active review state. Existing `correctionReviewCaseId` is therefore never sufficient by itself to defer preview retention or to count as an active owned case.

Review-case creation/linking and upload finalization should be one server transaction wherever possible. A review case must not exist solely because an upload persistence attempt later failed.

### 7. Moderated media

Every moderation preview must have a durable upload anchor before the Storage object is created.

Use a deterministic object path derived from the upload ID, for example:

`moderation-previews/{uid}/{uploadId}.{ext}`

Pipeline:

1. Compute fingerprint and moderation result.
2. Create a server-only upload stub with `mediaState: pending`, fingerprints, request generation and retention metadata after checking the generation fence.
3. Write the Storage object to the deterministic upload path.
4. In one final transaction, reread the generation, finalize moderation lifecycle/review linkage, and mark media `ready`.
5. If Storage or finalization fails, the upload stub remains the durable cleanup anchor. Scheduled cleanup can delete a missing or orphaned object idempotently.

Do not create Storage first and rely on compensating deletion to avoid orphaned media.

### 8. Publication

Production upload publication has one authoritative route: server-side persisted moderation publication by upload ID.

The publication transaction must reread:

- the upload
- the current fingerprint-scope generation
- relevant user/account publication gates
- current correction/review authority

and reject publication when:

`upload.moderationGeneration < currentScopeGeneration`

Client-side UI checks are usability only.

A client must not choose between multiple production publication trust paths. Development/Codex isolation may use a separate explicitly isolated destination, but it must not weaken production publication logic.

### 9. Consent timestamps

JSON transport may turn Firebase Timestamp values into plain objects. The server is responsible for converting every allowed persisted timestamp field back to a real Admin Firestore `Timestamp` or rejecting malformed values.

Plain timestamp-shaped maps must never be written to public posts as timestamp evidence.

## Fresh-evaluation transition table

### Queue at generation G

- transaction increments scope to G+1
- review case exits active review
- known linked upload(s) may be marked superseded for immediate UX consistency
- old caches/examples/uploads remain stored but are no longer authoritative because their generation is < G+1

### Request starts at G

- cache/example routing considers only evidence with generation >= G
- if reusable evidence exists, it may be reused
- otherwise the current classifier runs

### Queue occurs while request G runs

- scope becomes G+1
- request G final persistence rereads the scope and fails
- it cannot satisfy or consume G+1 because there is nothing consumable

### Two requests start at G

- both may evaluate and persist at G
- either result can later be reused if all normal cache constraints pass

### Publication of upload G after queue G+1

- publication transaction reads G+1
- publication fails closed

### Requeue after a prior queue

- generation always increments
- no reservation expiry can suppress a new generation

## Legacy deployment compatibility

The current production branch already has per-user `freshEvaluationOverrides` from the older implementation.

Before deploying the generation architecture, run a one-time idempotent migration that:

1. scans outstanding legacy overrides;
2. validates their dHash prefix;
3. ensures the corresponding global scope generation is at least one;
4. does not clear the legacy override until the migration result is verified.

The deployment gate must confirm that no valid outstanding legacy override lacks a matching global scope generation.

New runtime code must not depend on the newer branch-only boundary/floor arrays having ever reached production.

## Required adversarial regression matrix

The implementation is not complete until tests cover at least:

- exact cache before/after queue
- cross-uploader exact cache before/after queue
- same-uploader near cache before/after queue
- old moderator example after queue
- new moderator example after fresh evaluation
- request starts before queue and finishes after queue
- repeated requeue while an old request is still running
- two concurrent fresh evaluations at the same generation
- publication racing a queue
- deleted selected linked upload with fingerprints retained on the case
- fingerprint recovery from remaining linked uploads
- multiple fingerprints/prefixes in one review case
- prefix collision intentionally causing conservative extra reevaluation
- missing fingerprint closing a case without inventing a generation
- Storage write failure after durable upload stub
- finalization failure after Storage write
- scheduled cleanup of pending/abandoned media
- correction provenance case reopening without retaining unrelated preview media
- JSON-transported consent timestamps
- managed-profile author publication through the same server publication route
- draft/resume/correction publication through the same server publication route

## Non-goals

- Do not optimize away rare duplicate Gemini calls by reintroducing leases/reservations.
- Do not make dHash-near matching an equivalence relation; it is not transitive.
- Do not use moderation examples as the fresh-evaluation boundary.
- Do not let client state decide whether a persisted upload is publishable.
