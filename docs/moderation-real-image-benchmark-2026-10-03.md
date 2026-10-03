De echte modelcontrole is uitgevoerd. Er is nog geen nieuwe classifier getraind of live gezet.

Twee bestaande NudeNet-detectoren zijn getoetst op de 63 beschikbare, door jou bevestigde beelden. Bij dezelfde diagnostische scoregrens van 0,25:

| Detector | Exact hetzelfde naaktheidslabel | Herkende genitalia van de 58 bevestigde gevallen | Gemiddelde CPU-tijd per beeld |
| --- | ---: | ---: | ---: |
| 320 | 44/63 | 43/58 | 0,023 seconden |
| 640 | 47/63 | 46/58 | 0,462 seconden |

Ook samen missen ze nog 10 van de 58 genitalia-labels. Geen van beide detecteert blootstelling in de 60 gewone CC0-controles. Die controles hebben assistentlabels en zijn geen onafhankelijk bevestigde gouden testset. De 63 menselijke beelden zijn kleine previews van 133 × 200 of 200 × 133 pixels, en zijn sterk geconcentreerd op één klasse. Deze uitkomst bewijst geen algemene modelnauwkeurigheid. Geen detectie betekent onzeker, geen automatische toestemming. Seksueel contact, leeftijdsrisico en gevoelige context worden hiermee niet beoordeeld.

Voor de afgesproken DINOv2-classifier zijn echte beeldkenmerken van 243 beelden berekend: de 63 bestaande onderzoeksbeelden en 180 kandidaten met een commercieel bruikbare auteursrechtlicentie. Alle vectors hebben 768 dimensies, gebruiken dezelfde vastgezette modelversie en zijn gecontroleerd op hashes en normalisatie. Dit zijn modelinvoer en geen getrainde classificatielabels. De lokale Artes-inferentie is met een echt beeld getest: HTTP 200, dezelfde vector als in de voorbereiding en terecht geen detectorresultaat zonder getrainde classifier.

De oorspronkelijke 63 beoordelingen zijn byte voor byte behouden. Het bestand met jouw andere 78 afgeronde beoordelingen staat nog alleen in Codespaces:

`.tmp/moderation-research-discovery/professional-adult-b2b-public-catalog-v1/balanced-target-scene-labels.reviewed.json`

Dat JSON-bestand is nodig om jouw volledige beoordeling mee te nemen. Geen van deze beelden hoeft opnieuw beoordeeld te worden. Het delen van dit bestand keurt onderzoeksbeelden niet automatisch voor training goed.

De nieuwe kandidaten zijn nog niet als menselijke trainingslabels bevestigd. De bestaande onderzoeksstatus en ontbrekende goedkeuringen blijven behouden. Ook de commercieel gelicentieerde selectie is nog onvoldoende verdeeld over de zeven naaktheidsklassen. Er is dus geen grond om nu een betrouwbare automatische moderator te claimen.

De geïnstalleerde NudeNet-licentie is AGPL-3.0, terwijl de pakketmetadata MIT vermeldt. De modelcontrole blijft een afzonderlijke lokale proef. De grotere modeldownload komt uit een publieke spiegel, met vastgelegde hash en dezelfde bestandsgrootte als de officiële release; identieke bytes met de officiële release zijn niet bewezen.

De resultaten, vectors en bronstatus zijn bewaard voor het vervolg. Het checkpoint bevat geen originele afbeeldingsbytes en verleent geen trainings- of productiegoedkeuring.
