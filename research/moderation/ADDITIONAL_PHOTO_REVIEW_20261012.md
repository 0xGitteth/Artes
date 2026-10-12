# Artes, aanvullende fotoselectie van 12 oktober 2026

## Stand

De eerste 350 creatieve foto's zijn eerder visueel voorbeoordeeld. Daarna zijn 108 aanvullende onderzoeksfoto's visueel voorbeoordeeld, waarvan 58 de voorlopige labelwaarde `explicit_act` kregen. Deze 458 zijn **voorstellen**, niet door de gebruiker bevestigde trainingslabels.

Voor de laatste aanvulling zijn nu drie aanvullende kandidatenverzamelingen beschikbaar:

| Verzameling | Vindplaatsen | Aantal kandidaten | Selectie voor download |
| --- | --- | ---: | ---: |
| BDSM/kink | Model Society, Shibari Sessions, Shibari Unravelled, Sacred Tie | 128 | tot 64 |
| Extra NSFW materiaal | x1101/nsfw-full, samo-vecto/nsfw-images | twee afzonderlijke bronarchieven | tot 72 |
| Gewone fotografie | Shopify Burst, zeven creatieve categorieën | 84 | 84 |

De 128 BDSM/kink kandidaten zijn deels afkomstig van dezelfde verzamelsite. De geselecteerde foto's zijn niet op pixelniveau gecontroleerd en de galerijnamen zijn geen detectorlabels. Voor de twee extra NSFW bronnen is niet bekend hoeveel individuele beelden werkelijk `explicit_act` tonen. Voor de gewone fotografie geldt hetzelfde: inhoudelijke `none` labels zijn nog niet bevestigd.

## Eén keer de nieuwe contactvellen voorbereiden

Deze stap dient **alleen om de nog niet visueel beoordeelde aanvulling** aan ChatGPT te tonen. Open de uiteindelijke beoordelingspagina nog niet.

In de bestaande Artes Codespace:

```bash
cd /workspaces/Artes
git fetch origin chatgpt/moderation-photo-candidates-20261010
git show FETCH_HEAD:scripts/prepare_all_new_photo_contact_sheets_20261012.sh | bash
```

Dat script:
1. Behoudt de eerste 350 foto's en de onafhankelijke labelvoorstellen.
2. Haalt de eerder visueel beoordeelde 108 foto's op als die nog niet lokaal staan.
3. Zet de al gemaakte 108 voorstellen naast de oorspronkelijke 350.
4. Downloadt een selectie van de 128 BDSM/kink kandidaten.
5. Probeert twee andere NSFW bronarchieven in een beperkte selectie.
6. Downloadt maximaal 84 gewone foto's.
7. Zet **alleen de nieuwe, nog onbeoordeelde foto's** in een ZIP met contactvellen en beeld-ID's.

Te uploaden bestand:
`.tmp/moderation-research-discovery/Artes_nieuwe_contactvellen_20261012.zip`.

ChatGPT kan de foto's pas onafhankelijk beoordelen wanneer de echte afbeeldingspixels beschikbaar zijn, bijvoorbeeld door de contactvellen hier te uploaden. Dit is geen detectorinference: er worden geen bestaande moderatiemodellen ingezet. De voorbeoordelingen van de nieuwe foto's volgen na het bekijken van de contactvellen. Daarna kan één gecombineerde review worden opgebouwd.

Bestaande labels en foto's blijven ongemoeid; er wordt niets aan een definitieve trainings- of testset toegevoegd. Definitieve splits moeten rekening houden met beelden uit dezelfde shoot of bron om ongewenste overlap tussen trainen en testen te voorkomen.
