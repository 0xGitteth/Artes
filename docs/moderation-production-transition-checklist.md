# Artes moderatie: van onderzoeksresultaat naar betrouwbare automatisering

**Status 9 oktober 2026:** uitsluitend onderzoek. Geen productieaanpassing, geen nieuw betaalde API, geen toestemming voor automatische vrijgave, blokkering of beëindiging van Gemini.

## Wat we werkelijk weten

Dezelfde 375 eerder beoordeelde ontwikkelfoto's (103 brongroepen, 41 expliciete handelingen, 334 niet-expliciete beelden, 168 toegestane naaktbeelden) zijn gebruikt voor lokaal getrainde classifiers op bestaande LukeJacob- en RedDesert-scores. Vier folds scheidden brongroepen in de training en evaluatie. Dit is geen ongebruikte onafhankelijke eindtest; de voorbeelden zijn eerder bekeken en een oudere Luke-drempel is zelfs op deze voorbeelden afgestemd.

Bij onderzoeksdrempel 0,25 detecteerde de gecombineerde classifier 41/41 expliciete handelingen en markeerde ook 57/334 niet-expliciete beelden (33/168 toegestane naaktbeelden). Er zouden dus 98 van de 375 beelden voor **mogelijke** seksuele controle worden gemarkeerd. Dat is geen schatting van de echte `reviewCases`-instroom in Artes, omdat SafeSearch, eerdere moderatorbesluiten, andere veiligheidslabels, fouten, cache en beleid ook routeren. LukeJacob met eerder afgestemde rauwe drempel markeerde 41/41 plus 78/334; dit is geen onafhankelijke eerlijke modelvergelijking.

* Bij hetzelfde onderzoek onderscheidde Luke op basis van scores `suggestive` beter dan de gecombineerde classifier; RedDesert scoorde beter op `bdsm_kink`. Met slechts 10 BDSM-afbeeldingen is dat onzeker.
* Geen RedDesert-categorie (`x`, `q` enzovoort) mag zomaar als bewijs van een expliciete seksuele handeling gelden.
* 41 waargenomen successen op 41 voorbeelden geven niet voldoende zekerheid over fouten op nieuwe uploads.

## Bestaande beveiliging in de daadwerkelijke Artes-code

* `functions/moderationPolicy.js`: een betrouwbare custom detector kan seksuele classificatie aandragen, maar een ernstige tegenspraak met Google SafeSearch veroorzaakt nog steeds handmatige beoordeling. Veiligheidsblokkades, eerdere moderatiebesluiten en andere signalen blijven bestaan.
* `functions/moderationCustomDetector.js`: zonder goedgekeurde model- en datasetversies geldt **fail closed**. Voor iedere automatisch toe te kennen klasse verlangt de huidige code minimaal 20 onafhankelijke brongroepen, 100 testvoorbeelden, nul kritieke missers en een 0,99 ondergrens van precisie; drempelconfidence moet minimaal 0,9 zijn. Onzekere, mogelijke minderjarigen en specifieke gevoelige contexten vereisen handmatige afhandeling.
* `functions/moderationRuntimeProvider.js`: staging mag geen generatieve provider in de primaire flow gebruiken; productie blijft op zijn bestaande configuratie. Het onderzoeksresultaat verandert geen van beide.
* `functions/index.js` combineert bovendien SafeSearch, labeldetectie, hergebruik van eerder beoordeeld materiaal, Gemini/custom beslissingen en de beleidsgates. **De 57 foutsignalen in het classifieronderzoek zijn niet gelijk aan 57 daadwerkelijke moderatiezaken.**

## Nu te doen (geen productie)

1. **Onderzoeksinterpretatie vastzetten.** Het auditprogramma `vision-service/audit_fusion_readiness.py` leest uitsluitend het geaggregeerde JSON, controleert de 0,25- en overige drempelmetingen en rapporteert waarom de release-gates niet gehaald zijn. Daarin staat expliciet dat 41/41 geen garantie is. Geen individuele voorspellingen of foto's delen.
2. **Veiligheid van de bestaande beslisroute beschermen.** Tests in `functions/test/moderationFusionReadiness.test.js` toetsen dat een niet-goedgekeurd model geen publicatie kan goedkeuren, dat een ernstige SafeSearch-tegenspraak nog wordt beoordeeld en dat bestaande `sexualExplicit`-redenen geblokkeerd blijven.
3. **Onafhankelijke nieuwe evaluatieset opbouwen.** Gebruik beelden waarvan geen varianten, makers, opnameseries of near-duplicates in de 375 ontwikkelbeoordelingen of de externe ontwikkelonderzoeken zitten. Leg rechten/toestemming, labels, bronfamilie, split en status vast. Bevries modelkeuze en scoregrenzen vóór het bekijken van de eindtest. De huidige policy verlangt per geautoriseerde klasse minstens 100 onafhankelijke voorbeelden en minstens 20 brongroepen; ook alle kritieke categorieën moeten worden gecontroleerd. Een kleine onafhankelijke verkenning mag eerder, maar verleent geen toestemming tot automatische moderatie.
4. **Echte moderatiewachtrij meten.** Voeg later een geautoriseerde, uitsluitend geaggregeerde replay toe die de huidige `reviewCases`-aanleidingen en andere policy inputwaarden meeneemt. Zonder SafeSearch-, safety-, Gemini- en historisch-review-signalen kan een score-only-experiment dit niet eerlijk reconstrueren. Geen individuele foto's, private scores of tokens uploaden. Voor live of accountdata eerst privacytoets en expliciete toestemming.
5. **Losse schaduwtest en gefaseerde uitrol.** Pas na onafhankelijke calibratie het als `artes_custom_vision` passende, versiegecontroleerde contract aan; begin zonder publicatiebevoegdheid. Test realistische CPU-tijd, kosten en p95 vertraging, minimaal false negatives, ongewenste art-nude review, safety overrides, fallback en rollback. Vraag afzonderlijke goedkeuring voor staging-/productiewijzigingen.

## Niet doen

* Geen Geminiverwijdering, live moderatie-overname, productieconfiguratie of verandering van Artes' propriëtaire licentie.
* Geen automatische blokkering op naakt, `porn`, `x` of `q` zonder beleids- en contextbewijs.
* Geen optimalisatie en vervolgens 'onafhankelijk testen' op dezelfde 375 of opnieuw ingestelde scoregrenzen.
* Geen claim '0% gemist' op nieuwe afbeeldingen op grond van 41/41 ontwikkelvoorbeelden.

**Beslismoment:** pas na een echt onafhankelijke eindtest en betrouwbare, volledige beleidsreplay weten we of de combinatie daadwerkelijk de handmatige wachtrij verlaagt en welke afzonderlijke klassen überhaupt automatische beslissingen mogen nemen.
