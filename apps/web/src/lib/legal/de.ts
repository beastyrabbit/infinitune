import type { LegalDocument } from "./types";

export const notice: LegalDocument = {
	lang: "de",
	kind: "notice",
	title: "Impressum",
	updated: "21.10.2026",
	sections: [
		{
			id: "provider",
			title: "Anbieter",
			html: `<p>Tobias Heer<br>c/o Impressumservice Dein-Impressum<br>Stettiner Str. 41<br>35410 Hungen<br>Deutschland</p>`,
		},
		{
			id: "contact",
			title: "Kontakt",
			html: `<p>E-Mail: <a href="mailto:impressum-infinitune@heerlab.com">impressum-infinitune@heerlab.com</a><br>Kontaktformular: <a href="https://beastyrabbit.com/kontakt?from=infinitune">beastyrabbit.com/kontakt</a></p>`,
		},
		{
			id: "note",
			title: "Hinweis",
			html: `<p>Infinitune ist ein privates, nicht-kommerzielles Projekt.</p>`,
		},
		{
			id: "privacy",
			title: "Datenschutz",
			html: `<p>Informationen zur Verarbeitung personenbezogener Daten finden Sie in der <a href="/datenschutz">Datenschutzerklärung</a>.</p>`,
		},
	],
};

export const privacy: LegalDocument = {
	lang: "de",
	kind: "privacy",
	title: "Datenschutzerklärung",
	updated: "21.10.2026",
	sections: [
		{
			id: "controller",
			title: "Verantwortlicher",
			html: `<p>Verantwortlich für die Verarbeitung personenbezogener Daten auf https://infinitune.heerlab.com ist:</p>
<p>Tobias Heer<br>c/o Impressumservice Dein-Impressum<br>Stettiner Str. 41<br>35410 Hungen<br>Deutschland</p>
<p>E-Mail: <a href="mailto:datenschutz-infinitune@heerlab.com">datenschutz-infinitune@heerlab.com</a></p>
<p>Ein Datenschutzbeauftragter ist nicht bestellt, da hierzu keine gesetzliche Pflicht besteht.</p>`,
		},
		{
			id: "overview",
			title: "Überblick",
			html: `<p>Diese Erklärung informiert darüber, welche personenbezogenen Daten bei der Nutzung von Infinitune verarbeitet werden, zu welchen Zwecken, auf welcher Rechtsgrundlage und wie lange. Infinitune ist ein privates, nicht-kommerzielles Projekt. Infinitune erzeugt und spielt KI-generierte Musik anhand Ihrer Beschreibungen ab. Bewertungen und bisherige Titel beeinflussen die Musikauswahl, ohne rechtliche oder ähnlich erhebliche Entscheidungen über Sie zu treffen.</p>
<p>Personenbezogene Daten werden nicht verkauft und nicht für Werbung verwendet. Eine automatisierte Entscheidungsfindung einschließlich Profiling im Sinne von Art. 22 DSGVO findet nicht statt.</p>`,
		},
		{
			id: "hosting",
			title: "Hosting und Bereitstellung",
			html: `<p>Infinitune läuft auf eigener Server-Infrastruktur des Verantwortlichen in Deutschland. Aufrufe aus dem Internet erreichen die Anwendung über einen Reverse-Proxy auf einem virtuellen Server der netcup GmbH, Emmy-Noether-Straße 10, 76131 Karlsruhe, Deutschland (Rechenzentrum in Nürnberg). netcup verarbeitet die Daten dabei als Auftragsverarbeiter; mit netcup besteht ein Vertrag zur Auftragsverarbeitung nach Art. 28 DSGVO. Die Verbindung ist bis zum Reverse-Proxy TLS-verschlüsselt und wird von dort durch einen verschlüsselten Tunnel an die eigene Infrastruktur weitergeleitet.</p>
<p>Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Das berechtigte Interesse liegt in einer sicheren und zuverlässigen Bereitstellung der Website.</p>
<p>Sicherungskopien werden innerhalb der eigenen Infrastruktur gespeichert und nach spätestens drei Monaten überschrieben.</p>`,
		},
		{
			id: "logs",
			title: "Server-Logfiles",
			html: `<p>Bei jedem Aufruf speichert der Reverse-Proxy automatisch folgende Daten:</p>
<ul><li>IP-Adresse des anfragenden Geräts</li><li>Datum und Uhrzeit des Zugriffs</li><li>aufgerufene Adresse (Pfad einschließlich Parameter), HTTP-Methode und Protokoll</li><li>HTTP-Statuscode, übertragene Datenmenge und Antwortzeit</li><li>Browser-Kennung (User-Agent)</li><li>verwendete TLS-Version und Verschlüsselung</li><li>angesprochener Dienst</li></ul>
<p>Die Header Cookie und Authorization werden geschwärzt. URL-Pfade und Abfrageparameter werden protokolliert.</p>
<p>Die Daten dienen dem Betrieb, der Fehleranalyse und der Abwehr von Angriffen und Missbrauch. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Das berechtigte Interesse liegt in Stabilität und Sicherheit des Angebots. Die Logfiles werden nach 14 Tagen automatisch gelöscht.</p>
<p>Pangolin führt zusätzlich HTTP-Anfrageprotokolle mit Verbindungs- und Anfragedaten für 14 Tage, Anmeldeprotokolle mit Identitätsdaten, IP und Anmeldezeit für 90 Tage sowie Netzwerkprotokolle mit Verbindungsdaten für 30 Tage.</p>
<p>Die Anwendung protokolliert Anfragekennung, Methode, Pfad ohne Abfrageparameter, Status, Dauer und Größe sowie Song-/Playlist-Kennungen, Titel, Künstlernamen, Gerätenamen und Fehler. Share-Tokens im API-Pfad werden ersetzt. Die normale Anfrageprotokollierung erfasst keine Benutzerprofile, vollständigen Anfragekörper oder Client-IP-Adressen. Warnungen zur Proxy-Konfiguration können die IP des Verbindungspartners enthalten; Fehlermeldungen können eingegebene Inhalte enthalten. Die aktuelle Datei wird alle 15 Sekunden auf die letzten 10.000 Zeilen gekürzt. Die Anwendung löscht ihre Protokolldaten automatisch 14 Tage nach dem letzten Schreibzugriff, beim Start und bei der regelmäßigen Bereinigung. Inaktive Dateien werden entfernt; eine noch geöffnete aktive Datei wird bei Fristablauf geleert.</p>
<p>Kubernetes hält außerdem kurzlebige Container-Protokolle vor. CrowdSec speichert lokal Angreifer-IP, Vorfallszeit und -typ sowie Sperrentscheidungen. Lokale Warnungen werden nach sieben Tagen oder beim Überschreiten von 5.000 Einträgen bereinigt, ausgenommen Warnungen mit noch aktiven Sperrentscheidungen. Lokale Sperrprofile gelten vier Stunden; übernommene Sperren können andere Laufzeiten haben. Abgelaufene Entscheidungsdatensätze können bis zur Bereinigung der zugehörigen Warnung verbleiben. Auch diese Protokolle dienen Betrieb, Fehleranalyse und Sicherheit auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO. Für Sicherungskopien gilt die im Abschnitt Hosting genannte Frist.</p>`,
		},
		{
			id: "crowdsec",
			title: "Schutz vor Angriffen (CrowdSec)",
			html: `<p>Zum Schutz vor Angriffen wertet die Sicherheitssoftware CrowdSec die Server-Logfiles automatisch aus und sperrt IP-Adressen, von denen erkennbar Angriffe ausgehen (zum Beispiel massenhafte Anmeldeversuche oder das Ausspähen von Schwachstellen). Erkennt CrowdSec einen Angriff, werden die IP-Adresse, der Zeitpunkt und die Art des Angriffs an die CrowdSec SAS, 20 rue Maurice Arnoux, 92120 Montrouge, Frankreich, übermittelt. CrowdSec nutzt diese Meldungen für eine gemeinsame Sperrliste, die Angriffe auf viele Server abwehrt. Bei normalem Surfen werden keine Daten an CrowdSec übermittelt.</p>
<p>Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Das berechtigte Interesse liegt im Schutz der Website und ihrer Nutzer vor Angriffen.</p>
<p>Für diese Verarbeitung sind der Verantwortliche und CrowdSec nach Angaben von CrowdSec gemeinsam verantwortlich (Art. 26 DSGVO): CrowdSec ist für den Betrieb seiner zentralen Dienste und Sperrlisten verantwortlich, der Verantwortliche für den Einsatz auf diesem Server. Sie können Ihre Rechte gegenüber beiden geltend machen, bei CrowdSec unter <a href="mailto:dpo@crowdsec.net">dpo@crowdsec.net</a>. CrowdSec kann die gemeldeten Daten an Mitglieder und Partner seines Netzwerks weitergeben. Übermittlungen in Länder außerhalb der EU erfolgen nach Angaben von CrowdSec auf Grundlage von Standardvertragsklauseln der EU-Kommission (Art. 46 Abs. 2 lit. c DSGVO).</p>
<p>Vollständige IP-Adressen werden grundsätzlich höchstens drei Monate gespeichert und anschließend schrittweise verallgemeinert. Für bestimmte Angriffsanalysen und Trainingszwecke nennt CrowdSec Ausnahmen von bis zu einem Jahr vor der Anonymisierung. Details: <a href="https://www.crowdsec.net/privacy-policy">crowdsec.net/privacy-policy</a>.</p>`,
		},
		{
			id: "sso",
			title: "Anmeldung (Single Sign-On)",
			html: `<p>Infinitune ist nur für eingeladene Personen zugänglich. Die Anmeldung erfolgt über den Reverse-Proxy Pangolin mit dem selbst betriebenen Identitätsdienst Pocket-ID auf der eigenen Infrastruktur. Dabei werden Benutzername, E-Mail-Adresse, Gruppenzugehörigkeit, Zeitpunkt der Anmeldung und IP-Adresse verarbeitet. Nach der Anmeldung setzt Pangolin ein Sitzungs-Cookie, das für den Zugang technisch erforderlich ist.</p>
<p>Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Das berechtigte Interesse liegt in der Beschränkung des Zugangs auf berechtigte Personen. Das Benutzerkonto in Pocket-ID und Pangolin besteht, solange der Zugang eingeräumt ist, und wird auf Anfrage oder nach Entzug des Zugangs gelöscht. Anmeldeprotokolle werden nach 90 Tagen gelöscht. Sicherungskopien werden nach spätestens drei Monaten überschrieben.</p>`,
		},
		{
			id: "accounts",
			title: "Nutzerkonto und Inhalte",
			html: `<p>Infinitune übernimmt bei vertrauenswürdigen Pangolin-Anfragen Nutzerkennung, E-Mail-Adresse und Anzeigenamen. Eine SQLite-Datenbank auf der eigenen Infrastruktur in Deutschland speichert eine interne Kennung, die Identitätskennung sowie Erstellungs- und letzten Nutzungszeitpunkt. Diese Daten ordnen insbesondere Playlists und die Verwaltung von Anbieter-Zugangsdaten einem Nutzer zu.</p>
<p>Gespeichert werden Playlists, Musikbeschreibungen und Änderungswünsche, Generierungsparameter, Songs mit Metadaten und Texten, musikalische Persona-Auszüge, Bewertungen, Coverbilder und Audiodateien. Einstellungen enthalten Dienstadressen und Modelle; OAuth-Zugangsdaten für die Textgenerierung liegen lokal mit eingeschränkten Dateirechten. Audio liegt auf dem eigenen NAS in Deutschland. Wiedergaberäume verarbeiten Gerätekennungen, Gerätenamen, Rollen und Abspielpositionen im Arbeitsspeicher. Zweck ist die gewünschte Musikgenerierung, Bibliothek und Wiedergabe einschließlich der Anpassung an musikalische Vorlieben. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO; das berechtigte Interesse liegt in der Bereitstellung des angefragten Angebots für eingeladene Personen.</p>
<p>Inhalte bleiben gespeichert, bis Sie oder der Verantwortliche sie löschen. Eine allgemeine automatische Löschung von Inhalten findet nicht statt. Songs und Playlists können in der Anwendung gelöscht werden. Für die Löschung Ihres Kontos, weiterer Inhalte und verbleibender Dateien wenden Sie sich an <a href="mailto:datenschutz-infinitune@heerlab.com">datenschutz-infinitune@heerlab.com</a>. Sicherungskopien werden nach spätestens drei Monaten überschrieben.</p>`,
		},
		{
			id: "openai",
			title: "OpenAI für Textgenerierung",
			html: `<p>Infinitune verwendet OpenAI über die lokal ausgeführte Pi-Bibliothek und einen ChatGPT-/Codex-Login für Textgenerierung und Persona-Auswertung. Empfänger ist OpenAI Ireland Limited, 1st Floor, The Liffey Trust Centre, 117-126 Sheriff Street Upper, Dublin 1, D01 YC43, Irland. OpenAI handelt für dieses ChatGPT-Konto als eigener Verantwortlicher nach seinen eigenen Bedingungen und seiner Datenschutzerklärung.</p>
<p>Übermittelt werden Musikbeschreibungen und Änderungswünsche, Sprach- und Musikvorgaben, generierte Metadaten und Songtexte sowie aus Bewertungen abgeleitete Persona-Auszüge und Informationen über positiv oder negativ bewertete Songs. Die Anwendung fügt keinen Nutzernamen und keine E-Mail-Adresse als Nutzerprofil hinzu. Eingegebene und erzeugte Inhalte können dennoch personenbezogene Daten enthalten. Die Textanfragen enthalten keine Audiodateien. Zweck ist die Erzeugung der gewünschten Musik. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO; das berechtigte Interesse liegt in der Bereitstellung dieser Funktion.</p>
<p>OpenAI verarbeitet und speichert Daten auch in den USA und weiteren Ländern außerhalb des Europäischen Wirtschaftsraums. Nach seiner Datenschutzerklärung stützt OpenAI Übermittlungen auf Angemessenheitsbeschlüsse oder auf Standardvertragsklauseln der EU-Kommission nach Art. 46 Abs. 2 lit. c DSGVO. Eine Kopie der Garantien kann bei <a href="mailto:privacy@openai.com">privacy@openai.com</a> angefragt werden.</p>
<p>Nach seiner Datenschutzerklärung kann OpenAI bereitgestellte Inhalte zur Verbesserung seiner Dienste einschließlich des Modelltrainings verwenden und bietet eine Widerspruchsmöglichkeit gegen diese Nutzung an. Für die Aufbewahrung und Löschung bei OpenAI gelten dessen eigene Regeln in der verlinkten Datenschutzerklärung. Details: <a href="https://openai.com/policies/eu-privacy-policy/">OpenAI EU-Datenschutzerklärung</a>.</p>`,
		},
		{
			id: "local-generation",
			title: "ACE-Step und Ollama",
			html: `<p>ACE-Step erzeugt Audio auf eigener Hardware des Verantwortlichen in Deutschland. Verarbeitet werden Musik- und Gesangsbeschreibung, Songtexte, Tempo, Tonart, Takt, Sprache, Dauer und Modell-/Samplerparameter. Ollama läuft ebenfalls auf eigener Hardware und wird für Modelllisten und Verbindungstests angesprochen. Für diese Dienste erfolgt keine Übermittlung an externe Anbieter.</p>
<p>Zweck ist die gewünschte Musikgenerierung und deren technischer Betrieb. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Für die gespeicherten Inhalte und Sicherungskopien gelten die oben genannten Löschkriterien.</p>
<p>Weitere optionale Integrationen der Software sind nicht im Einsatz; vor ihrer Aktivierung wird diese Datenschutzerklärung aktualisiert.</p>`,
		},
		{
			id: "umami",
			title: "Selbst betriebenes Umami",
			html: `<p>Infinitune verwendet Umami auf umami.heerlab.com auf der eigenen Infrastruktur in Deutschland. Erfasst werden bereinigte Seitenpfade, Bildschirmgröße, Sprache, Lade- und Leistungswerte sowie Ereignisse zu Playlist-Erstellung, Änderungen und Status, Wiedergabe, Ende, Überspringen und Bewertungen, Songwünschen, Raumrolle, Einstellungsänderungen, Fehlerklassen und extern angeklicktem Hostnamen. Der Server sendet Generierungsstart, -ende und -fehler mit zufälligen Song-/Playlist-Kennungen, Anbieter, Modell, Phase, Dauer und Status. Prompts werden als Länge erfasst; Songtexte, Gerätenamen und Nutzerprofile werden nicht als Analyseparameter gesendet. Referrer, Abfrageparameter, Fragmente und Freigabetokens werden aus Seitenaufrufen entfernt. Eine Nutzer-Identifizierung wird nicht aufgerufen. Der Dienst und sein Proxy erhalten technisch IP und User-Agent.</p>
<p>Der Tracker liest Bildschirmgröße, Browsersprache, aktuelle Seitenadresse, Dokumenttitel und Referrer sowie Leistungs- und Navigationsdaten. Titel und Adressen werden vor dem Versand wie oben beschrieben bereinigt. Er setzt keine Cookies und schreibt keine Kennungen in localStorage, sessionStorage oder IndexedDB. Eine bereits vorhandene localStorage-Einstellung umami.disabled wird als gewünschte Analyse-Deaktivierung gelesen; die Anwendung legt sie nicht an. Sitzungszustand und Analyse-Cache bleiben im Arbeitsspeicher. Sitzungsaufzeichnungen und Heatmaps sind in der Anwendung deaktiviert; der Recorder wird nicht geladen. Die eigenständigen rechtlichen Seiten laden keinen Tracker.</p>
<p>Zweck sind Nutzungs- und Zuverlässigkeitsauswertungen. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Das berechtigte Interesse liegt darin, die Nutzung des Angebots zu verstehen und technische Probleme zu erkennen. Umami-Analysedaten werden derzeit ohne feste Löschfrist gespeichert.</p>`,
		},
		{
			id: "glitchtip",
			title: "Selbst betriebenes GlitchTip",
			html: `<p>Fehlerdiagnose erfolgt mit dem Sentry-SDK an glitchtip.heerlab.com auf der eigenen Infrastruktur in Deutschland. Daten gehen an den selbst betriebenen Dienst, nicht an Sentry SaaS. Browser, Frontend-Server und Hono-/Worker-Server übermitteln Fehler und Stacktraces, bereinigte URLs/Breadcrumbs, Release und Umgebung sowie stichprobenartige Performance-Traces. Die Deployment-Konfiguration sieht eine Trace-Stichprobe von 10 % vor. Generierungsfehler enthalten zusätzlich Song-/Playlist-Kennung, Phase, Anbieter und Modell. Eine gesondert konfigurierte CLI kann ebenfalls Fehler melden.</p>
<p>sendDefaultPii ist deaktiviert. Nutzerobjekte, Anfragekörper, freie Zusatzdaten, Auth-/Cookie-/Remote-Header sowie erkennbare E-Mail-Adressen und Tokens werden entfernt oder bereinigt. Freier Text in Fehlermeldungen kann trotz Bereinigung persönliche Inhalte enthalten. Der Browser verwendet keine Sentry-Sitzungsaufzeichnung; Sitzungsverfolgung ist deaktiviert. Die konfigurierten Integrationen setzen keine zusätzlichen Browser-Speichereinträge. Der empfangende Dienst/Proxy erhält technisch IP und User-Agent.</p>
<p>Zweck ist Fehlerbehebung und Betriebssicherheit. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO; das berechtigte Interesse liegt in einem zuverlässigen und sicheren Betrieb. Fehler und Transaktionen werden nach 90 Tagen, rohe Spans nach 30 Tagen gelöscht. Für Sicherungskopien gilt die im Abschnitt Hosting genannte Frist.</p>`,
		},
		{
			id: "email",
			title: "Kontakt per E-Mail",
			html: `<p>Wenn Sie per E-Mail Kontakt aufnehmen, werden Ihre E-Mail-Adresse, der Inhalt Ihrer Nachricht und die technischen Angaben der E-Mail verarbeitet, um Ihre Anfrage zu beantworten. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Das berechtigte Interesse liegt darin, Anfragen beantworten zu können.</p>
<p>Die E-Mail-Postfächer werden bei der Fastmail Pty Ltd, PO Box 234, Collins Street West, VIC 8007, Australien, als Auftragsverarbeiter betrieben. Dabei können Daten in Länder außerhalb der EU übermittelt werden, insbesondere nach Australien, in die USA und nach Indien. Für diese Übermittlungen verwendet Fastmail Standardvertragsklauseln der EU-Kommission (Art. 46 Abs. 2 lit. c DSGVO). Details: <a href="https://www.fastmail.com/policies/privacy/">Datenschutzerklärung von Fastmail</a>, <a href="https://www.fastmail.com/policies/dpa/">Auftragsverarbeitungsvertrag</a> und <a href="https://www.fastmail.com/policies/dpa/section3/">Standardvertragsklauseln</a>. Eine Kopie der Garantien erhalten Sie auf Anfrage an <a href="mailto:datenschutz-infinitune@heerlab.com">datenschutz-infinitune@heerlab.com</a>.</p>
<p>Der Verantwortliche löscht Nachrichten nach Erledigung der Anfrage, soweit keine Aufbewahrung erforderlich ist. Bei Fastmail können anschließend noch Sicherungs- und Protokolldaten nach dessen veröffentlichten Löschregeln verbleiben.</p>`,
		},
		{
			id: "storage",
			title: "Cookies und lokale Speicherung",
			html: `<p>Die rechtlichen Seiten selbst setzen keine Cookies und verwenden keinen Browserspeicher. Die geschützte Anwendung verwendet folgende Einträge. Die Anwendung nutzt keine IndexedDB-Datenbank.</p>
<table><thead><tr><th scope="col">Eintrag / Anbieter</th><th scope="col">Zweck</th><th scope="col">Dauer</th><th scope="col">Einordnung</th></tr></thead><tbody><tr><td>Cookie: p_session_token_s.&lt;Zeitstempel&gt; / Pangolin</td><td>Zugang für eingeladene Nutzer; auf der Ressourcendomäne, HttpOnly, Secure, SameSite=Lax</td><td>30 Tage</td><td>Technisch erforderlich, § 25 Abs. 2 Nr. 2 TDDDG</td></tr><tr><td>localStorage: infinitune-player / Infinitune</td><td>Gewünschte Lautstärke und Stummschaltung merken</td><td>Bis zum Löschen der Browserdaten</td><td>Erforderlich für die gewünschte gespeicherte Einstellung, § 25 Abs. 2 Nr. 2 TDDDG</td></tr><tr><td>sessionStorage: infinitune-device-id / Infinitune</td><td>Gerät im Wiedergaberaum erkennen</td><td>Tab-Sitzung</td><td>Gewünschte Wiedergabe, § 25 Abs. 2 Nr. 2 TDDDG</td></tr><tr><td>sessionStorage: infinitune-radio-listener-id / Infinitune</td><td>Radiohörer und Wiederverbindung erkennen</td><td>Tab-Sitzung</td><td>Gewünschte Wiedergabe, § 25 Abs. 2 Nr. 2 TDDDG</td></tr><tr><td>sessionStorage: tsr-scroll-restoration-v1_3 / TanStack Router</td><td>Scrollposition bei Navigation wiederherstellen</td><td>Tab-Sitzung</td><td>Gewünschte Navigation, § 25 Abs. 2 Nr. 2 TDDDG</td></tr><tr><td>localStorage: umami.disabled / Umami, nur gelesen falls vorhanden</td><td>Gewünschte Analyse-Deaktivierung beachten</td><td>Bis zum Löschen; wird nicht von der App angelegt</td><td>Beachtung der gewünschten Deaktivierung</td></tr><tr><td>Umami-Tracker und Sentry-SDK</td><td>Analyse und Fehlerdiagnose</td><td>Zustand im Arbeitsspeicher; Serveraufbewahrung siehe oben</td><td>Keine zusätzlichen Cookies oder Speicherkennungen; keine Sitzungsaufzeichnung oder Heatmaps</td></tr></tbody></table>
<p>Lokale Einstellungen können Sie über die Website-Daten Ihres Browsers löschen.</p>`,
		},
		{
			id: "rights",
			title: "Ihre Rechte",
			html: `<p>Sie haben gegenüber dem Verantwortlichen folgende Rechte hinsichtlich Ihrer personenbezogenen Daten:</p>
<ul><li>Auskunft (Art. 15 DSGVO)</li><li>Berichtigung (Art. 16 DSGVO)</li><li>Löschung (Art. 17 DSGVO)</li><li>Einschränkung der Verarbeitung (Art. 18 DSGVO)</li><li>Datenübertragbarkeit (Art. 20 DSGVO)</li><li>Widerruf einer erteilten Einwilligung (Art. 7 Abs. 3 DSGVO): Sie können eine erteilte Einwilligung jederzeit widerrufen. Die Rechtmäßigkeit der Verarbeitung vor dem Widerruf bleibt unberührt.</li></ul>
<p><strong>Widerspruchsrecht (Art. 21 DSGVO):</strong> Soweit eine Verarbeitung auf Art. 6 Abs. 1 lit. f DSGVO beruht, können Sie aus Gründen, die sich aus Ihrer besonderen Situation ergeben, jederzeit widersprechen.</p>
<p>Zur Ausübung Ihrer Rechte genügt eine Nachricht an <a href="mailto:datenschutz-infinitune@heerlab.com">datenschutz-infinitune@heerlab.com</a>.</p>
<p>Sie haben außerdem das Recht, sich bei einer Datenschutz-Aufsichtsbehörde zu beschweren, insbesondere in dem Mitgliedstaat Ihres gewöhnlichen Aufenthalts, Ihres Arbeitsplatzes oder des Orts des mutmaßlichen Verstoßes (Art. 77 DSGVO).</p>`,
		},
		{
			id: "required-data",
			title: "Pflicht zur Bereitstellung",
			html: `<p>Sie sind nicht verpflichtet, personenbezogene Daten bereitzustellen. Ohne die technisch notwendigen Verbindungsdaten kann die Website jedoch nicht ausgeliefert werden, und ohne Anmeldung sind die geschützten Bereiche nicht nutzbar.</p>`,
		},
		{
			id: "changes",
			title: "Änderungen",
			html: `<p>Diese Datenschutzerklärung wird angepasst, wenn sich die Website oder die Rechtslage ändert. Es gilt die jeweils hier veröffentlichte Fassung.</p>`,
		},
	],
};
