# Codex dev login

Start

1. Run `nvm use 24`
2. Run `npm install`
3. Run `NODE_USE_ENV_PROXY=1 npm run dev -- --host 0.0.0.0`
4. Open de forwarded preview URL

Node 24 is required because the Codex cloud environment uses `HTTP_PROXY`/`HTTPS_PROXY` and the server-side fetch for the Codex dev-login proxy must use that proxy.

Login

1. Gebruik de knop `Codex Dev login (vast)`
2. Gebruik geen email of wachtwoord login

Verwachte flow na login

1. Na Codex Dev login kan de app door onboarding gaan
2. Dit is normaal en betekent niet dat login is mislukt
3. Ga door totdat de app bruikbaar is

Didit stap

1. Als de Didit stap een dev bypass toont, gebruik die bypass om verder te gaan

Profiel aanmaken

1. Na Didit moet een profiel worden aangemaakt
2. Kies als rol `assistent`
3. Scroll indien nodig totdat `assistent` zichtbaar is
4. Vul als naam `Codex` in
5. De overige profielkeuzes mogen vrij gekozen worden, tenzij een veld verplicht is
6. Rond onboarding af totdat de hoofdapp zichtbaar is

Rapporteren

1. Maak onderscheid tussen:
   1. login probleem
   2. onboarding gedrag
   3. profielaanmaak probleem
   4. latere configuratie of runtime fout
2. Doe geen codewijzigingen tenzij daar expliciet om wordt gevraagd
