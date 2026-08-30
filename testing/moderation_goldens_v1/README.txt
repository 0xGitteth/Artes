Deze map bevat de moderation golden tests.

Moderatiebeleid v2:
- fixtures/policy-boundary-cases.json is de bron voor de nieuwe policy unit tests.
- functions/test/moderationPolicyBoundaries.test.js test deze grenzen zonder externe AI calls.
- de v2 Gemini classifier is inmiddels gekoppeld aan de live moderation flow in functions/index.js.

De bestaande echte beeldset staat in:
- images/safe/SAFE_01.jpg
- images/boudoir/BOUDOIR_01.jpg
- images/borderline/BORDERLINE_01.jpg
- images/explicit/EXPLICIT_01.jpg

De bestanden testcases_reviewed_v3.xlsx en testcases_reviewed_v3_semicolon.csv zijn een historische baseline. Ze zijn geen uitvoerbare test en bevatten nog een ouder uitgangspunt waarin de borderline Art Nude case naar review ging.

Voor policy v2 gelden de actuele productgrenzen uit docs/moderation-policy-v2.md. Daardoor geldt in principe:
- gewone veilige content -> general allow;
- gewone boudoir/lingerie met intieme delen bedekt -> general allow;
- duidelijke of geïmpliceerde naaktheid zonder expliciete seksuele handeling -> 18+ allow, niet automatisch review;
- expliciete seksuele handelingen -> forbidden;
- echte onzekerheid of sterke tegenstrijdige safety-signalen -> review.

Er is nu een read-only real-image Gemini v2 smoke runner:

npm run golden:moderation-v2:classifier

Met --dry-run worden alleen de vier bestanden gecontroleerd en wordt geen externe AI call gedaan:

npm run golden:moderation-v2:classifier -- --dry-run

Deze dry-run is op de PR branch succesvol door GitHub Actions uitgevoerd, samen met de volledige moderation test suite, lint, build en git diff --check.

De echte Gemini call is nog niet uitgevoerd. Daarvoor is een expliciet geauthenticeerde non-production Google Cloud omgeving met Vertex AI toegang nodig. De repository heeft momenteel geen GitHub Actions authenticatie voor Vertex AI.

De smoke runner schrijft niets naar Firestore en gebruikt niet de productie moderation endpoint. Hij test alleen de echte beelden tegen de Gemini v2 classifier. SafeSearch, Firestore moderation history/review lifecycle en publication flow vallen buiten deze runner en blijven onderdeel van een volledige gecontroleerde pre-deploy E2E.

Gebruik alleen om te testen niet de productie moderation endpoint, omdat die upload/moderation state kan schrijven.

De oude XLSX/CSV baseline moet pas worden vervangen of als nieuwe v2 baseline worden vastgelegd nadat de vier beelden veilig tegen de v2 classifier/live policy zijn uitgevoerd en de resultaten handmatig zijn gecontroleerd.
