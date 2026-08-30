# Artes moderation policy v2

Status: product decision draft, August 2026.

This document separates four different questions that must not be collapsed into one AI verdict:

1. Is the content allowed on Artes at all?
2. Does the content require active 18+ access?
3. Is the content sensitive and therefore subject to the viewer's hide / blur / show preference?
4. Is the AI confident enough to decide automatically, or is human review required?

The AI should primarily detect concrete signals. Deterministic Artes policy decides the result.

## Access levels

### General

Available to ordinary signed-in Artes users after normal onboarding.

Examples:

- portrait, fashion, lifestyle and editorial
- swimwear
- lingerie and ordinary boudoir
- a string or thong when intimate parts remain covered
- male topless content by itself
- fully healed scars without a separate sensitive context
- very mild superficial injury or blood, such as a tiny cut or minor nosebleed, when the image is not visually confronting
- ordinary smoking, drinking or non-distressed substance use by itself
- pills, cigarettes, alcohol or drugs shown as objects by themselves
- body size, thinness, weight, a scale, food, exercise, fitness, dieting or body-image aesthetics without clear eating-disorder context
- real, replica or prop weapons shown alone or in posed/editorial imagery without a visibly harmed or threatened victim
- a weapon aimed toward the camera/viewer by itself
- a blood-stained weapon that merely implies an off-screen event, without a visibly harmed/threatened victim
- controlled shooting-range imagery without a threatened or harmed person
- stylized decorative blood without visible injury, victim distress or genuinely disturbing horror presentation

### Sensitive

Available in ordinary Artes, but the viewer controls whether each sensitive category is hidden, blurred or shown.

Examples:

- blood or injury that is visually substantial enough that a viewer could reasonably benefit from a warning, such as a clearly open or freshly stitched wound, notable bleeding or a convincing traumatic wound
- convincing non-extreme injury SFX, including stitched-wound makeup, burnt-skin makeup, zombie wounds, fake blood or deep-looking prosthetic wounds
- severe localized trauma, including a localized compound fracture with visible bone or a localized wound showing internal tissue/organs, when the overall scene is not exceptionally mutilating, catastrophic or gory
- documentary childbirth with visible blood, placenta, umbilical cord or other birth anatomy when the overall image is not exceptionally graphic
- explicit self-harm or suicide awareness/recovery content, including healed self-harm scars when the post explicitly frames them as self-harm/recovery
- fresh but non-exceptionally-graphic self-harm injuries or non-graphic depictions of self-harm acts
- clear non-graphic suicide attempts, scenes or aftermath
- clear eating-disorder awareness/recovery content or serious visible eating-disorder-related distress/behavior, without harmful instruction or glorification
- severe intoxication, overdose-like scenes or other serious visible substance-related distress
- active interpersonal attacks, a clearly identifiable victim in immediate peril, or convincing victim-focused violent consequences/aftermath
- visually disturbing horror / scare imagery, especially gore-like makeup, fake blood or severe injury illusion when the total presentation is genuinely disturbing

A trace or small amount of blood, a tiny superficial cut, minor nosebleed, bruising alone or a fully healed scar is general content unless another sensitive rule applies. Standalone needles/injection equipment and spiders/insects are general content unless another sensitive rule applies. Artes does not maintain an open-ended phobia-warning taxonomy; personal phobias can be handled later through optional user-controlled tag/content filtering rather than core moderation.

Weapon presence and implied off-screen violence are intentionally not enough by themselves for a viewer warning. A weapon held in an editorial pose, aimed toward the camera, used at a controlled shooting range, or shown blood-stained without a visible harmed/threatened victim remains general. `violence` starts when the still image itself contains a direct attack, an identifiable person in immediate peril, or convincing victim-focused consequences/aftermath.

Sensitive content must carry the relevant warning labels. Missing labels may be added automatically when detection confidence is high. Uncertain cases may be reviewed.

### Adult (18+)

Requires active 18+ entitlement. Didit is an access mechanism for this part of Artes only and is not part of ordinary onboarding.

Content is adult when nudity is clear, including when nudity is deliberately implied even though intimate parts are strategically covered.

