# Authorized Flickr research lane v1

Status: research design only. This does not grant training, production, redistribution, publication or runtime rights.

## Why this lane exists

The current public/logged-out Flickr discovery under-samples the exact moderation classes Artes needs most. Flickr only exposes Safe content to unauthenticated viewers/calls, while full-frontal nudity, genitalia and explicit sexual acts belong in Restricted. Therefore public-only discovery is structurally biased toward milder content.

This is separate from privacy. Restricted is a Flickr safety level. The intended adult-member route is to sign in normally and configure SafeSearch so Restricted content can be viewed where Flickr permits it.

## Access model

Keep two separate research lanes:

1. `public_web_research`
   - logged-out/public pages only
   - no auth or cookies
   - useful for Safe/publicly exposed creative photography

2. `authorized_flickr_research`
   - normal authorized adult Flickr account
   - use Flickr's intended SafeSearch/account controls
   - prefer the official Flickr API/OAuth rather than scraping authenticated HTML
   - may request Restricted results where the authenticated account is permitted to view them
   - do not defeat login, age-assurance, geographic restrictions or technical access controls

## Dataset rules

Both lanes remain local research only:

- preserve exact source page, creator/source pool and rights/terms provenance
- discovery/access state is never a detector label
- human visual labels remain authoritative
- missing face, rear view, crop or anonymous subject is not a minor concern by itself
- concrete minor concern still requires safety review
- image bytes and embeddings stay out of Git
- `trainingReady: false`
- `productionEligible: false`
- `runtimeEligible: false`

Access to Restricted content does not imply permission to use an image in a production dataset. Owner/licence restrictions remain separate evidence.

## Flickr implementation preference

Prefer Flickr's official API for machine collection. Use authenticated/OAuth access only through Flickr's normal authorization flow. Do not copy or automate session cookies from an interactive browser and do not build a workaround around Flickr access controls.

The research account credentials/tokens must never be committed to the repository. Local secrets only.

## Sources to revisit with authorized access

### `flickr_erosunfoto_nude_erotic`

Public source: `https://www.flickr.com/photos/128438623@N07/sets/72157650849252192`

Current logged-out/public discovery result:

- raw candidates: 1
- new candidates: 0
- duplicate candidates: 1
- public route status: `low_yield_exhausted`
- next status: `authorized_revisit`

Reason: the album is explicitly adult/erotic and its description states adult consenting models, but the logged-out feed exposes only one candidate and that candidate duplicates the companion `self-arousal` source. Do not count this album as a meaningful independent public source until it has been revisited through the authorized Flickr research lane.

### `flickr_erosunfoto_self_arousal`

Current logged-out/public discovery result:

- raw candidates: 2
- new candidates: 2
- public route remains usable
- also revisit through authorized access because Restricted items may be omitted from the logged-out result

## Next implementation step

Before another large preview run, prototype a local `authorized_flickr_research` metadata discovery using Flickr's official API. The prototype should prove that Restricted (`safe_search=3`) public photos visible to the authorized research account can be enumerated without scraping authenticated web pages. Only after the metadata path is proven should image preview fetching be added.