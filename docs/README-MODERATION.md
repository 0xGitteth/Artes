# Artes moderatieonderzoek

Dit bestand is het navigatiepunt voor de vele moderatiedocumenten in `docs/`. Het verplaatst of verwijdert de bestaande documenten niet. In een Codespace met de lokale opruiminstelling worden de bestanden die beginnen met `moderation-` onder deze hoofdpagina gegroepeerd in de VS Code-verkenner.

## Bronnen en rechten

- [Bronnenstrategie, versie 2](moderation-dataset-source-strategy-v2.json)
- [Externe beeldbronnen en gebruiksrechten](moderation-external-image-sourcing-v1.md)
- [Bijdragers en toestemming](moderation-contributor-authorized-intake-v1.md)
- [Leeftijdscontrole](adult-subject-age-attestation-v1.md)

## Training, beoordeling en onafhankelijke test

- [Beeldselectie en onafhankelijke test](moderation-independent-holdout.md)
- [Overgang van onderzoek naar productie](moderation-production-transition-checklist.md)
- [Bronnenonderzoek naar expliciete inhoud](moderation-explicit-source-scouting-v1.md)

Alle geautomatiseerde experimenten, ZIP-archieven, beoordelingen en lokale modelbestanden horen in de door Git genegeerde map:

`.tmp/Artes_Moderatie_Onderzoek/`

De tientallen andere `moderation-*.json` en `moderation-*.md` in deze map blijven onder versiebeheer in Git. Verwijder of verplaats ze niet alsof het tijdelijke bestanden zijn: eerdere scripts en besluitvorming kunnen naar hun oorspronkelijke paden verwijzen.

**Let op:** onderzoeksresultaten zijn geen toestemming om de live moderatie aan te passen. Foto's, modelgewichten, per-beeld scores en rechtenverklaringen blijven privé in Codespaces.
