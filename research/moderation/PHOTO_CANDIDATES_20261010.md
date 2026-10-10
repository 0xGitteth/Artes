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


## Geen automatische detectoren voor trainingslabels

De broncategorieën zijn uitsluitend vindplaatsen en zijn geen vastgestelde moderatielabels. Er wordt **geen** bestaand moderatiemodel gebruikt om nieuwe trainings- of testbeelden van referentielabels te voorzien. Dat gebeurt onafhankelijk, via visuele beoordeling en daarna bevestiging door de gebruiker.

De foto's staan in de `.tmp` van de Codespace. GitHub codeinzage geeft geen toegang tot die lokale beeldpixels, dus eerst een bundel voor onafhankelijke visuele inspectie maken:

```bash
cd /workspaces/Artes
git fetch origin chatgpt/moderation-photo-candidates-20261010
git show FETCH_HEAD:scripts/create_moderation_contact_sheets_20261010.py | python3 -
```

Hiermee komt `Artes_contactvellen_20261010.zip` in de map boven `public-photo-candidates-20261010/`. Upload dat contactvellenbestand privé in het gesprek, zodat ChatGPT de beelden werkelijk kan bekijken. Het bevat 4 × 4 miniaturen per pagina, een afbeeldings-ID per miniatuur en een `index.csv`. Het script verandert de oorspronkelijke dataset of beoordelingen niet.

Zodra visuele beoordelingen zijn opgesteld, kan `assistant-visual-prefill.json` worden opgeslagen naast `unreviewed-images.jsonl` met formaat:

```json
{
  "method": "assistant_manual_visual_review",
  "items": [
    {
      "id": "ms-123456",
      "nudity": "female_bare_breasts",
      "sexualContext": "none",
      "ageSafety": "adult_clear"
    }
  ]
}
```

De beoordelingsinterface toont zulke voorstellen voor correctie maar markeert niets als door de gebruiker bevestigd.

## Potentiële aanvullende NSFW bron

Een aparte publieke dataset `x1101/nsfw-full` bevat volgens de datasetkaart 126 afbeeldingen. Het importscript kan maximaal 80 daarvan als **onbeoordeelde** kandidaten toevoegen. De dataset heet NSFW, maar dat bewijst niet dat een individueel beeld een seksuele handeling toont. Daarom krijgen ze nadrukkelijk geen `explicit_act` label op basis van herkomst.

```bash
git fetch origin chatgpt/moderation-photo-candidates-20261010
git show FETCH_HEAD:scripts/import_explicit_photo_candidates_20261010.py | python3 - --limit 80
```

Dit downloadt indien bereikbaar een bronarchief van circa 296 MB en importeert alleen beeldbestanden. Geen toegangsbypass, geen bestaande beoordelingslabels gewijzigd. De import is nog niet uitgevoerd.
