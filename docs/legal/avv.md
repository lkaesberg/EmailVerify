---
title: Auftragsverarbeitungsvertrag (AVV)
description: Auftragsverarbeitungsvertrag nach Art. 28 DSGVO für Server-Betreiber, die EmailVerify zur Verifizierung ihrer Mitglieder einsetzen — inklusive Subunternehmer und technischer und organisatorischer Maßnahmen.
---

# Auftragsverarbeitungsvertrag (AVV)

**gemäß Art. 28 DSGVO** — **Stand:** August 2026

Dieser Auftragsverarbeitungsvertrag (im Folgenden "AVV") gilt für Betreiber von
Discord-Servern (z. B. Unternehmen, Hochschulen, Organisationen), die den
Discord-Bot **EmailVerify** einsetzen, um die Mitglieder ihres Servers per
E-Mail zu verifizieren, und dabei als Verantwortliche im Sinne der DSGVO
handeln.

**Vertragsparteien:**

- der jeweilige Server-Betreiber (im Folgenden **"Auftraggeber"** —
  Verantwortlicher im Sinne des Art. 4 Nr. 7 DSGVO), und
- **WKSolutions GbR**, Siedlungsweg 24, 37124 Rosdorf, Deutschland, vertreten
  durch die Gesellschafter Jan Philip Wahle und Lars Benedikt Kaesberg
  (im Folgenden **"Auftragnehmer"** — Auftragsverarbeiter im Sinne des
  Art. 4 Nr. 8 DSGVO). Kontakt: [contact@wksolutions.de](mailto:contact@wksolutions.de)

**Abschluss:** Der AVV kann gemäß Art. 28 Abs. 9 DSGVO in elektronischem Format
geschlossen werden. Senden Sie hierzu eine E-Mail mit Ihrem Namen bzw. Ihrer
Organisation und der Discord-Server-ID an
[contact@wksolutions.de](mailto:contact@wksolutions.de); Sie erhalten eine
Bestätigung mit Datum und Fassung dieses AVV. Auf Wunsch stellen wir eine
unterzeichnete PDF-Fassung bereit.

## § 1 Gegenstand und Dauer des Auftrags

1. Gegenstand des Auftrags ist die E-Mail-basierte Verifizierung der Mitglieder
   des Discord-Servers des Auftraggebers durch den Bot EmailVerify,
   einschließlich des Versands von Verifizierungs-E-Mails und der Speicherung
   der Verifizierungszuordnungen. Grundlage ist der Hauptvertrag (Nutzung des
   Bots gemäß [AGB](agb.md) bzw. [Nutzungsbedingungen](terms.md)).
2. Die Dauer des Auftrags entspricht der Dauer des Hauptvertrags. Der AVV endet
   automatisch, wenn der Bot vom Server des Auftraggebers entfernt wird oder
   der Auftraggeber die Server-Daten löscht (siehe § 9).

## § 2 Art der Daten und Kreis der Betroffenen (Anlage 1)

**Art der verarbeiteten Daten:**

- Discord-Nutzer-IDs und Server-ID (Guild-ID),
- E-Mail-Adressen der zu verifizierenden Mitglieder — gespeichert
  ausschließlich als kryptografischer Hash; Klartext wird nur transient für
  den unmittelbaren Versand der Verifizierungs-E-Mail verarbeitet,
- vom Auftraggeber konfigurierte Daten (Verifizierungs-Domains, Rollen-IDs,
  optionale Allowlist — gehasht),
- aggregierte, nicht nutzerbezogene Verifizierungs-Statistiken,
- technische Protokolldaten (Server- und Mail-Logs, Löschung nach spätestens
  30 Tagen).

**Kreis der Betroffenen:**

- Mitglieder und Beitrittskandidaten des Discord-Servers des Auftraggebers
  (z. B. Kunden, Mitarbeitende, Studierende, Community-Mitglieder).

## § 3 Ort der Verarbeitung, Drittlandsübermittlung

1. Die Verarbeitung findet ausschließlich in Mitgliedstaaten der Europäischen
   Union statt: Hosting und eigener SMTP-Server im Hetzner-Rechenzentrum
   Helsinki, Finnland; optionaler E-Mail-Versand über den EU-Endpunkt von Zoho
   ZeptoMail (`api.zeptomail.eu`, Datenresidenz EU).
2. Eine Verlagerung in ein Drittland erfolgt nur mit vorheriger Zustimmung des
   Auftraggebers und unter den Voraussetzungen der Art. 44 ff. DSGVO.
