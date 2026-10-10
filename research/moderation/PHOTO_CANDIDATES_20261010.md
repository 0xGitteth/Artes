# Artes: openbare fotokandidaten, 10 oktober 2026

Dit is een **nieuwe kandidatenlijst**, geen trainingsdataset. Bestaande beoordelingen en code zijn niet gewijzigd.

* `photo-candidates-20261010.json`: 510 individuele vindplaatsen en rechtstreekse afbeeldings-URL's, afkomstig uit openbare galerijen buiten Wikimedia.
* `../../scripts/download_moderation_photo_candidates_20261010.py`: haalt maximaal 350 bestanden op (instelbaar), spreidt de selectie over de categorieën, verwijdert exacte duplicaten en maakt een apart manifest.
* Bestaande datasets, annotaties en labels worden nooit gewijzigd.
* Categorienaam volgt de brongalerij; individuele foto's zijn **nog niet beoordeeld of geclassificeerd**.
* De lijst bevat artistiek naakt, mannelijk naakt, frontaal naakt en boudoir. Expliciete seksuele handelingen zijn hiermee nog niet voldoende vertegenwoordigd.

## Starten in deze branch

```bash
python3 scripts/download_moderation_photo_candidates_20261010.py --limit 350
```

De beelden verschijnen onder `.tmp/moderation-research-discovery/public-photo-candidates-20261010/`, met `download-results.json` en `unreviewed-images.jsonl`.

Een HTTP-fout of toegangsblokkade wordt gerespecteerd en als overgeslagen gerapporteerd. De afbeeldingen worden niet in Git gecommit. Beschikbaarheid en downloadbaarheid kunnen veranderen.

Aanvullende potentiële expliciete bronnen (niet gedownload): https://huggingface.co/datasets/deepghs/nsfw_detect (toegang vereist acceptatie) en https://huggingface.co/datasets/markandey14/nsfw. Controle op geschiktheid en individuele labels moet nog volgen.


## Lokale fotobeoordeling met autosave

Vanuit de Codespace kun je met de aparte review-app **de bestaande foto's bekijken zonder eerdere beoordelingen te beïnvloeden**:

```bash
git fetch origin chatgpt/moderation-photo-candidates-20261010
git show FETCH_HEAD:scripts/review_moderation_photo_candidates_20261010.py | python3 -
```

Open in VS Code **Ports > 8794 > Open in Browser**. Je ziet telkens 35 afbeeldingen, kunt vergroten, filteren op brongalerij en afzonderlijk naaktheid, seksuele context en leeftijdscontrole vastleggen. De voortgang wordt direct opgeslagen onder `photo-review-progress.json` in dezelfde lokale map als de afbeeldingen. Er is een knop om de voortgang te exporteren.

De **brongalerij wordt standaard getoond, maar vormt geen automatisch inhoudelijk label**. Om te voorkomen dat duidelijk naakt onterecht als `implied_nude` wordt bestempeld, worden labels niet gegokt op basis van galerijnamen. Voor daadwerkelijke labelvoorstellen is nog visuele classificatie nodig. Uitgesloten of onzekere leeftijd wordt niet goedgekeurd.