Examples:

- implied nude
- bare buttocks
- visible female nipples / bare breasts
- visible genitalia
- transparent clothing that leaves intimate parts visibly exposed
- art nude
- clearly erotic or sexually suggestive imagery even without nudity
- BDSM / kink content

A male bare chest by itself is not adult content.

### Adult + sensitive

Requires active 18+ entitlement and is also blurred / warned according to sensitive-content handling.

For nonsexual graphicness, this threshold is intentionally the adults-only end of the scale. Injury, blood, self-harm, suicide or horror does not become 18+ merely because it is convincing, realistic, medically severe, emotionally serious or unpleasant. Ordinary warning-level wounds, localized exposed anatomy and non-extreme SFX remain sensitive only.

Examples of factors that may contribute to Adult + sensitive when their combined effect is exceptionally severe:

- major realistic mutilation with explicit visual focus on the damage or suffering
- dismemberment presented in a highly graphic way
- catastrophic traumatic injury with extreme visible consequences
- extensive evisceration or exposed viscera as part of a highly graphic overall scene
- overwhelming or extensive gore / blood
- exceptionally graphic self-harm imagery
- realistic and exceptionally graphic suicide aftermath
- exceptionally graphic violence

These are indicators, not automatic one-factor rules. Visible bone, tissue, internal organs, a mutilation theme, realism, medical context or artistic context are not enough by themselves. The overall image must cross the adult-only visual-impact threshold. Likewise, the seriousness of a self-harm or suicide act does not by itself make the still image Adult + sensitive; its visible total impact must reach that threshold.

Even an adult viewer should not receive this material unexpectedly.

### Forbidden / safety review

Content must not be published when it is clearly forbidden. Genuine uncertainty about a serious safety issue is held for human review.

Examples:

- explicit sexual acts such as penetration, oral sex or masturbation
- sexual content involving a minor or a person reasonably suspected to be a minor
- content that clearly encourages, glorifies or gives actionable instructions for self-harm, suicide, dangerous eating-disorder behaviour or harmful drug use
- other illegal content covered by Artes policy

Awareness, recovery, prevention or non-instructional depiction is not forbidden merely because the topic is self-harm, suicide, eating disorders or substance use.

When age is uncertain, the AI must not estimate an exact age and make a final legal decision by itself. Route relevant uncertainty to human review.

## AI detection contract

The preferred AI role is detector, not policy maker.

The future classifier should return concrete observations such as:

```json
{
  "nudity": "none | underwear_swimwear | implied_nude | bare_buttocks | female_bare_breasts | genitalia | male_topless",
  "sexualContext": "none | suggestive | bdsm_kink | explicit_act",
  "graphicInjury": "none | mild | graphic",
  "sensitiveSignals": [
    "bloodInjury",
    "selfHarm",
    "suicide",
    "eatingDisorder",
    "substanceDistress",
    "violence",
    "horrorScare"
  ],
  "possibleMinorConcern": false,
  "confidence": 0.0,
  "uncertaintyFlags": []
}
```

The exact schema may change during implementation, but these concepts should remain separate.

## External age-rating calibration

Artes should not invent its nonsexual 18+ threshold from individual moderator taste. The adult-sensitive boundary is therefore calibrated against established child-media classification principles, primarily Kijkwijzer / Kijkwijzer Online in the Netherlands, with BBFC guidance and classification examples as a secondary sanity check.

This is a derived Artes policy, not an official Kijkwijzer classification. NICAM-trained codeurs use a full classification questionnaire and training material that Artes does not reproduce. The purpose here is to reuse the public, research-based principles consistently rather than claim an official rating.

Public Kijkwijzer guidance establishes several useful anchors:

- violence is rated more severely as it becomes harder, more realistic and bloodier;
- fear-related material, including wounds, corpses, horror, suicide and self-harm, rises with realism and explicitness;
- hard violence, bloody wounds and corpses can already fall below the adults-only band;
- the 16 band includes heavy violence and horror;
- the 18 advice identifies material intended only for adults;
- Kijkwijzer Online was specifically adapted for online uploaders and is based on research into the effects of online media on children, youth focus groups and content analyses.