3. **Hinweis zu Discord:** Die Discord-Plattform selbst (Discord, Inc., USA)
   ist kein Subunternehmer des Auftragnehmers, sondern die vom Auftraggeber
   gewählte Plattform, auf der der Server betrieben wird. Für die
   Datenverarbeitung durch Discord gelten die Vereinbarungen zwischen dem
   Auftraggeber und Discord.

## § 4 Weisungsrecht des Auftraggebers

1. Der Auftragnehmer verarbeitet personenbezogene Daten ausschließlich im
   Rahmen der getroffenen Vereinbarungen und auf dokumentierte Weisung des
   Auftraggebers. Weisungen werden über die Konfigurationsbefehle des Bots
   (z. B. Domains, Rollen, Löschbefehle) sowie in Textform per E-Mail erteilt.
2. Der Auftragnehmer informiert den Auftraggeber unverzüglich, wenn er der
   Auffassung ist, dass eine Weisung gegen die DSGVO oder andere
   Datenschutzvorschriften verstößt (Art. 28 Abs. 3 Satz 3 DSGVO).

## § 5 Vertraulichkeit

Der Auftragnehmer setzt nur Personen ein, die zur Vertraulichkeit verpflichtet
wurden und mit den für sie relevanten Datenschutzbestimmungen vertraut sind
(Art. 28 Abs. 3 lit. b DSGVO). Die Vertraulichkeitsverpflichtung besteht nach
Beendigung des Auftrags fort. Ein Datenschutzbeauftragter ist gesetzlich nicht
erforderlich (§ 38 BDSG).

## § 6 Technische und organisatorische Maßnahmen (Anlage 2)

Der Auftragnehmer trifft insbesondere folgende Maßnahmen nach Art. 32 DSGVO:

- **Verschlüsselung:** Übertragung der Verifizierungs-E-Mails und aller
  API-Verbindungen ausschließlich verschlüsselt (TLS/STARTTLS bzw. HTTPS).
- **Pseudonymisierung / Datenminimierung:** E-Mail-Adressen werden in der
  Datenbank ausschließlich als kryptografischer Hash gespeichert;
  Klartext-Adressen werden nach dem Versand nicht aufbewahrt.
- **Zugangs- und Zugriffskontrolle:** Zugriff auf den Server nur durch die
  Gesellschafter über SSH mit Schlüssel-Authentifizierung; Zugriff auf
  Verwaltungsoberflächen mit Zwei-Faktor-Authentifizierung.
- **Löschkonzept:** Technische Logs werden nach spätestens 30 Tagen gelöscht;
  Betroffene können ihre Daten per `/data delete`, der Auftraggeber alle
  Server-Daten per `/delete_server_data` jederzeit selbst löschen.
- **Verfügbarkeit:** Betrieb in einem ISO-27001-zertifizierten
  Hetzner-Rechenzentrum (Helsinki, Finnland).
- Die jeweils aktuellen technischen und organisatorischen Maßnahmen der
  Subunternehmer ergeben sich aus deren Zertifizierungen und AV-Verträgen
  (siehe § 7).

Die Maßnahmen unterliegen dem technischen Fortschritt; der Auftragnehmer darf
alternative adäquate Maßnahmen umsetzen, sofern das Sicherheitsniveau nicht
unterschritten wird.

## § 7 Subunternehmer

Der Auftraggeber genehmigt den Einsatz der folgenden Subunternehmer:

| Subunternehmer | Leistung | Ort der Verarbeitung |
|---|---|---|
| **Hetzner Online GmbH**, Industriestr. 25, 91710 Gunzenhausen, Deutschland | Hosting des Bots, der Datenbank und des eigenen SMTP-Servers | Rechenzentrum Helsinki, Finnland (EU); AV-Vertrag geschlossen |
| **Zoho Corporation Pvt. Ltd.** (ZeptoMail, EU-Endpunkt `api.zeptomail.eu`) | Transaktionaler E-Mail-Versand für Abonnement-Kunden (sofern aktiviert) | EU (Datenresidenz EU); Auftragsverarbeitung gemäß Zoho-DPA |

