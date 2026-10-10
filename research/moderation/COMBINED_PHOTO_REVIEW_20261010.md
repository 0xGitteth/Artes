# Artes: een gecombineerde visuele beoordelingsronde

Stand 10 oktober 2026. Bestaande bestanden: 350 nieuwe creatieve foto's, onafhankelijk visueel voorgelabeld vanuit 22 contactvellen. Aanvulling: 108 openbare onderzoeksfoto's uit [alexookah/Deep-Learning-Porn-Detection](https://github.com/alexookah/Deep-Learning-Porn-Detection/tree/master/less_images/porn) (100) en [test_images/porn](https://github.com/alexookah/Deep-Learning-Porn-Detection/tree/master/test_images/porn) (8). De 108 zijn ook rechtstreeks visueel bekeken en NIET door een moderatieclassifier ingedeeld.

## Resultaat van de aanvullende onafhankelijke visuele beoordeling

- `explicit_act`: 58 beeldvoorstellen.
- `suggestive`: 42.
- `bdsm_kink`: 3.
- `none`: 5.
- 45 foto's verdienen aanvullende detailcontrole vanwege de lage bronresolutie of onduidelijke visuele context.
- Bij 56 foto's is de leeftijd niet afdoende af te leiden uit de beschikbare uitsnede, inclusief één duidelijke uitsluitingswaarschuwing. Dit zijn nog geen leeftijdsgecontroleerde trainingsgegevens.
- Het materiaal bevat oude, sterk gecomprimeerde video stills en soms meerdere frames uit dezelfde scène. Voor een definitieve testset moeten scènes/performers worden gescheiden, niet willekeurig individuele frames.

**Dit zijn voorstellen, geen trainingslabels die al door de gebruiker zijn bevestigd.** Een mapnaam `porn` betekent niet automatisch dat elke afbeelding `explicit_act` toont.

## Eén keer de gezamenlijke beoordelingsomgeving openen

In de bestaande Codespace, zonder branch te wisselen:

```bash
cd /workspaces/Artes
git fetch origin chatgpt/moderation-photo-candidates-20261010
git show FETCH_HEAD:scripts/prepare_combined_photo_review_20261010.sh | bash
```

Het script voegt maximaal 108 afbeeldingen toe aan de lokale onderzoeksmap, maakt zonodig de oorspronkelijke 350 visuele voorstellen aan, voegt de nieuwe 108 voorstellen toe, en start één lokale beoordelingsinterface op poort `8794`. Open **Ports → 8794 → Open in Browser**.

De bestaande menselijke reviews, de 350 originele bestanden, productie en modeltraining worden niet aangeraakt. De tijdelijke onderzoeksmappen blijven lokaal onder `.tmp`. De gebruiker bevestigt of wijzigt voorinvullingen in die interface, en de voortgang wordt afzonderlijk opgeslagen.

## Technische bestanden

- `research/moderation/explicit-candidates-20261010.json`: 108 bron- en directe afbeelding-URL's.
- `research/moderation/explicit-visual-prefill-20261010.json`: 108 onafhankelijke visuele voorstellen.
- `scripts/download_explicit_candidates_20261010.py`: downloadt alleen de afzonderlijke beeldbestanden.
- `scripts/merge_explicit_visual_prefill_20261010.py`: laat de originele 350 intact en voegt alleen daadwerkelijk gedownloade voorstellen toe.
- `scripts/prepare_combined_photo_review_20261010.sh`: één startcommando.

**Let op:** de eerdere optionele `import_explicit_photo_candidates_20261010.py` met de ongesorteerde x1101 NSFW verzameling hoort niet bij deze gecombineerde review. Die bron is niet ingezet voor inhoudelijke labels en het gebruik daarvan is niet nodig.
