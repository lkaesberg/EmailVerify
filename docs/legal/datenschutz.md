# Datenschutzerklärung

**Stand:** April 2026

Diese Datenschutzerklärung informiert über die Verarbeitung personenbezogener
Daten bei der Nutzung des Discord-Bots **EmailVerify** sowie der zugehörigen
Premium-Funktionen.

## 1. Verantwortlicher

Lars Benedikt Kaesberg
Hannoversche Straße 8
37075 Göttingen
Deutschland
E-Mail: [contact@larskaesberg.de](mailto:contact@larskaesberg.de)

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

### 2.3 Bei der Nutzung von Premium-Funktionen

- **Server-ID**, gekaufte Guthaben (Anzahl), Status der CSV-Freischaltung,
  Discord-Entitlement-IDs.
- Aggregierte Statistiken (Mails gesendet pro Monat / gesamt) je Server.

### 2.4 Server-Logs (technisch)

Beim technischen Betrieb fallen Server- und Mail-Server-Logs an (z. B. SMTP-
Verbindung, IP-Adresse des Mail-Servers, Zeitpunkte). Diese Logs werden zur
Fehleranalyse verwendet und nach maximal 30 Tagen gelöscht.

## 3. Rechtsgrundlagen (Art. 6 DSGVO)

- **Art. 6 Abs. 1 lit. b DSGVO** (Vertragserfüllung): Verifizierung,
  Bereitstellung gekaufter Premium-Funktionen.
- **Art. 6 Abs. 1 lit. f DSGVO** (berechtigtes Interesse): Schutz vor Missbrauch
  und Mehrfach-Verifizierungen, Sicherstellung des stabilen Bot-Betriebs,
  technische Logs.
- **Art. 6 Abs. 1 lit. a DSGVO** (Einwilligung): Soweit Sie eine E-Mail-Adresse
  zur Verifizierung eingeben, willigen Sie in deren Verarbeitung im hier
  beschriebenen Rahmen ein. Die Einwilligung kann jederzeit widerrufen werden,
  z. B. durch den Bot-Befehl `/data delete`.

## 4. Empfänger / Auftragsverarbeiter

Daten werden nicht weitergegeben mit Ausnahme der nachfolgend genannten
notwendigen Verarbeitungen durch Dienstleister:

| Dienstleister | Zweck | Sitz / Drittlandtransfer |
|---|---|---|
| **Discord, Inc.** | Bereitstellung der Bot-Plattform; Discord verarbeitet alle Befehle und Server-IDs | USA (Drittland; SCCs / Data Privacy Framework) |
| **eigener SMTP-Server** (mail.larskaesberg.de) | Versand der Verifizierungs-E-Mails (kostenlose Stufe und Bonus-Guthaben) | Deutschland |
| **Zoho Corporation Pvt. Ltd. (ZeptoMail, EU-Endpunkt)** | Versand der Verifizierungs-E-Mails für Abonnement-Kunden (sofern aktiviert); EU-Endpunkt `api.zeptomail.eu` | EU (Datenresidenz EU; Auftragsverarbeitung) |

Discord ist kein klassischer Auftragsverarbeiter im Sinne der DSGVO, sondern
eine Plattform, ohne die der Bot nicht funktionieren kann; die Datenverarbeitung
durch Discord folgt der [Discord-Datenschutzerklärung](https://discord.com/privacy).

## 5. Speicherdauer

- **Hashes der E-Mail-Adressen** und Verifizierungszuordnungen: bis zur Löschung
  durch den Nutzer (`/data delete`) oder durch den Server-Admin
  (`/delete_server_data`); spätestens beim Entfernen des Bots vom Server.
- **Server-Konfiguration**: bis zur Löschung durch den Server-Admin oder
  Entfernen des Bots.
- **Aggregierte Statistiken**: Monatszähler werden monatsweise zurückgesetzt,
  Gesamtzähler bleiben bis zur Löschung der Server-Daten erhalten.
- **Technische Logs**: maximal 30 Tage.

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
<contact@larskaesberg.de>.

## 7. Löschung

- Eigene Daten: `/data delete` direkt im Bot.
- Server-Daten: `/delete_server_data` durch den Server-Admin oder Entfernen
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

**Controller:** Lars Benedikt Kaesberg, Hannoversche Straße 8, 37075 Göttingen,
Germany — [contact@larskaesberg.de](mailto:contact@larskaesberg.de).

**Data processed:** Discord user ID, server ID, hashed (MD5 of lowercase) email
address, aggregate per-server statistics, server configuration set by admins.
Plain-text email addresses are used only to send the verification message; they
are not retained.

**Legal bases:** GDPR Art. 6(1)(b) (contract: verification, paid features),
6(1)(f) (legitimate interest: anti-abuse, stability), 6(1)(a) (consent for the
verification email entered by the user — revocable any time via `/data delete`).

**Sub-processors:**
- Discord, Inc. (US; SCC/DPF) — platform.
- Self-hosted SMTP `mail.larskaesberg.de` (Germany) — email delivery for free
  tier and bonus credits.
- Zoho ZeptoMail EU endpoint `api.zeptomail.eu` (EU) — email delivery for
  subscription customers (if enabled).

**Retention:** until you or the server admin delete the data, or until the bot
leaves the server.

**Your rights:** access, rectification, erasure, restriction, portability,
objection, withdrawal of consent (GDPR Arts. 15–21, 7(3)). Email
[contact@larskaesberg.de](mailto:contact@larskaesberg.de) to exercise them.
You may also lodge a complaint with a German Data Protection Authority.