For a single still image, Artes translates time-based film factors into still-image equivalents. Instead of duration/frequency, assess how strongly the graphic material dominates the frame and where the visual focus lies.

For nonsexual injury, violence, self-harm and horror, the total-impact assessment weighs:

1. realism: does it convincingly resemble a real harmed person, or is it clearly stylized/fantastical;
2. explicit detail: how clearly the injury, bodily damage or aftermath is shown;
3. visible consequences: blood, exposed anatomy, deformation, death or other physical consequences;
4. severity: how serious the depicted injury or violence is;
5. pain and suffering: whether the image strongly focuses on a victim's distress, suffering or traumatic aftermath;
6. dominance/focus: whether the graphic material is incidental/localized or dominates the image;
7. contextual distancing: stylization, obvious SFX, medical/documentary framing or artistic abstraction can change perceived realism and impact, but never operate as an automatic exemption.

No one factor is sufficient by itself. A realistic image can remain Sensitive rather than Adult + sensitive, while a stylized work can still become Adult + sensitive if its combined visual impact is extreme.

Operational mapping for nonsexual graphicness:

- content that would plausibly sit within ordinary lower/teen age bands but is not warning-worthy for Artes -> General;
- content comparable to warning-worthy 12/14/16 violence, injury, self-harm or horror -> Sensitive, with the user's hide/blur/show preference;
- only material that plausibly reaches an adults-only classification on overall impact -> Adult + sensitive.

This framework applies to the age-gating decision. Artes warning categories remain product-specific and can be narrower than a Kijkwijzer content pictogram. For example, a content-rating system may flag any smoking or alcohol use for youth guidance while Artes can still decide that ordinary non-distressed use does not require a sensitive-image blur.

Reference basis:

- Kijkwijzer for uploaders: https://www.kijkwijzer.nl/uploader
- Kijkwijzer Platformwijzer / YouTube age bands: https://www.kijkwijzer.nl/kennis/platformwijzer/youtube/
- Kijkwijzer public explanations of violence and fear criteria: https://www.kijkwijzer.nl/
- NICAM Kijkwijzer regulations and age/content classifications: https://nicam.nl/files/Reglementen-NICAM_Kijkwijzer-2.1.0-2023.pdf
- BBFC classification examples are used only as a secondary international reasonableness check: https://www.bbfc.co.uk/

## Deterministic rules

The following rules should be implemented outside the model prompt wherever possible.

- explicit sexual act -> forbidden
- clear or implied nudity -> adult
- bare buttocks -> adult
- female bare breasts / visible nipples -> adult
- visible genitalia -> adult
- male topless only -> general
- underwear, swimwear or string alone -> general
- clearly erotic / suggestive context -> adult
- BDSM / kink -> adult
- fully healed scar without another explicit context -> general
- tiny superficial cut, minor nosebleed, trace/small blood or bruising alone -> general unless another sensitive rule applies
- warning-level open/stitched wound, notable blood or convincing substantial injury -> sensitive
- convincing but non-extreme wound/horror SFX -> sensitive, not automatically adult
- localized exposed bone/tissue/internal organs without an exceptionally graphic overall scene -> sensitive
- documentary childbirth / placenta imagery is normally sensitive rather than adult-sensitive on graphicness alone
- ordinary smoking / non-distressed substance use -> general
- severe substance-related incapacitation / overdose-like distress -> sensitive
- body size/thinness/weight/scale/food/fitness/dieting alone -> general, never infer eating disorder from these alone
- explicit eating-disorder awareness/recovery or serious visible ED-related distress/behavior -> sensitive
- healed scars without self-harm context -> general
- explicit self-harm recovery/awareness context, fresh non-extreme self-harm, or non-graphic self-harm act -> sensitive
- non-graphic suicide attempt/scene/aftermath -> sensitive
- harmful instruction, encouragement or glorification for self-harm/suicide/eating-disorder behavior/harmful drug use -> safety review / forbidden as appropriate
- standalone/posed weapon, weapon aimed at camera, blood-stained weapon without visible victim, or controlled shooting-range use -> general
- implied off-screen violence alone -> general
- direct active attack, identifiable victim in immediate peril, or convincing victim-focused violent aftermath -> sensitive via violence
- horror theme / costume / prop alone -> general
- stylized decorative blood without injury/distress/disturbing presentation -> general
- genuinely disturbing horror / scare imagery -> sensitive
- sensitive signal without adult rule -> sensitive
- only exceptionally graphic injury / self-harm / suicide / violence whose combined impact reaches the adults-only threshold -> adult + sensitive
- severe disagreement between strong independent AI signals -> review
- genuine uncertainty between allowed adult content and forbidden explicit content -> review

