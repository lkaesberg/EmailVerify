---
title: Datenschutzerklärung
description: Wie EmailVerify personenbezogene Daten verarbeitet, von gehashten E-Mail-Adressen über Speicherdauer und Auftragsverarbeiter bis zu den Betroffenenrechten nach DSGVO.
---

# Datenschutzerklärung

**Stand:** September 2026

Diese Datenschutzerklärung informiert über die Verarbeitung personenbezogener
Daten bei der Nutzung des Discord-Bots **EmailVerify** sowie der zugehörigen
Premium-Funktionen.

## 1. Verantwortlicher

WKSolutions GbR
vertreten durch die Gesellschafter Jan Philip Wahle und Lars Benedikt Kaesberg
Siedlungsweg 24
37124 Rosdorf
Deutschland
E-Mail: [contact@wksolutions.de](mailto:contact@wksolutions.de)

Soweit Server-Betreiber (z. B. Unternehmen oder Hochschulen) den Bot zur
Verifizierung ihrer eigenen Mitglieder einsetzen, handelt WKSolutions insoweit
als Auftragsverarbeiter; hierfür steht ein
[Auftragsverarbeitungsvertrag (AVV)](avv.md) zur Verfügung.

Ein Datenschutzbeauftragter ist gesetzlich nicht erforderlich (§ 38 BDSG, da
weniger als 20 Personen mit der Datenverarbeitung beschäftigt sind).

## 2. Welche Daten werden verarbeitet?

### 2.1 Bei der E-Mail-Verifizierung

- **Discord-Nutzer-ID** (zur Zuordnung zur Verifizierung).
- **E-Mail-Adresse** (eingegeben vom Nutzer): an die eingegebene Adresse wird
  ein Bestätigungscode gesendet. Die Adresse wird **nicht im Klartext**
  gespeichert, sondern als kryptografischer Hash (MD5 vom lowercased Wert),
  ausschließlich um Doppelverifizierungen pro Server zu verhindern.
- **Server-ID** (Discord Guild-ID), in der die Verifizierung erfolgt.
- **Zeitpunkt** und Erfolg der Verifizierung in den Server-Statistiken
  (aggregiert, nicht nutzerbezogen).

### 2.2 Bei der Server-Konfiguration

Server-Administratoren konfigurieren den Bot u. a. mit folgenden Angaben (siehe
[Befehle](../commands.md)): Verifizierungs-Domains, Rollen-IDs, Sprache,
Log-Channel-ID, optional Allowlist von E-Mail-Adressen (gehasht gespeichert).

Wird der Bot einem Server hinzugefügt, speichern wir die **Discord-Nutzer-ID der
Person, die ihn hinzugefügt hat** (sofern Discord sie uns mitteilt), um ihr bis
zu zwei Erinnerungen per Direktnachricht zu senden, falls die Einrichtung
nicht abgeschlossen wird. Die Angabe wird gelöscht, sobald sich auf dem Server
jemand verifiziert, nach der letzten Erinnerung oder wenn der Bot den Server
verlässt.

### 2.3 Bei der Nutzung von Premium-Funktionen

- **Server-ID**, gekaufte Guthaben (Anzahl), Status der CSV-Freischaltung,
  Discord-Entitlement-IDs.
- Aggregierte Statistiken (Mails gesendet pro Monat / gesamt) je Server.

### 2.4 Server-Logs (technisch)

Beim technischen Betrieb fallen Server- und Mail-Server-Logs an (z. B. SMTP-
Verbindung, IP-Adresse des Mail-Servers, Zeitpunkte). Diese Logs werden zur
Fehleranalyse verwendet und nach maximal 30 Tagen gelöscht.

### 2.5 Nutzungsanalyse des Bots (PostHog)

