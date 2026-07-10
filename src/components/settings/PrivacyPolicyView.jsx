import React from 'react';

const CONTACT_EMAIL = 'admin@artes.app';

const sections = [
  { title: '1. Over dit privacybeleid', body: <>Dit privacybeleid beschrijft welke persoonsgegevens Artes verwerkt, waarom deze gegevens worden verwerkt, met wie gegevens kunnen worden gedeeld en welke rechten gebruikers hebben.</> },
  { title: '2. Welke gegevens Artes verwerkt', body: <><p><strong>Account- en inloggegevens:</strong> gebruikers-ID, e-mailadres, gekozen inlogmethode, e-mailverificatiestatus en accountstatus.</p><p><strong>Profielgegevens:</strong> profielnaam, profielfoto, bio, rollen, thema’s, links, zelf ingevulde locatiegegevens en persoonlijke of beheerde organisatieprofielen.</p><p><strong>Content en activiteit:</strong> foto’s en andere uploads, berichten en bijschriften, credits en bijdragers, reacties, likes, volg- en fanrelaties, moodboards en tijdstippen van handelingen.</p><p><strong>Communicatie en veiligheid:</strong> directe berichten, supportgesprekken, rapportages, moderatiegegevens, claimverzoeken en bevestigingsverzoeken.</p><p><strong>Leeftijdsverificatie:</strong> Didit verwerkt verificatiegegevens rechtstreeks in de verificatiestroom. Artes bewaart statusinformatie en sessie- of resultaatgegevens die nodig zijn om leeftijds- en toegangsregels in de app uit te voeren.</p><p><strong>Technische gegevens:</strong> de gebruikte Firebase-infrastructuur en serverfuncties kunnen technische loggegevens verwerken die nodig zijn voor werking, beveiliging en foutonderzoek.</p></> },
  { title: '3. Waarom Artes gegevens gebruikt', body: <>Artes gebruikt gegevens om accounts aan te maken en te beveiligen, profielen te tonen en te beheren, content te publiceren en weer te geven, interacties tussen gebruikers mogelijk te maken, berichten en support te leveren, veiligheid en moderatie uit te voeren, misbruik en fraude tegen te gaan, leeftijds- en toegangsregels uit te voeren, technische fouten te onderzoeken en waar nodig aan wettelijke verplichtingen te voldoen.</> },
  { title: '4. Rechtsgronden', body: <>Voor account-, profiel-, publicatie- en communicatiefuncties verwerkt Artes gegevens voor de uitvoering van de overeenkomst met de gebruiker. Voor vrijwillige profielinformatie, uploads en bepaalde keuzes kan toestemming of een actieve handeling van de gebruiker de basis zijn. Voor beveiliging, moderatie, misbruikpreventie, support en foutonderzoek gebruikt Artes gerechtvaardigd belang. Wanneer wetgeving dit vereist, verwerkt Artes gegevens om aan wettelijke verplichtingen te voldoen.</> },
  { title: '5. Openbare gegevens', body: <>Informatie die je bewust op een openbaar profiel of in een openbare post plaatst, kan zichtbaar zijn voor andere gebruikers en mogelijk voor bezoekers buiten een ingelogde omgeving, afhankelijk van de actuele zichtbaarheid van Artes.</> },
  { title: '6. Met wie gegevens worden gedeeld', body: <>Gegevens kunnen worden gedeeld met andere gebruikers wanneer profielinformatie of content wordt gepubliceerd, met technische dienstverleners die nodig zijn om Artes te laten werken, met moderatoren of supportmedewerkers wanneer dat nodig is en met bevoegde instanties wanneer Artes wettelijk verplicht is gegevens te verstrekken. Bevestigde dienstverleners zijn Google Firebase en Didit.</> },
  { title: '7. Geen advertenties en geen verkoop van persoonsgegevens', body: <>Artes verkoopt geen persoonsgegevens en gebruikt persoonsgegevens niet voor gepersonaliseerde advertenties.</> },
  { title: '8. Bewaartermijnen', body: <>Zolang er geen definitieve productieperioden zijn vastgesteld, bewaart Artes accountgegevens zolang een account actief is en daarna zolang dat noodzakelijk is voor verwijdering, beveiliging of wettelijke verplichtingen. Gepubliceerde content wordt bewaard totdat de gebruiker deze verwijdert, het account wordt verwijderd of verwijdering om veiligheids- of wettelijke redenen niet direct mogelijk is. Support-, moderatie- en beveiligingsgegevens worden bewaard zolang deze nodig zijn voor afhandeling, misbruikpreventie en verantwoording. Verificatiegegevens worden niet langer bewaard dan nodig voor toegangscontrole en wettelijke verplichtingen.</> },
  { title: '9. Beveiliging', body: <>Artes gebruikt technische en organisatorische maatregelen om gegevens te beschermen. Geen enkele digitale dienst kan volledige veiligheid garanderen; Artes onderzoekt daarom technische fouten en beveiligingssignalen wanneer dat nodig is.</> },
  { title: '10. Rechten van gebruikers', body: <>Afhankelijk van je situatie kun je verzoeken om inzage, correctie, verwijdering, beperking van verwerking, bezwaar, overdraagbaarheid van gegevens en intrekking van toestemming. Stuur verzoeken naar <a className="font-semibold text-blue-700 underline underline-offset-2 dark:text-blue-200" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Soms kunnen wettelijke of veiligheidsredenen betekenen dat bepaalde gegevens langer moeten worden bewaard. Je kunt ook een klacht indienen bij de Autoriteit Persoonsgegevens.</> },
  { title: '11. Account en gegevens verwijderen', body: <>Wil je je account en persoonsgegevens laten verwijderen? Neem contact op via <a className="font-semibold text-blue-700 underline underline-offset-2 dark:text-blue-200" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</> },
  { title: '12. Wijzigingen', body: <>Dit privacybeleid kan worden aangepast wanneer Artes of de gegevensverwerking verandert. De versiedatum staat bovenaan deze pagina.</> },
  { title: '13. Contact', body: <>Contact: <a className="font-semibold text-blue-700 underline underline-offset-2 dark:text-blue-200" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</> },
];

export default function PrivacyPolicyView() {
  // TODO: Bevestig vóór publieke productie de formele juridische naam van de verwerkingsverantwoordelijke en aanvullende contactgegevens.
  // TODO: Controleer vóór publieke productie definitieve rechtsgronden, bewaartermijnen, verwerkers, doorgiften en exacte Didit/Firebase-uitwisseling juridisch.
  return (
    <div className="space-y-4 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
        <p className="font-bold text-slate-900 dark:text-white">Versie: 10 juli 2026</p>
        <p className="mt-1">Dit privacybeleid geldt voor de huidige testversie van Artes.</p>
        <p className="mt-3">Verwerkingsverantwoordelijke: Artes</p>
        <p>Contact: <a className="font-semibold text-blue-700 underline underline-offset-2 dark:text-blue-200" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></p>
      </div>
      {sections.map((section) => (
        <section key={section.title} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <h4 className="text-base font-bold text-slate-900 dark:text-white">{section.title}</h4>
          <div className="mt-2 space-y-2">{section.body}</div>
        </section>
      ))}
    </div>
  );
}