For implementation, `graphic=true` on injury/self-harm/suicide/violence must be reserved for the exceptional Adult + sensitive threshold, not used for ordinary warning-level wounds, convincing but non-extreme SFX, localized exposed anatomy, or merely because a self-harm/suicide act is serious.

### Golden batch 4 calibration

The August 2026 visual-intensity calibration fixed the following product ground truth:

- fully healed caesarean scar -> general
- minor nosebleed / mild blood without substantial injury -> general
- visibly bruised / mildly injured nose with limited blood -> general
- fresh stitched wound with clear visible injury -> sensitive
- convincing stitched-wound SFX -> sensitive
- burnt-skin SFX -> sensitive
- zombie / prosthetic wound SFX -> sensitive
- deep-looking but non-extreme face-wound SFX -> sensitive

The key decision is that Artes should not over-warn mild blood or mild injury, and should not age-gate ordinary graphic-looking SFX. Adult + sensitive remains reserved for substantially more extreme visual material than the SFX examples in this calibration batch.

### Golden batch 5A calibration

The next visual-intensity batch deliberately moved one step further toward the adult + sensitive boundary. Product ground truth remains sensitive, not adult + sensitive, for:

- multiple realistic-looking cuts and abrasions in SFX makeup -> sensitive
- a deeper torn-looking facial wound with clearly more blood -> sensitive
- open-looking facial wounds with visible red tissue simulation -> sensitive
- extensive realistic-looking facial trauma in a staged medical / SFX scene -> sensitive

This confirms that a wound may look deep, show simulated tissue, involve substantial facial trauma or appear medically serious and still remain ordinary sensitive content. `graphic=true` must not be inferred from realism, apparent depth or simulated exposed tissue alone.

### Golden batch 5B calibration

The next batch deliberately tested injuries that previously looked close to the Adult + sensitive boundary. Product ground truth is still sensitive for all four examples:

- severe localized eye / facial injury SFX -> sensitive
- extensive third-degree burn simulation / moulage -> sensitive
- localized compound fracture with visible bone, open wound and blood -> sensitive
- localized abdominal wound with visible simulated intestines / internal organs -> sensitive

This moves the threshold higher again. Visible bone or internal organs do not automatically make an image 18+. Adult + sensitive is reserved for a substantially more extreme overall image.

### Documentary birth calibration

A real documentary childbirth image with visible blood, placenta and birth anatomy is product-ground-truth Sensitive for nonsexual graphicness, not Adult + sensitive. The reason is not that medical or documentary material is exempt; the image still receives a warning. It establishes that visible internal/birth anatomy and real blood do not by themselves reach the adults-only threshold.

If the same image independently contains adult nudity under Artes nudity rules, the Adult access label is preserved separately. Graphicness and nudity must not be collapsed into one decision.

### Context batch: substances, weapons, violence and horror

Final product-ground-truth for the contextual category batch:

- ordinary injection/drug-use depiction without serious visible distress -> general
- clear serious substance-related physical/mental distress -> sensitive
- posed/editorial firearm without victim -> general
- controlled shooting-range use without victim -> general
- firearm aimed directly toward the camera/viewer, without a visible victim or other direct violence -> general
- model holding a blood-stained knife where violence is only implied off-screen and no victim/distress is visible -> general
- stylized decorative blood without wound/victim/distress -> general
- genuinely disturbing blood-heavy horror/editorial scene -> sensitive

The important correction is that a threatening visual pose or implied off-screen violence is not enough by itself for `violence`. The still image must show a direct harmed/threatened person or convincing victim-focused consequences before a viewer warning is justified.

