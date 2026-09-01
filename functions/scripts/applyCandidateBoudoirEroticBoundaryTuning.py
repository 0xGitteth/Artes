from pathlib import Path

path = Path('functions/geminiModerationContract.js')
text = path.read_text()

insertions = [
    (
        "  '- underwear, lingerie, swimwear, a thong, or a string when intimate areas remain covered.',\n",
        "  '- Lace, mesh, sheer panels or cut-outs do not count as transparent exposure unless a nipple, genital area, or bare buttock is actually visible through them.',\n"
        "  '- A solo lingerie/boudoir image remains adultDecision=\"none\" when nipples, genitals and bare buttocks are not visible and nudity is not strategically implied. Cleavage, thighs, hip/buttock contour, an arched back, hand-over-head pose, reclining/standing pose, bedroom setting, outdoor setting or provocative styling alone do not create implied nudity.',\n",
    ),
    (
        "  'Sexual context can still make a clothed image adult-only:',\n",
        "  '- Do NOT add adultEroticSuggestive merely because an adult wears lingerie, shows cleavage/thighs, poses sensually, arches their back, looks at the camera, is photographed in a bedroom/boudoir setting, or uses glamorous/provocative styling. Ordinary solo boudoir is general content.',\n"
        "  '- For a solo adult, require overt sexual behavior, direct sexual touching, use of a sex toy, or an unmistakable simulated sex act before adultEroticSuggestive is warranted. Sensual presentation alone is not enough.',\n"
        "  '- For interacting adults, clearly sexualized interaction can warrant adultEroticSuggestive even when everyone remains covered, for example straddling while making out, sexualized buttock/crotch grabbing, kneeling at the crotch of another adult, a face positioned between the legs of another adult, or comparable simulated sexual interaction. This still does NOT make adultDecision explicit unless the sexual act itself is visibly evidenced.',\n",
    ),
    (
        "  '- Do not infer masturbation, stimulation or penetration from arousal, wetness, bodily fluid, pose, framing or a genital close-up alone. The act itself must be visibly evidenced.',\n",
        "  '- Do not infer oral sex or another explicit act merely from body position. A head/face near a clothed crotch, between thighs, kneeling near a crotch, a hand near a waistband, or another strongly suggestive position is NOT explicit when genital contact or the act itself is obscured by clothing, bodies, framing or crop. Use adultDecision=\"none\" plus adultEroticSuggestive when the context is clearly sexual but the act is not visibly evidenced.',\n",
    ),
]

for needle, addition in insertions:
    if addition.strip() in text:
        continue
    if needle not in text:
        raise SystemExit(f'Candidate tuning insertion point missing: {needle.strip()}')
    text = text.replace(needle, needle + addition, 1)

path.write_text(text)
print('Candidate boudoir/erotic boundary tuning applied.')
