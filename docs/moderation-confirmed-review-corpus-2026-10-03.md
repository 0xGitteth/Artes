Alle 141 beoordelingen zijn ontvangen en gecontroleerd. Beide oorspronkelijke JSON-bestanden zijn behouden.

Er zijn 126 bevestigde foto's en 15 uitgesloten covers of collages. Alle 141 afbeeldingshashes komen exact overeen met de bestanden uit de bestaande pakketten. Het eerdere pakket met 78 afbeeldingen is zelfstandig teruggevonden. Er is geen extra upload of herbeoordeling nodig voor deze controle.

| Naaktheidslabel | Bevestigde foto's |
| --- | ---: |
| Geen | 27 |
| Ondergoed of zwemkleding | 9 |
| Implied nude | 0 |
| Blote billen | 1 |
| Ontblote vrouwelijke borsten | 1 |
| Zichtbare genitaliën | 67 |
| Mannelijk bovenlichaam | 21 |

De twee beoordelingsbestanden gebruiken dezelfde 21 bronsets. Ze mogen daarom niet als onafhankelijke training en test worden verdeeld. Er zijn geen identieke opgenomen bestanden of conflicterende labels op identieke bestanden.

De actuele contextlabels zijn: 37 zonder seksuele context, 46 suggestief, 1 BDSM/kink en 42 expliciete handeling. Dit volgt uit de ontvangen bestanden. De oudere terminalsamenvatting is geen vervanging voor deze labels.

Bestaande opmerkingen en onzekerheidsvelden zijn behouden. Dat omvat ook de strings `Toys`, `toys` en `Toye`; deze zijn niet stilzwijgend verwijderd of naar nieuwe menselijke labels omgezet. De 42 rijen met tekst in dat veld zijn niet automatisch 42 nieuw te beoordelen foto's.

De modeltoets is uitgebreid naar alle 126 bevestigde foto's. De grote NudeNet-variant komt bij de eerder gekozen diagnostische grens van 0,25 op 74 van 99 exacte labels voor foto's met een label anders dan `none`, en herkent 55 van 67 genitalia-labels. Bij één van de 27 foto's met `none` ziet hij onterecht blootstelling. Geen detectie wordt onzeker genoemd; dat wordt niet als toestemming behandeld. Het model beoordeelt geen seksuele handeling of leeftijd.

Een afzonderlijke, vastgezette SigLIP 2-proef met zeven vooraf geschreven labelbeschrijvingen komt op 56 van 126 exacte labels. Hij noemt slechts 24 van 60 gewone CC0-controlebeelden `none`. Deze concrete proef is onvoldoende voor moderatie en wordt niet gekoppeld aan Artes. De berekening is op een echt beeld vergeleken met de officiële model-forward; de scores stemmen overeen. De beschrijvingen zijn niet op de uitkomst aangepast.

DINOv2-kenmerken voor 306 beelden zijn klaar: alle 126 bevestigde onderzoeksfoto's en de eerdere 180 licentiekandidaten. De al berekende 243 vectors zijn ongewijzigd hergebruikt. De nieuwe 63 hebben dezelfde vastgezette modelversie, correcte hashes en genormaliseerde vectors van 768 dimensies.

Dit is nog geen getrainde eigen classifier. De onderzoeksbeelden zijn niet automatisch tot trainingsinput gepromoveerd. De nieuwe licentiekandidaten hebben nog assistentlabels en niet alle overige goedkeuringen. De bestaande zevenklassenopzet mist bovendien trainingsdekking in meerdere klassen. Productie en je oorspronkelijke beoordelingen zijn ongewijzigd.

Primaire modelbron: https://huggingface.co/google/siglip2-base-patch16-224
