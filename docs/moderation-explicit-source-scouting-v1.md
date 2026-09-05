# Explicit moderation source scouting v1

Status: research-only sourcing guidance. This does not grant training, production, redistribution, publication or runtime rights.

## Purpose

Build an explicit-content research set that visually resembles content people could realistically post on Artes. Wikimedia Commons remains useful for hard anatomical and explicit-act anchors, but must not dominate the visual distribution. The majority should come from real creative photography: art nude, editorial nude, boudoir, fetish, leather/latex, shibari/bondage, erotic portraiture and relevant event photography.

## Practical sourcing rules

1. Prefer normal publicly visible photographer portfolios and public creative-platform portfolios. Preserve source page, creator, source pool and visible rights/terms notes.
2. `All Rights Reserved`, ordinary copyright notices, or silence about ML/research do not by themselves turn a public page into `training_approved`. They also do not automatically disqualify a candidate from local `web_research`; mark rights as unverified/restricted and keep the image local only.
3. Do not bypass logins, paywalls, private galleries, expiring customer links, technical access controls or site restrictions. Do not impersonate a user, hide the research purpose, or scrape content that is only available after unauthorized access.
4. If a site explicitly prohibits reproduction, copying, downloading or other reuse, do not automatically fetch it into the local research corpus. Keep it as a visual/source lead or route it to manual rights review.
5. Public preview images on sites that sell higher-resolution collections may be considered as research leads, but paid/gated originals must not be fetched without authorization.
6. Source terms are evidence, not legal clearance. Record `termsStatus`; do not infer model rights or ML rights from the absence of a clause.
7. Adult/sexual content still requires human age-safety review. Source descriptions saying models are adults may guide review but never replace it.
8. Discovery terms are sourcing hints only. Human labels remain authoritative.
9. Source diversity matters. Avoid filling a class with one photographer, one model, one session or one visual style.
10. Artes representativeness outranks anatomical convenience. For each explicit class, prefer full-body, environmental, editorial, fine-art and fetish photography alongside a smaller number of clinical/anatomical anchors.

## Initial photographer/site scouting

### Strong Artes-representative candidates

**Matt Spike** — https://www.mattspike.com/
- Public fetish gallery and portfolio.
- Focus: male kink, leather, homoerotic/fetish photography.
- Terms status: public site exposes copyright footer; no detailed reuse terms surfaced in initial review.
- Research status: candidate source, `unverified_research_only`; exact gallery items still need per-item review.

**Masnyk Photography** — https://www.masnykphotography.com/
- Public photographer galleries with BDSM/fetish portraiture, latex, masks, domination/submission themes.
- Terms status: no clear reuse terms surfaced in initial search result.
- Research status: candidate source, exact public gallery pages and terms still need per-item review.

**So Eyesome** — https://soeyeso.me/
- Public fetish-fashion portfolio.
- Focus: latex, lacquer/PVC, leather, heels and fetish lifestyle imagery.
- Terms status: homepage exposes Impressum and privacy links; no explicit reuse licence surfaced in initial review.
- Research status: candidate source, `unverified_research_only` pending exact-item review.

**Kamerakunst** — https://www.kamerakunst.com/nude-photography/
- Public nude, boudoir and fetish photographer portfolio/service pages.
- Focus: nude, erotic portraiture, latex, vinyl and leather.
- Terms status: privacy/consumer pages found; no explicit portfolio-reuse grant identified in initial review.
- Research status: candidate source, exact-item terms check required before local fetch.

**de Daniloff Fine Art Photography / De Fotospecialist** — https://www.fotospecialist.be/
- Public portfolios for lingerie, artistic nude and fetish.
- Strong visual relevance to Artes.
- Terms status: explicit copyright terms say reproduction, copying, internet use or other use is prohibited without written agreement.
- Research status: do not automatically fetch portfolio images. Keep as visual/reference source unless written permission or a clearly licensed image is found.

### Useful but more limited or conditional

**Melissa Brielle Boudoir** — https://melissabrielleboudoir.com/colorado-springs-boudoir-photographer
- Public fine-art nude and boudoir gallery.
- Terms status: visible `all images copyright` notice and linked terms.
- Research status: source lead; review exact terms before local fetch.

**Buyanskyy** — https://buyanskyy.com/
- Public artistic-nude previews; states all models are adults with signed releases.
- Full 8K collections are sold for personal use and are not licensed for redistribution/publication without permission.
- Research status: public preview pages can be scouted; do not use paid/gated collection files without authorization.

**The Dark Side / ruhrpottblende** — public Model-Kartei photographer profile
- Strong bondage/SM specialization, including rope, steel, leather and tape.
- States shoots use contracts and images are published on Model-Kartei/comparable portals, not sold or used on pay sites.
- Research status: useful public-source lead; exact platform terms and image access still need review.

## Target source mix for the larger explicit set

Aim for roughly 100 explicit research candidates, with the majority from creative photographer/portfolio sources and a minority from Wikimedia Commons or similar public repositories as hard anchors.

Suggested mix:
- 60–70% photographer portfolios, creative platforms and event photography that visually resemble Artes posts.
- 20–30% Commons/public-repository anchors for clear breasts, buttocks, genitalia and explicit acts.
- Remaining slots for hard boundary cases and styles underrepresented in the first two research batches.

The intended end result is not a legally cleared production dataset. It is a diverse, provenance-preserving, human-reviewed research set that lets us test whether Artes can distinguish ordinary creative photography, adult art nude, kink and explicit sexual content without over-sending mild imagery to review.