### Context batch: self-harm, suicide and eating disorders

Final product-ground-truth:

- thin body, scale, food, fitness or body-image imagery without clear eating-disorder context -> general
- clear ED awareness/recovery content without harmful instructions -> sensitive
- serious visible ED-related physical distress/behavior without glorification/instruction -> sensitive
- pro-ED encouragement, glorification or actionable harmful instruction -> safety review / forbidden as appropriate
- healed scars without clear self-harm context -> general
- healed self-harm scars in explicit recovery/awareness context -> sensitive
- fresh but non-exceptionally-graphic self-harm or non-graphic depiction of the act -> sensitive
- clear non-graphic suicide attempt/scene/aftermath -> sensitive
- extremely graphic self-harm/suicide imagery -> Sensitive or Adult + sensitive according to the same total-impact adults-only threshold used for other graphic injury; the topic alone never creates an automatic 18+ rule
- encouragement, glorification or actionable self-harm/suicide instruction -> safety review / forbidden as appropriate

These final contextual batches are covered by `functions/test/moderationContextualCategoryBoundaries.test.js` and are part of `npm run test:moderation-policy`.

Batch 5A, 5B, the documentary-birth calibration and the contextual category calibrations are protected by regression tests. The full moderation suite, lint, build and `git diff --check` are run through temporary GitHub Actions validation workflows after policy calibration; temporary validation files are removed after successful runs.

Creative themes such as Portrait, Fashion, Conceptual and Art Nude do not determine access. A nude Fashion image may remain themed Fashion while still receiving an adult safety/access label.

## User declarations and AI checks

Uploader input and AI detection should support each other rather than replace each other.

- The uploader remains responsible for selecting relevant content warnings.
- AI checks for missing safety labels and prohibited content.
- High-confidence objective signals can apply an access or warning label automatically.
- The uploader cannot remove a server-applied adult or sensitive label without an approved correction/review flow.
- Review is reserved for genuine uncertainty, not used as the default outcome whenever AI systems disagree slightly.

## Age and minors

AI must not be used as the age-verification system.

For adult content, the uploader must confirm that all people shown in relevant nude / erotic contexts are adults. If the system has a credible reason to doubt this, publication is held for review.

A user who attempts 18+ verification and is confirmed to be under 18 remains allowed to use ordinary Artes but receives no adult entitlement.

## External sharing

Ordinary Artes stays login-only by default. A creator may explicitly make an individual general-content post externally shareable through a public link.

Adult content must never expose the image through an unauthenticated public share page. Such a link may only show a neutral age-gated message and direct the visitor to sign in / verify where appropriate.

## Moderation review goal

Human review should be the exception.

Target behaviour:

- ordinary content -> automatic general allow
- ordinary boudoir -> automatic general allow
- mild superficial blood/injury -> automatic general allow
- clear warning-level injury or convincing non-extreme wound SFX -> automatic sensitive warning
- severe localized trauma / exposed anatomy without an exceptionally graphic overall scene -> automatic sensitive warning
- documentary childbirth with visible placenta/blood -> sensitive warning for graphicness, not adult-sensitive solely on anatomy
- ordinary substance use -> general; severe visible substance distress -> sensitive
- weapon presence / posed threat / implied off-screen violence without visible victim -> general
- direct interpersonal violence or victim-focused aftermath -> sensitive
- ordinary body-size/weight/food/fitness cues -> general, not eating-disorder inference
- explicit ED/self-harm/suicide awareness or non-graphic depiction -> sensitive
- harmful instruction/glorification -> safety review / forbidden as appropriate
- clear nude / implied nude -> automatic adult allow
- clear erotic / BDSM -> automatic adult allow
- clear sensitive content -> automatic warning label
- only exceptionally graphic sensitive content whose combined impact plausibly reaches an adults-only threshold -> adult + sensitive
- explicit sexual activity -> automatic block when confidence is sufficiently high
- meaningful uncertainty -> review

The golden-test set should grow to cover these boundaries with real images and expected outcomes before thresholds are tuned in production.