Um den Bot zu verbessern, erfassen wir Nutzungsereignisse (z. B. „Verifizierung
gestartet", „Befehl verwendet", „E-Mail versendet") mit **PostHog** (EU-Cloud).
Discord-Nutzer-IDs werden dabei **nicht im Klartext** übertragen, sondern als
gesalzener SHA-256-Hash (Pseudonym). **E-Mail-Adressen werden nie übertragen.**
Erfasst werden außerdem Server-ID und Servername sowie technische Angaben zum
Ereignis.

### 2.6 Abstimmungen auf Bot-Listen (top.gg, discordbotlist.com)

Stimmen Sie auf top.gg oder discordbotlist.com für EmailVerify ab, übermittelt
uns die jeweilige Plattform Ihre **Discord-Nutzer-ID** (und ggf. Ihren
Nutzernamen). Wir speichern Nutzer-ID, Zeitpunkt, Plattform und den Server, dem
die Stimme gutgeschrieben wird, um die Bonus-E-Mails zu vergeben und doppelte
Zählungen zu verhindern. Mit `/vote` legen Sie fest, welcher Server Ihre
Stimmen erhält; auch diese Zuordnung wird gespeichert. Anschließend senden wir
Ihnen eine Bestätigung per Direktnachricht. Für die Abstimmung selbst gelten
die Datenschutzbestimmungen der jeweiligen Plattform, die insoweit eigenständig
verantwortlich ist.

## 3. Rechtsgrundlagen (Art. 6 DSGVO)

- **Art. 6 Abs. 1 lit. b DSGVO** (Vertragserfüllung): Verifizierung,
  Bereitstellung gekaufter Premium-Funktionen.
- **Art. 6 Abs. 1 lit. f DSGVO** (berechtigtes Interesse): Schutz vor Missbrauch
  und Mehrfach-Verifizierungen, Sicherstellung des stabilen Bot-Betriebs,
  technische Logs, Einrichtungs-Erinnerungen, die Vergabe von Abstimmungs-Boni
  sowie die pseudonyme Nutzungsanalyse des Bots.
- **Art. 6 Abs. 1 lit. a DSGVO** (Einwilligung): Soweit Sie eine E-Mail-Adresse
  zur Verifizierung eingeben, willigen Sie in deren Verarbeitung im hier
  beschriebenen Rahmen ein. Die Einwilligung kann jederzeit widerrufen werden,
  z. B. durch den Bot-Befehl `/data delete-user`.
- **Art. 6 Abs. 1 lit. a DSGVO i. V. m. § 25 Abs. 1 TDDDG** (Einwilligung): die
  Reichweitenmessung dieser Website (Abschnitt 4.1), nur wenn Sie im
  Einwilligungsbanner zustimmen.

## 4. Empfänger / Auftragsverarbeiter

Daten werden nicht weitergegeben mit Ausnahme der nachfolgend genannten
notwendigen Verarbeitungen durch Dienstleister:

| Dienstleister | Zweck | Sitz / Drittlandtransfer |
|---|---|---|
| **Discord, Inc.** | Bereitstellung der Bot-Plattform; Discord verarbeitet alle Befehle und Server-IDs | USA (Drittland; SCCs / Data Privacy Framework) |
| **Hetzner Online GmbH** | Hosting des Bots und des eigenen SMTP-Servers (mail.larskaesberg.de) für den Versand der Verifizierungs-E-Mails (kostenlose Stufe und Bonus-Guthaben) | Rechenzentrum Helsinki, Finnland (EU); AV-Vertrag geschlossen |
| **Zoho Corporation Pvt. Ltd. (ZeptoMail, EU-Endpunkt)** | Versand der Verifizierungs-E-Mails für Abonnement-Kunden (sofern aktiviert); EU-Endpunkt `api.zeptomail.eu` | EU (Datenresidenz EU; Auftragsverarbeitung) |
| **PostHog Inc.** (2261 Market St. #4008, San Francisco, CA 94114, USA), EU-Cloud | Pseudonyme Nutzungsanalyse des Bots (Abschnitt 2.5) und, nach Einwilligung, Reichweitenmessung dieser Website (Abschnitt 4.1); Endpunkt `eu.i.posthog.com` | Datenhaltung in Rechenzentren in der EU; Verarbeitung durch PostHog und seine Unterauftragsverarbeiter auch in den USA möglich. PostHog ist nach dem EU-US Data Privacy Framework zertifiziert; zusätzlich gelten die EU-Standardvertragsklauseln (Modul 2). AV-Vertrag nach Art. 28 DSGVO geschlossen |

Discord ist kein klassischer Auftragsverarbeiter im Sinne der DSGVO, sondern
eine Plattform, ohne die der Bot nicht funktionieren kann; die Datenverarbeitung
durch Discord folgt der [Discord-Datenschutzerklärung](https://discord.com/privacy).

### 4.1 Diese Website

Diese Website (`getemailverified.com`) wird über **GitHub Pages**
(GitHub, Inc., USA) ausgeliefert. Beim Abruf verarbeitet GitHub technisch
notwendige Verbindungsdaten einschließlich Ihrer IP-Adresse; Einzelheiten in der
[GitHub-Datenschutzerklärung](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).
Die Website setzt **keine Cookies**.

**Reichweitenmessung (PostHog, nur mit Einwilligung).** Beim ersten Besuch
fragt ein Banner, ob Sie der Reichweitenmessung zustimmen. **Erst wenn Sie
„Allow analytics" wählen**, wird PostHog (EU-Cloud) geladen. Erfasst werden
dann Seitenaufrufe, die verweisende Seite, UTM-Parameter aus der Adresszeile
sowie Klicks auf die Links zum Hinzufügen des Bots, zum Discord-Store und zum
Support-Server, damit wir verstehen, welche Seiten und Verweise zur Installation
des Bots führen. Auch dann werden **keine Cookies gesetzt**, und für die Analyse
wird nichts auf Ihrem Endgerät gespeichert: Die Zuordnung eines Besuchs besteht
nur im Arbeitsspeicher der geöffneten Seite und endet mit dem Neuladen. Es
werden keine Nutzerprofile gebildet, keine Sitzungen aufgezeichnet und keine
Klicks außer den genannten erfasst; IP-Adressen werden von PostHog nicht
gespeichert. Ist in Ihrem Browser „Do Not Track" aktiviert, findet keine
Erfassung statt.

Rechtsgrundlage ist Ihre Einwilligung (Art. 6 Abs. 1 lit. a DSGVO i. V. m.
§ 25 Abs. 1 TDDDG). Sie können sie jederzeit mit Wirkung für die Zukunft
widerrufen, indem Sie unten auf jeder Seite **„Privacy settings"** öffnen und
„Decline" wählen. Ihre Auswahl selbst speichern wir im lokalen Speicher Ihres
Browsers (`ev-analytics-consent`), damit das Banner nicht bei jedem Seitenaufruf
erscheint; das ist für die Beachtung Ihrer Entscheidung unbedingt erforderlich
(§ 25 Abs. 2 Nr. 2 TDDDG). Lehnen Sie ab, wird PostHog nicht geladen.

Die auf der Startseite und den Statistikseiten angezeigten Zahlen werden von
`stats.getemailverified.com` (eigener Server, Hetzner-Rechenzentrum
Helsinki, Finnland/EU) geladen. Es werden
dabei nur aggregierte Zählwerte übertragen, keine personenbezogenen Daten.

**Video-Einbindung (YouTube).** Auf der Startseite und der Quick-Start-Seite ist
ein Erklärvideo eingebunden. Das Vorschaubild liegt **auf diesem Server**, und es
wird **erst dann** eine Verbindung zu YouTube aufgebaut, wenn Sie aktiv auf den
Play-Button klicken (sogenannte Zwei-Klick-Lösung). Vor dem Klick werden **keine
Daten an Google übertragen und keine Cookies gesetzt**.

Klicken Sie auf Play, wird der Player über `youtube-nocookie.com` (erweiterter
Datenschutzmodus) von der **Google Ireland Limited** geladen. Dabei werden Ihre
IP-Adresse und Informationen zum abgerufenen Video an Google übertragen, ggf.
mit Übermittlung in die USA. Rechtsgrundlage ist Ihre durch den Klick erteilte
Einwilligung (Art. 6 Abs. 1 lit. a DSGVO), die Sie jederzeit durch Verlassen der
Seite widerrufen können. Einzelheiten in der
[Google-Datenschutzerklärung](https://policies.google.com/privacy).

## 5. Speicherdauer

- **Hashes der E-Mail-Adressen** und Verifizierungszuordnungen: bis zur Löschung
  durch den Nutzer (`/data delete-user`) oder durch den Server-Admin
  (`/data delete-server`); spätestens beim Entfernen des Bots vom Server.
- **Server-Konfiguration**: bis zur Löschung durch den Server-Admin oder
  Entfernen des Bots.
- **Aggregierte Statistiken**: Monatszähler werden monatsweise zurückgesetzt,
  Gesamtzähler bleiben bis zur Löschung der Server-Daten erhalten.
- **Technische Logs**: maximal 30 Tage.
- **Abstimmungen**: bis zur Löschung Ihrer Daten über `/data delete-user`
  (danach ohne Nutzer-ID); Einträge zu einem Server werden gelöscht, wenn der
  Bot den Server verlässt.
- **Einrichtungs-Erinnerungen**: die ID der hinzufügenden Person höchstens bis
  zur letzten Erinnerung (wenige Tage), siehe Abschnitt 2.2.
- **PostHog-Ereignisse** (Bot und Website): bis zu sieben Jahre (Aufbewahrungsfrist
  unseres PostHog-Tarifs), sofern sie nicht vorher gelöscht werden.

## 6. Ihre Rechte

Sie haben das Recht auf

- Auskunft (Art. 15 DSGVO) über die Sie betreffenden Daten,
- Berichtigung (Art. 16 DSGVO) unrichtiger Daten,
- Löschung (Art. 17 DSGVO) — siehe Abschnitt 7,
- Einschränkung der Verarbeitung (Art. 18 DSGVO),
- Datenübertragbarkeit (Art. 20 DSGVO),
- Widerspruch (Art. 21 DSGVO),
- Widerruf einer erteilten Einwilligung (Art. 7 Abs. 3 DSGVO) mit Wirkung für
  die Zukunft.

Zur Wahrnehmung dieser Rechte genügt eine formlose E-Mail an
<contact@wksolutions.de>.

## 7. Löschung

- Eigene Daten: `/data delete-user` direkt im Bot.
- Server-Daten: `/data delete-server` durch den Server-Admin oder Entfernen
  des Bots vom Server (automatische Löschung).

## 8. Beschwerderecht

Sie können sich jederzeit bei einer Datenschutzaufsichtsbehörde beschweren,
insbesondere bei der Landesbeauftragten für den Datenschutz Niedersachsen oder
der Aufsichtsbehörde Ihres Wohnsitzlandes. Eine Übersicht finden Sie unter
<https://www.bfdi.bund.de/DE/Service/Anschriften/Laender/Laender-node.html>.

## 9. Sicherheit

Die Übertragung der Verifizierungs-E-Mails erfolgt verschlüsselt (TLS/STARTTLS).
E-Mail-Adressen werden in der Bot-Datenbank ausschließlich als kryptografischer
Hash gespeichert; Klartext-Adressen werden außer für den unmittelbaren
Mail-Versand nicht verarbeitet.

## 10. Änderungen dieser Datenschutzerklärung

Diese Datenschutzerklärung wird bei wesentlichen Änderungen aktualisiert.
Maßgeblich ist jeweils die unter „Stand" genannte Fassung.

---

# Privacy Policy (English summary)

EmailVerify processes personal data only as needed to deliver its verification
service.

**Controller:** WKSolutions GbR (partners: Jan Philip Wahle, Lars Benedikt
Kaesberg), Siedlungsweg 24, 37124 Rosdorf, Germany —
[contact@wksolutions.de](mailto:contact@wksolutions.de).

Where server operators (e.g. companies or universities) use the bot to verify
their own members, WKSolutions acts as a processor on their behalf; a
[Data Processing Agreement (DPA)](avv.md) is available.

**Data processed:** Discord user ID, server ID, hashed (MD5 of lowercase) email
address, aggregate per-server statistics, server configuration set by admins.
Plain-text email addresses are used only to send the verification message; they
are not retained.

- **Setup reminders:** when the bot is added, we store the Discord ID of the person
  who added it (when Discord provides it), to send up to two reminder DMs if setup
  isn't finished. It is deleted once someone verifies, after the last reminder, or
  when the bot leaves.
- **Bot usage analytics:** usage events (e.g. verification started, command used)
  go to PostHog (EU cloud) with Discord user IDs replaced by a salted SHA-256
  pseudonym. Email addresses are never sent.
- **Votes:** when you vote on top.gg or discordbotlist.com, the list sends us your
  Discord user ID. We store it with the time, the list and the server credited, to
  grant the bonus and prevent double counting, and DM you a confirmation. `/vote`
  stores which server your votes go to. `/data delete-user` removes your ID from
  these records.

**Legal bases:** GDPR Art. 6(1)(b) (contract: verification, paid features),
6(1)(f) (legitimate interest: anti-abuse, stability, setup reminders, vote
bonuses and pseudonymous bot usage analytics), 6(1)(a) (consent: the verification
email entered by the user — revocable any time via `/data delete-user` — and the
website analytics).

**Sub-processors:**
- Discord, Inc. (US; SCC/DPF) — platform.
- Hetzner Online GmbH (data center Helsinki, Finland/EU; DPA in place) —
  hosting of the bot and the self-hosted SMTP server `mail.larskaesberg.de`
  used for email delivery for free tier and bonus credits.
- Zoho ZeptoMail EU endpoint `api.zeptomail.eu` (EU) — email delivery for
  subscription customers (if enabled).
- PostHog Inc. (San Francisco, USA; EU cloud, `eu.i.posthog.com`) — pseudonymous
  bot usage analytics and, with consent, website analytics. Data is held in EU
  data centres; PostHog and its sub-processors may also process it in the US.
  PostHog is certified under the EU-US Data Privacy Framework, and the EU Standard
  Contractual Clauses (module 2) apply in addition. A DPA under GDPR Art. 28 is in
  place. Events are kept for up to seven years.
- GitHub, Inc. (US) — hosting of this website via GitHub Pages. No cookies.

**Website analytics (only with consent):** a banner asks on your first visit, and
PostHog is loaded **only if you choose "Allow analytics"**. It then records page
views, the referring page, UTM tags and clicks on the add-to-Discord, store and
support links. It sets no cookies and stores nothing on your device for analytics:
a visit is recognised only in the open page's memory and ends on reload. No
profiles, no session recording, no IP addresses stored; with "Do Not Track"
enabled nothing is recorded. Legal basis: your consent (GDPR Art. 6(1)(a) with
§ 25(1) TDDDG). Withdraw it any time via **"Privacy settings"** at the bottom of
every page. Your choice itself is kept in your browser's local storage
(`ev-analytics-consent`) so the banner doesn't reappear on every page, which is
strictly necessary to honour it (§ 25(2) no. 2 TDDDG).

**Embedded video:** the explainer video on the home and quick-start pages uses a
click-to-load placeholder. The poster image is served from this site, and **no
request reaches Google and no cookie is set until you click play**. Clicking
loads the player from `youtube-nocookie.com` (Google Ireland Limited) and
transmits your IP address and the video requested; the legal basis is the
consent you give by clicking (GDPR Art. 6(1)(a)).

**Retention:** until you or the server admin delete the data, or until the bot
leaves the server.

**Your rights:** access, rectification, erasure, restriction, portability,
objection, withdrawal of consent (GDPR Arts. 15–21, 7(3)). Email
[contact@wksolutions.de](mailto:contact@wksolutions.de) to exercise them.
You may also lodge a complaint with a German Data Protection Authority.
