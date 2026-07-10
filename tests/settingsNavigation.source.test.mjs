import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appSource = readFileSync(new URL('../src/ArtesApp.jsx', import.meta.url), 'utf8');
const privacySource = readFileSync(new URL('../src/components/settings/PrivacyPolicyView.jsx', import.meta.url), 'utf8');

assert.match(appSource, /const \[settingsView, setSettingsView\] = useState/, 'SettingsModal has internal navigation state');
assert.match(appSource, /Profielen beheren/, 'Settings home exposes profile management navigation');
assert.match(appSource, /Bevestigingsverzoeken/, 'Vouch requests are relabelled as Bevestigingsverzoeken');
assert.match(appSource, /onClick: onOpenVouchRequests/, 'Bevestigingsverzoeken keeps the existing callback');
assert.match(appSource, /onClick=\{onOpenSupport\}|onClick: onOpenSupport/, 'Support keeps the existing callback');
assert.match(appSource, /onClick: onOpenAppShortcutInfo/, 'App shortcut keeps the existing callback');
assert.match(appSource, /onClick: onOpenModeration/, 'Moderation keeps the existing callback');
assert.match(appSource, /onClick: onLogout/, 'Logout keeps the existing callback');
assert.match(appSource, /to="\/debug"/, 'Debug still links to /debug');
assert.match(appSource, /moderatorAccess === true/, 'Moderation visibility remains conditional');
assert.match(appSource, /debugAllowed\(\)/, 'Debug visibility still uses debugAllowed');
assert.match(appSource, /showModerationDot/, 'Moderation dot remains wired');
assert.match(appSource, /PrivacyPolicyView/, 'Privacy policy subpage is rendered');
assert.match(appSource, /Over deze testversie/, 'About test version subpage is available');
assert.match(appSource, /Thema/, 'Theme subpage is available');
assert.match(appSource, /w-\[min\(30rem,calc\(100vw-1rem\)\)\]/, 'Settings drawer uses the wider constrained width');
assert.match(appSource, /flex min-h-0 flex-1 flex-col gap-5 px-3 pt-3 pb-4 md:px-5 md:pt-5/, 'Settings home has explicit top padding and flex height containment');
assert.match(appSource, /const navDangerTitleClass = \"text-rose-600 dark:text-rose-300\"/, 'Danger navigation title receives a red text class');
assert.match(appSource, /const navDangerIconClass = \"h-4 w-4 shrink-0 text-rose-500/, 'Danger navigation icon receives a red icon class');
assert.match(appSource, /danger \? navDangerTitleClass : navNormalTitleClass/, 'Navigation title color is conditional for danger items');
assert.match(appSource, /Icon className=\{danger \? navDangerIconClass : navIconClass\}/, 'Navigation icon color is conditional for danger items');
assert.doesNotMatch(appSource, /Accountactie/, 'Logout no longer shows the Accountactie description');
assert.doesNotMatch(appSource, />Meldingen</, 'Non-functional Meldingen row is removed');
assert.doesNotMatch(appSource, />Taal</, 'Non-functional Taal row is removed');
assert.match(appSource, /Nog in te stellen/, 'Setup profiles section is renamed');
assert.match(appSource, /Organisatieprofielen/, 'External profiles section is renamed');
assert.match(appSource, /Organisatieprofiel toevoegen/, 'Add profile CTA is renamed');
assert.match(appSource, /NOG NIET OPENBAAR/, 'Setup profile status copy is present');
assert.match(appSource, /Je beheert nog geen andere bedrijfsprofielen, agencies of collectieven\./, 'Empty state with setup profile is present');
assert.match(appSource, /Je beheert nog geen bedrijfsprofielen, agencies of collectieven\./, 'Empty state without setup profile is present');
assert.doesNotMatch(appSource, /sm:flex-row sm:items-start sm:justify-between/, 'Profile cards no longer rely on viewport flex-row breakpoints in settings');

for (const [viewName, title] of [
  ['theme', 'Thema'],
  ['about', 'Over deze testversie'],
  ['privacy', 'Privacybeleid'],
  ['profiles', 'Profielen beheren'],
]) {
  const viewPattern = new RegExp(`const render${viewName[0].toUpperCase()}${viewName.slice(1)} = \\(\\) => \\(\\n\\s+<div className=\"flex min-h-0 flex-1 flex-col\">[\\s\\S]*?renderHeader\\('${title}'\\)[\\s\\S]*?<div className=\"min-h-0 flex-1[^\"]*overflow-y-auto[^\"]*no-scrollbar`, 'm');
  assert.match(appSource, viewPattern, `${title} uses a height-contained scrollable content container`);
}
assert.doesNotMatch(appSource, /sticky top-0 z-10/, 'Subpage header no longer uses sticky positioning outside the scroll container');

for (const title of [
  '1. Over dit privacybeleid',
  '2. Welke gegevens Artes verwerkt',
  '3. Waarom Artes gegevens gebruikt',
  '4. Rechtsgronden',
  '5. Openbare gegevens',
  '6. Met wie gegevens worden gedeeld',
  '7. Geen advertenties en geen verkoop van persoonsgegevens',
  '8. Bewaartermijnen',
  '9. Beveiliging',
  '10. Rechten van gebruikers',
  '11. Account en gegevens verwijderen',
  '12. Wijzigingen',
  '13. Contact',
]) {
  assert.ok(privacySource.includes(title), `Privacy section is present: ${title}`);
}
assert.match(privacySource, /Versie: 10 juli 2026/, 'Privacy version date is shown');
assert.match(privacySource, /mailto:\$\{CONTACT_EMAIL\}/, 'Privacy contact link uses mailto');
assert.match(privacySource, /Artes verkoopt geen persoonsgegevens en gebruikt persoonsgegevens niet voor gepersonaliseerde advertenties\./, 'No sale/no ads product rule is present');
assert.doesNotMatch(privacySource.replace(/\/\/ TODO:.*$/gm, ''), /TODO|komt binnenkort|placeholder/i, 'No visible TODO or placeholder text is present');
assert.doesNotMatch(privacySource, /KvK|vestigingsadres|functionaris gegevensbescherming|B\.V\.|BV/, 'Privacy text does not invent company registration details');
