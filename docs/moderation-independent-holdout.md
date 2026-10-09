# Onafhankelijke moderatietest: alleen lokaal en met toestemming

**Doel.** Controleren of de op 375 eerdere beelden getrainde LukeJacob + RedDesert-classificatie nieuwe artistieke naaktbeelden, BDSM en expliciete handelingen correct onderscheidt, zonder nieuwe labels of drempels uit de eindtest te leren.

**Belangrijk:** de bestaande 375 beelden mogen niet opnieuw als onafhankelijke eindtest worden beschouwd, ook niet na een andere indeling. De 103 bestaande brongroepen zijn uitgesloten. De bronmodellen zelf kunnen onbekende overlap hebben met publieke trainingsdata; ook daarom is dit geen automatische vrijgave van het model.

Deze workflow downloadt geen testfoto's. Gebruik alleen afbeeldingen waarvoor je expliciet het recht hebt om ze voor deze analyse te gebruiken, waarbij betrokken personen aantoonbaar meerderjarig zijn (als mensen zichtbaar zijn). Gebruik geen materiaal van minderjarigen. Controleer bronfamilie, maker, sessie en varianten: een andere bestandsnaam is niet voldoende. Alles blijft in `.tmp` binnen de bestaande privéomgeving; nooit naar de GitHub-repository pushen.

## Gebruik

Leg nieuwe, toegestane testfoto's in deze bestaande Codespace-map:

```
/workspaces/Artes/.tmp/moderation-independent-holdout/images/
```

Haal de onderzoeksbranch op en genereer daarna een **nog ongelabeld** privémamifest:

```bash
cd /workspaces/Artes
git fetch origin chatgpt/moderation-multidetector-shadow
git show FETCH_HEAD:vision-service/run_independent_holdout.sh | bash -s -- scan
```

Dit maakt `.tmp/moderation-independent-holdout/holdout-draft.json`. Vul in **voor er voorspellingen worden gedaan** per afbeelding:

* `sourceGroup`: unieke, niet-identificeerbare code voor maker/opnamesessie/bronsamenhang. Beelden uit dezelfde familie krijgen dezelfde code.
* `sexualContext`: uitsluitend `none`, `suggestive`, `bdsm_kink` of `explicit_act`, op basis van je eigen menselijke Artes-moderatierichtlijnen.
* `nudity`: `none`, `implied_nude`, `bare_buttocks`, `female_bare_breasts` of `genitalia`.
* `adultSubjectsVerified`: `true` alleen als alle afgebeelde personen volwassenen zijn, of de afbeelding geen personen bevat.
* `useRightsConfirmed`: `true` alleen na expliciete toestemming/licentie voor dit onderzoeksgebruik.
* `rightsEvidenceRef`: verwijzing naar je **lokale** onderbouwing van gebruiksrechten, zonder die te delen.
* `artesResearchNoveltyConfirmed`: `true` alleen na controle dat de beelden en dezelfde opname-/bronfamilies **niet** gebruikt zijn in eerder Artes-onderzoek.
* `independenceNote`: eigen beknopte uitleg waarom de bron nieuw en onafhankelijk is.

Het script laat `sexualContext` expres leeg: voorspelde etiketten van de te testen AI vooraf invullen zou de onafhankelijkheid van de labels schaden. De scriptcontrole vergelijkt exacte SHA-256 en visuele dHash met de bestaande 375 beelden; dat ontdekt een deel, niet alle, nabewerkte duplicaten. Ook bronafkomst moet je onafhankelijk controleren.

**Vergrendel** de menselijke beoordelingen voordat je het model laat kijken:

```bash
git fetch origin chatgpt/moderation-multidetector-shadow
git show FETCH_HEAD:vision-service/run_independent_holdout.sh | bash -s -- seal
```

De privébestanden `holdout-sealed.json` en `holdout-intake-aggregate.json` worden gegenereerd. Bij fouten rond rechten, annotaties, exacte duplicaten, near-duplicates of hergebruikte brongroepen wordt niet vergrendeld. De labels van het vergrendelde bestand worden niet aangepast voor een betere score. De sealed manifest-hash beschermt tegen onbedoelde wijzigingen.

**Evalueer** het vooraf geselecteerde model met de in de ontwikkelfase gekozen `0.25`-grenswaarde:

```bash
git fetch origin chatgpt/moderation-multidetector-shadow
git show FETCH_HEAD:vision-service/run_independent_holdout.sh | bash -s -- evaluate
```

De evaluatie gebruikt uitsluitend lokaal eerder gedownloade, vastgepinde modellen en de bestaande, bevroren private classificatielagen. Als iets ontbreekt stopt de test zonder een nieuw model te downloaden. Scores per beeld, rechten en labels blijven in de `.tmp`-map. De enige deelbare uitkomst is:

```
.tmp/moderation-independent-holdout/holdout-independent-aggregate.json
```

Deze samenvatting vergelijkt Luke, RedDesert en de combinatie op nieuwe menselijke labels, herkende expliciete handelingen, gemiste expliciete handelingen, foutmeldingen voor artistiek naakt, AUC en de statistische ondergrens. **Geen automatische publicatie, blokkering, Gemini-vervanging of productie-integratie is toegestaan op basis van de test.**

## Interpretatie en grenzen

Dit is een vaste, individuele modelvergelijking. De daadwerkelijke moderatiewachtrij van Artes heeft ook SafeSearch, bestaande beslissingen, veiligheidsredenen, tekstgebruik en technische fallback. Daarvoor moet later een aparte geautoriseerde replay met volledig bron- en routingbewijs worden uitgevoerd. Privacygevoelige logs en individuele modeluitvoer worden nooit naar deze chat of GitHub gestuurd.

De huidige releasevoorwaarden in `functions/moderationCustomDetector.js` gelden onverkort. Ten minste 100 testvoorbeelden en 20 onafhankelijke brongroepen per automatisch geautoriseerde klasse zijn slechts minimale aantallen, geen garantie om de statistische ondergrens voor precisie te halen. De test wordt pas gebruikt om een besluit te ondersteunen als de validatie op inhoud, herkomst, representativiteit, rechten, privacy en onafhankelijkheid is beoordeeld.