Der Auftragnehmer informiert den Auftraggeber über beabsichtigte Änderungen
(Hinzuziehung oder Ersetzung von Subunternehmern) mindestens 30 Tage im Voraus,
z. B. durch Aktualisierung dieser Seite und Ankündigung im
[Support-Server](https://discord.com/invite/fEBSHUQXu2). Der Auftraggeber kann
der Änderung aus wichtigem datenschutzrechtlichen Grund widersprechen; im Fall
des Widerspruchs steht beiden Parteien ein Kündigungsrecht zu.

## § 8 Unterstützungspflichten des Auftragnehmers

1. Der Auftragnehmer unterstützt den Auftraggeber bei der Erfüllung von
   Anfragen betroffener Personen (Kapitel III DSGVO). Wendet sich eine
   betroffene Person unmittelbar an den Auftragnehmer, leitet dieser das
   Ersuchen unverzüglich an den Auftraggeber weiter.
2. Der Auftragnehmer unterstützt den Auftraggeber unter Berücksichtigung der
   Art der Verarbeitung und der ihm zur Verfügung stehenden Informationen bei
   der Einhaltung der Pflichten aus Art. 32 bis 36 DSGVO (Sicherheit,
   Meldung von Verletzungen, Datenschutz-Folgenabschätzung).
3. Der Auftragnehmer meldet dem Auftraggeber Verletzungen des Schutzes
   personenbezogener Daten, die den Auftrag betreffen, unverzüglich und
   stellt die für die Meldung nach Art. 33 DSGVO erforderlichen Informationen
   bereit.

## § 9 Löschung nach Auftragsende

Nach Beendigung des Auftrags löscht der Auftragnehmer sämtliche im Auftrag
verarbeiteten personenbezogenen Daten, sofern keine gesetzliche
Aufbewahrungspflicht entgegensteht:

- Beim Entfernen des Bots vom Server werden die Server-Daten automatisch
  gelöscht.
- Der Auftraggeber kann die Löschung jederzeit selbst per
  `/delete_server_data` auslösen.
- Technische Logs werden spätestens nach 30 Tagen gelöscht.

## § 10 Nachweise und Kontrollrechte

Der Auftragnehmer stellt dem Auftraggeber auf Anfrage alle erforderlichen
Informationen zum Nachweis der Einhaltung der Pflichten aus Art. 28 DSGVO zur
Verfügung (insbesondere diese Vereinbarung, die Beschreibung der technischen
und organisatorischen Maßnahmen sowie die Zertifizierungen und AV-Verträge der
Subunternehmer). Kontrollen erfolgen in der Regel durch schriftliche Auskünfte
und Vorlage geeigneter Nachweise.

## § 11 Schlussbestimmungen

1. Es gilt das Recht der Bundesrepublik Deutschland.
2. Bei Widersprüchen zwischen diesem AVV und dem Hauptvertrag gehen die
   Regelungen dieses AVV hinsichtlich des Datenschutzes vor.
3. Sollten einzelne Bestimmungen unwirksam sein, bleibt die Wirksamkeit der
   übrigen Bestimmungen unberührt.
4. Änderungen dieses AVV werden auf dieser Seite mit aktualisiertem "Stand"
   veröffentlicht; Bestandskunden werden über wesentliche Änderungen
   informiert.

---

# Data Processing Agreement (English summary)

WKSolutions GbR (Siedlungsweg 24, 37124 Rosdorf, Germany — partners Jan Philip
Wahle and Lars Benedikt Kaesberg) offers a Data Processing Agreement under
Art. 28 GDPR to Discord server operators (companies, universities,
organizations) that use EmailVerify to verify their own members and act as
controllers.

**Scope:** email-based verification of the controller's server members —
sending verification emails and storing verification records (Discord user
IDs, guild ID, hashed email addresses, aggregate statistics, technical logs
deleted after 30 days at the latest).

**Processing location:** exclusively in the EU — Hetzner data center in
Helsinki, Finland (hosting and self-hosted SMTP; DPA with Hetzner in place)
and, for subscription customers, Zoho ZeptoMail via its EU endpoint
(`api.zeptomail.eu`, EU data residency). Discord itself is the controller's
own platform choice, not a sub-processor.

**Security measures (Art. 32 GDPR):** TLS/STARTTLS for all email and API
traffic, email addresses stored only as cryptographic hashes, SSH-key and
2FA-protected access, 30-day log retention, self-service deletion via
`/data delete` and `/delete_server_data`, ISO 27001-certified data center.

**Sub-processors:** Hetzner Online GmbH (Germany; data center Helsinki,
Finland) and Zoho Corporation Pvt. Ltd. (ZeptoMail EU). Changes are announced
at least 30 days in advance with a right to object.

**How to execute:** Art. 28(9) GDPR allows electronic form. Email
[contact@wksolutions.de](mailto:contact@wksolutions.de) with your
organization name and Discord server ID; you will receive a confirmation, and
a signed PDF copy on request.

The German version above is the legally binding text.
