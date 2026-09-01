Deze map bevat de moderation golden tests.

Moderatiebeleid v2:
- fixtures/policy-boundary-cases.json is de bron voor de policy unit tests.
- functions/test/moderationPolicyBoundaries.test.js test deze grenzen zonder externe AI calls.
- de Gemini classifier is gekoppeld aan de live moderation flow in functions/index.js.

De echte beeldset staat in:
- images/adult/ADULT_BDSM_01.jpg
- images/boudoir/BOUDOIR_01.jpg
- images/borderline/BORDERLINE_01.jpg
- images/explicit/EXPLICIT_01.jpg

De voormalige SAFE_01 fixture bleek bij visuele en live-classifiercontrole geen algemene safe fixture te zijn maar volledig bedekte BDSM/kink content. De fixture is daarom hernoemd naar ADULT_BDSM_01 en de CSV/XLSX baseline is aangepast aan policy v2. BORDERLINE_01 is eveneens gecorrigeerd: zichtbare genitalien zonder zichtbare seksuele handeling zijn 18+ nudity en niet automatisch review of explicit.

Voor policy v2 gelden de actuele productgrenzen uit docs/moderation-policy-v2.md:
- gewone veilige content -> general allow;
- gewone boudoir/lingerie met intieme delen bedekt -> general allow;
- duidelijk erotische/suggestieve of BDSM/kink context -> 18+ allow, ook wanneer adultDecision voor nudity zelf none blijft;
- duidelijke of geïmpliceerde naaktheid zonder expliciete seksuele handeling -> 18+ allow;
- expliciete seksuele handelingen -> forbidden;
- echte onzekerheid of sterke tegenstrijdige safety-signalen -> review.

De real-image Gemini runner is een uitvoerbare golden test:

npm run golden:moderation-v2:classifier

Met --dry-run worden alleen de vier bestanden en verwachtingen gecontroleerd en wordt geen externe AI call gedaan:

npm run golden:moderation-v2:classifier -- --dry-run

De echte runner vereist ENABLE_GEMINI_CLASSIFIER=true, geauthenticeerde non-production Google Cloud credentials en GOOGLE_CLOUD_PROJECT. Hij faalt ook wanneer een geval wel technisch classificeert maar de policyverwachting mist.

De runner accepteert voor BOUDOIR_01 een Vertex provider safety block als fail-closed uitkomst, omdat de provider de beeldanalyse dan zelf weigert. De applicatie moet zo'n safety block naar review houden. Voor EXPLICIT_01 is een provider safety block eveneens een veilige fail-closed uitkomst. ADULT_BDSM_01 en BORDERLINE_01 moeten daadwerkelijk correct worden geclassificeerd zodat overblocking en de explicit/nudity grens zichtbaar blijven in deze golden test.

De runner schrijft niets naar Firestore en gebruikt niet de productie moderation endpoint. Hij test alleen de echte beelden tegen de Gemini classifier. SafeSearch, Firestore moderation history/review lifecycle en publication flow vallen buiten deze runner en blijven onderdeel van een gecontroleerde pre-deploy E2E.

Gebruik voor tests niet de productie moderation endpoint, omdat die upload/moderation state kan schrijven.
