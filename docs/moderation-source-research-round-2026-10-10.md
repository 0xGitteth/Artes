# Artes: gerichte beeldbronronde, 10 oktober 2026

**Status: brononderzoek, geen downloads en geen test- of trainingsgoedkeuring.** Dit is de concrete shortlist na de mislukte Flickr-only proef (0 kandidaten). De eerdere richtlijnen in `moderation-dataset-source-strategy-v2.json` en `moderation-external-image-sourcing-v1.md` blijven leidend. Gebruik echte hedendaagse fotografie, verschillende makers/opnameseries, geen AI-beelden, geen twijfelachtige leeftijden, geen generieke stockvulling en onafhankelijke rechtencontrole. Deze shortlist is nog niet tegen eerdere datasets gededupliceerd.

## Individuele fotoverwijzingen met aangetroffen primaire bron

| Foto | Verwachte dekking (zoekhint, geen menselijk modelabel) | Bron & auteur | Rechtenstatus | Volgende noodzakelijke controle |
| --- | --- | --- | --- | --- |
| [Persoon met gedeeltelijk ontblote borst en ritueel kostuum](https://wordpress.org/photos/photo/59368adeef/) | hoge huidblootstelling, fashion/creatief grensgeval | WordPress Photo Directory, Guste Cibulskyte, augustus 2025 | fotograaf vermeld, CC0 op oorspronkelijke fotopagina | identiteit/volwassenheid/toestemming model; geen expliciete handeling |
| [Ouder stel in zwemkleding op strand](https://wordpress.org/photos/photo/9246884ae7/) | zwemkleding, huidblootstelling, niet-expliciet | WordPress Photo Directory, Nilo Velez, juli 2025 | oorspronkelijke pagina zegt CC0 | persoonsrechten en opnamefamilie |
| [Twee personen in vrijetijdskleding](https://wordpress.org/photos/photo/326878b124/) | niet-expliciete koppel- en modecontext | WordPress Photo Directory, Sumi Subedi, juli 2025 | oorspronkelijke pagina zegt CC0 | leeftijd en persoonsrechten, visual check |
| [Traditionele kleding en portret in landschap](https://wordpress.org/photos/photo/5716807371/) | bedekte fashioncontrole, echte fotografie | WordPress Photo Directory, Yam B Chhetri, april 2025 | oorspronkelijke pagina zegt CC0 | modeltoestemming en representativiteit |
| [Fashiondetail hand met nagels](https://wordpress.org/photos/photo/43069730b5/) | volledig niet-expliciete bodypart/detailcontrole | WordPress Photo Directory, rubyojha, januari 2026 | oorspronkelijke pagina zegt CC0 | authenticiteit en gebruiksrechten, minimale persoonsherkenbaarheid |
| [Naakt mannelijk zelfportret in zwart-wit](https://commons.wikimedia.org/wiki/File:Black_and_white_nude_man_boudoir_self_portrait_standing_body_scape.jpg) | artistiek mannelijk naakt | Commons, zelfportret van Gfnoah25 / Rowan, opname 2025 | **CONFLICT**: beschrijving vermeldt niet-commercieel gebruik terwijl Commons CC0 aanduidt | niet gebruiken tot expliciete, consistente toestemming/licentie en volwassenheid zijn bevestigd |
| [Naakte man op 73e verjaardag](https://commons.wikimedia.org/wiki/File:Nude_man_on_73rd_birthday.jpg) | mannelijk naakt en oudere lichaamsvariatie, niet-expliciet | Commons, auteur Rosemary65, maart 2025 | Commons vermeldt CC0 | bevestiging van toestemming afgebeelde persoon voor ML en herkomst, geen eindtest zonder onafhankelijkheid |

**Dit zijn zeven concrete verwijzingen, niet zeven goedgekeurde afbeeldingen.** De WordPress-fotopagina's tonen de opgegeven oorspronkelijke fotografen en CC0; model/portretrechten, feitelijke leeftijd en expliciete ML-toestemming blijven apart te verifiëren. De genoemde afbeeldingen zijn **niet** aangetoond nieuw t.o.v. de eerdere 375 Artes-beelden, bijbehorende opnameseries of de voortrainingsdata van de basismodellen.

## Verdere bronpools: waarom wel of niet

| Bronpool | Wat daadwerkelijk is nagegaan | Inzet en blokkade |
| --- | --- | --- |
| [WordPress Photo Directory](https://wordpress.org/photos/) en [regels](https://wordpress.org/photos/guidelines/) | echte fotografie, groot open CC0-aanbod; individuele pagina's met makers en omvang gevonden | geschikte niet-expliciete controles; ontbrekende modeltoestemming verifiëren; brondiversiteit nodig |
| [Nappy](https://nappy.co/terms) en [NappyStock](https://nappy.co/user/NappyStock) | CC0, eigentijdse, diverse echte portretten; platform waarschuwt zelf dat portret-/privacyrechten niet door CC0 worden opgeheven | kandidaten voor portret en zwemkleding; de dienst kondigt bovendien sluiting in de komende maanden aan, dus niet als duurzame exclusieve bron beschouwen |
| [Shutterstock Data Licensing](https://www.shutterstock.com/data-licensing) | specifieke data-/AI-licenties, matching op rechten en labelmetadata; gewone Shutterstock-beeldlicenties **verbieden** training | contract-/offertekanaal voor release-gecontroleerde modellen; geen gratis trainingsbank, aanbod van expliciete scènes onbevestigd |
| [AdultLabs AI-licentie](https://adultlabs.com/license/16) | licentie noemt AI-training en modellen-/ID-documentatie en regio-/domeinbeperkingen; focus AI-generatie | **geen** automatische goedkeuring voor Artes als expliciet-handeling-detectiemodel; classificatietraining, opslag, doel, hoeveelheid, hergebruik en wetgeving schriftelijk laten bevestigen |
| [DeviantArt en directe fotografen](https://www.deviantart.com/) | route voor directe toestemming, geen vrij scrape-recht | relevant voor boudoir/artistiek naakt/niet-expliciete BDSM, maar pas met specifiek werk, fotograaf en model release |
| [Openverse](https://openverse.org/) | indexeert externe bronnen en heeft in eerdere proeven ook oud kunstwerk als 'photograph' teruggegeven | uitsluitend vindmachine, geen bewijs van auteurschap/modeltoestemming, geen Wikimedia-only verzamelroute |

## Gaten die brononderzoek nog moet oplossen

- Niet-expliciete professionele boudoir- en hedendaagse vrouwelijke naaktfotografie, met model- en creator consent.
- BDSM/contextgrensgevallen zonder automatisch te veronderstellen dat bondage een verboden seksuele handeling is.
- Echte expliciete seksuele handelingen met aantoonbaar meerderjarige modellen en expliciete contractuele toestemming voor een **detectie- / moderatieclassifier**. Deze ronde heeft daarvoor **nul goedgekeurde beelden** opgeleverd. Open catalogus, preview of AI-generatielicentie is niet genoeg.
- Meer onafhankelijke makers, belichting, lichaamsvariatie en genres, en bewijs dat beelden niet van dezelfde foto-/opnameserie als de ontwikkeldata komen.
- Een ongebruikte eindtest mag niet achteraf op basis van modelvoorspellingen worden geannoteerd of om de score te verhogen bijgeschaafd.

**Onderzoeksdiscipline:** geen foto's in GitHub of deze chat, geen bulkdownload, geen per-image scores, geen aanpassingen aan live Artes-moderatie. Eerst bron- en rechtencontrole, dan menselijke labels vóór modeltest, vervolgens bronfamilie- en dHash-deduplicatie lokaal en scheiding ontwikkeling versus onafhankelijke test. Mogelijke direct-creator-licentie is geen bewijs van rechten totdat ze daadwerkelijk akkoord zijn.
