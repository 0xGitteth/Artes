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
