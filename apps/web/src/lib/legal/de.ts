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
			html: `<p>E-Mail: <a href="mailto:impressum@heerlab.com">impressum@heerlab.com</a><br>Kontaktformular: <a href="https://beastyrabbit.com/kontakt">beastyrabbit.com/kontakt</a></p>`,
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
<p>E-Mail: <a href="mailto:datenschutz@heerlab.com">datenschutz@heerlab.com</a></p>
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
<p>Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Das berechtigte Interesse liegt in einer sicheren und zuverlässigen Bereitstellung der Website.</p>`,
		},
		{
			id: "logs",
			title: "Server-Logfiles",
			html: `<p>Bei jedem Aufruf speichert der Reverse-Proxy automatisch folgende Daten:</p>
<ul><li>IP-Adresse des anfragenden Geräts</li><li>Datum und Uhrzeit des Zugriffs</li><li>aufgerufene Adresse (Pfad einschließlich Parameter), HTTP-Methode und Protokoll</li><li>HTTP-Statuscode, übertragene Datenmenge und Antwortzeit</li><li>Browser-Kennung (User-Agent)</li><li>verwendete TLS-Version und Verschlüsselung</li><li>angesprochener Dienst</li></ul>
<p>Die Header Cookie und Authorization werden geschwärzt. URL-Pfade und Abfrageparameter werden protokolliert.</p>
<p>Die Daten dienen dem Betrieb, der Fehleranalyse und der Abwehr von Angriffen und Missbrauch. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Das berechtigte Interesse liegt in Stabilität und Sicherheit des Angebots. Als Löschfrist für die Traefik-Logfiles sind 14 Tage vorgesehen. TODO(user): Die Einrichtung der automatischen Löschung ist noch nicht bestätigt; vor Veröffentlichung tatsächliche Frist und Sicherungen bestätigen.</p>
<p>Pangolin führt zusätzlich HTTP-Anfrageprotokolle mit Verbindungs- und Anfragedaten, Anmeldeprotokolle mit Identitätsdaten, IP und Anmeldezeit sowie Netzwerkprotokolle. Vorgesehen sind 14 Tage für HTTP-Anfragen, 90 Tage für Anmeldungen und 30 Tage für Netzwerkprotokolle. TODO(user): Die tatsächliche Umsetzung dieser Fristen einschließlich Sicherungen bestätigen.</p>
<p>Die Anwendung protokolliert mit Pino Anfragekennung, Methode, Pfad ohne Abfrageparameter, Status, Dauer und Größe sowie Song-/Playlist-Kennungen, Titel, Künstlernamen, Gerätenamen, Quelladressen und Fehler. Share-Tokens im API-Pfad werden ersetzt. Die normale Anfrageprotokollierung erfasst keine Benutzerprofile, vollständigen Anfragekörper oder Client-IP-Adressen. Warnungen zur Proxy-Konfiguration können die IP des Verbindungspartners enthalten. Ein Fehlerpfad der Agenten-Speicherung kann Chat-Inhalte protokollieren; Fehlermeldungen können weitere eingegebene Inhalte enthalten.</p>
<p>Dateiprotokollierung ist standardmäßig aktiv, sofern LOG_TO_FILE nicht auf 0 steht. Die aktuelle Datei wird alle 15 Sekunden auf die letzten 10.000 Zeilen gekürzt; für Dateien früherer Prozessstarts gibt es keine automatische zeitliche Löschung. Kubernetes hält außerdem kurzlebige Container-Protokolle vor. CrowdSec speichert lokale Warnungen und Sperrentscheidungen. Auch diese Verarbeitung dient Betrieb, Fehleranalyse und Sicherheit auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO. TODO(user): Löschfristen für Anwendungsdateien, Container-Protokolle, lokale CrowdSec-Daten und Sicherungen festlegen und bestätigen.</p>`,
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
<p>Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Das berechtigte Interesse ist, den Zugang auf eingeladene Familienmitglieder zu beschränken. Für das Anmeldeprotokoll sind 90 Tage vorgesehen, die tatsächliche Löschung ist noch zu bestätigen. Für die Löschung der Nutzerprofile in Pocket-ID und Pangolin einschließlich Sicherungen gilt TODO(user): tatsächliche Löschkriterien bestätigen. Die rechtlichen Informationsseiten sind ohne Anmeldung vorgesehen.</p>`,
		},
		{
			id: "accounts",
			title: "Nutzerkonto und Inhalte",
			html: `<p>Infinitune übernimmt bei vertrauenswürdigen Pangolin-Anfragen Nutzerkennung, E-Mail-Adresse und Anzeigenamen. In einer SQLite-Datenbank auf der eigenen Infrastruktur werden eine interne Kennung, die Identitätskennung sowie Erstellungs- und letzter Nutzungszeitpunkt gespeichert. Die Daten verknüpfen insbesondere Playlists, registrierte Geräte und die Verwaltung von Anbieter-Zugangsdaten mit einem Nutzer.</p>
<p>Gespeichert werden außerdem Playlists und Eingaben einschließlich Änderungen, generierte Songs mit Texten, Beschreibungen und Persona-Auszügen, Bewertungen, Alben, Radiowünsche, Abspielverlauf und Zeitplan, Quellenadressen, Freigabe-Tokens, Einstellungen, Agenten-Chat, Erinnerungen und Ein-/Ausgaben von Agentenläufen. Audio und Cover liegen zusätzlich als Dateien vor. Registrierte Geräte enthalten Namen, Nutzerzuordnung, Token-Hash, Fähigkeiten, Version und letzten Kontakt; Raum- und Wiedergabedaten werden auch im Arbeitsspeicher verarbeitet. Gültige Freigabelinks ermöglichen den Zugriff auf freigegebene Inhalte im Rahmen der Zugangsbeschränkungen.</p>
<p>Eigene Coverbilder können als Bilddaten hochgeladen und lokal gespeichert werden. Für die Einrichtung des OpenAI-Zugangs kann eine auth.json-Datei mit Zugangsdaten hochgeladen werden. Einstellungen umfassen Dienstadressen und Modelle. OpenRouter-API-Schlüssel werden aus älteren Datenbankeinträgen in eine lokale Pi-Zugangsdaten-Datei mit eingeschränkten Dateirechten verschoben; OAuth-Zugangsdaten können ebenfalls lokal gespeichert werden. Die Anwendung benötigt diese Daten für die gewünschte Musikgenerierung und Wiedergabe. Als Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO vorgesehen, mit dem Interesse an der Bereitstellung des angefragten Familienangebots.</p>
<p>Songs und Playlists können über die Anwendung gelöscht, Freigaben widerrufen und verwaltbare Zugangsdaten entfernt werden. Das belegt keine vollständige Löschung aller Dateien, Agenten-Sitzungen oder Sicherungen. Für dauerhafte Inhalte und Nutzerkonten gibt es keine allgemeine automatische Löschfrist. Anonyme temporäre Playlists sind auf 24 Stunden angelegt und werden regelmäßig bereinigt; als Favorit markierte temporäre Playlists sind davon ausgenommen. TODO(user): Löschkriterien für Konten, Inhalte, Medienkopien, Agentenverläufe, Geräte, Zugangsdaten, Freigaben und Sicherungen festlegen. Löschanfragen sind an datenschutz@heerlab.com möglich.</p>`,
		},
		{
			id: "openai",
			title: "OpenAI und Pi-Agenten",
			html: `<p>Die Textgenerierung verwendet je nach Konfiguration OpenAI über den Pi-Anbieter openai-codex oder OpenRouter. OpenAI ist der Standardanbieter; auch die Optimierung von Eingaben ist auf diesen Anbieter ausgerichtet. Pi ist eine lokal ausgeführte Bibliothek, kein zusätzlicher Hosting-Anbieter. Die tatsächliche Produktionskonfiguration wurde nicht aus der Datenbank ausgelesen.</p>
<p>Der gewählte Textanbieter erhält Musikbeschreibungen, Änderungswünsche und Chat-Nachrichten, Sprach- und Musikvorgaben, bisherige Titel, Künstler und Beschreibungen, positive/negative Bewertungen sowie musikalische Persona-Auszüge. Für Persona-Analysen werden Metadaten und Textauszüge übermittelt. Agenten können zusätzlich Erinnerungen, Chat-Verläufe und Werkzeugergebnisse mit vollständigen Songtexten, Quellenmetadaten und Abspiel-/Bewertungsinformationen abrufen und an das Modell weitergeben. Dauerhafte Pi-Sitzungen werden lokal fortgesetzt. Namen oder E-Mail-Adressen werden diesen Anfragen nicht gezielt als Nutzerprofil hinzugefügt; eingegebene oder abgerufene Inhalte können dennoch personenbezogene Daten enthalten.</p>
<p>Ein gesondert aktivierter OpenAI-Codex-Bildanbieter erhält stattdessen den abgeleiteten Cover-Prompt mit Bildanweisungen, gegebenenfalls Band- und Albumtext. Er erfordert eigene Zugangsdaten und eine ausdrückliche Serverkonfiguration; temporäre Bild-Auftragsverzeichnisse werden nach dem Auftrag entfernt. Der Textanbieter erhält keine Audiodatei durch die hier beschriebenen Textanfragen.</p>
<p>Zweck ist die angefragte Musik- und Covererstellung; als Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO vorgesehen. TODO(user): aktivierte Anbieter und Kontovertragsart, genaue OpenAI-Empfängergesellschaft und Anschrift, Verarbeitungsstaaten, anwendbare Übermittlungsgarantien, Trainings-/Protokollierungseinstellungen und Aufbewahrung bestätigen. Die offiziellen rechtlichen Seiten konnten bei der Prüfung nicht abgerufen werden. Quellen zur Klärung: <a href="https://openai.com/policies/eu-privacy-policy/">EU-Datenschutzerklärung</a>, <a href="https://openai.com/policies/data-processing-addendum/">Auftragsverarbeitungsbedingungen</a>.</p>`,
		},
		{
			id: "openrouter",
			title: "OpenRouter, falls konfiguriert",
			html: `<p>Bei Auswahl von OpenRouter gehen dieselben oben beschriebenen Text- und Kontextdaten an OpenRouter, Inc., 169 Madison Avenue, New York, NY 10016, USA und an den jeweils ausgewählten nachgelagerten Modellanbieter. Eine separate direkte Anthropic-Textanbindung besteht im aktuellen Code nicht; Anthropic kann jedoch ein Modellanbieter hinter OpenRouter sein.</p>
<p>Zweck und vorgesehene Rechtsgrundlage entsprechen der Textgenerierung nach Art. 6 Abs. 1 lit. f DSGVO. Die offizielle Richtlinie nennt Angemessenheitsbeschlüsse und EU-Standardvertragsklauseln für Übermittlungen außerhalb des EWR. Aufbewahrung und etwaige Nutzung von Eingaben hängen auch von Konto- und Modellanbieter-Einstellungen ab. TODO(user): tatsächliche Modelle, nachgelagerte Empfänger mit Anschriften und Staaten, Vertragsgarantien, Trainings-/Protokollierungseinstellungen und konkrete Löschfristen bestätigen. Details: <a href="https://openrouter.ai/privacy">Datenschutz</a>, <a href="https://openrouter.ai/terms">Nutzungsbedingungen</a>.</p>`,
		},
		{
			id: "inference",
			title: "Inference.sh, falls konfiguriert",
			html: `<p>Der Cover-Dienst Inference.sh erhält den aus dem Musikkontext abgeleiteten Cover-Prompt, gegebenenfalls Band-/Albumtext, Bildmodell und Ausgabeparameter, Dienst-Zugangsdaten und die Server-IP. Die Anwendung lädt das fertige Bild serverseitig herunter. Vollständige Hörverläufe, Bewertungen oder Audiodateien werden durch diesen Bildaufruf nicht gezielt mitgesendet; der Cover-Prompt kann nutzerbezogene Einzelheiten enthalten.</p>
<p>Anbieter ist laut offizieller Richtlinie Inference Shell Inc., Delaware, USA. Der gewählte App-/Modellanbieter verarbeitet die Eingaben ebenfalls; im Code sind Pruna-Bildmodelle auswählbar. Die Richtlinie nennt Verarbeitungen in den USA und Standardvertragsklauseln mit Unterauftragnehmern. Sie nennt für Eingaben/Ausgaben die Kontolaufzeit mit Löschmöglichkeit, 90 Tage für API-Nutzungs-/Authentifizierungsprotokolle und ein Jahr für Sicherheits-Auditprotokolle. Zweck ist Covererstellung, vorgesehene Rechtsgrundlage Art. 6 Abs. 1 lit. f DSGVO. TODO(user): Nutzung in Produktion, vollständige Postanschrift, tatsächliche Modell-Unterauftragnehmer und Staaten, anwendbare vertragliche Übermittlungsgarantien und konkrete Kontolöschung bestätigen. Details: <a href="https://inference.sh/privacy">Datenschutz</a>, <a href="https://inference.sh/terms">Bedingungen</a>, <a href="https://inference.sh/providers">Anbieter</a>.</p>`,
		},
		{
			id: "local-generation",
			title: "ACE-Step und Ollama",
			html: `<p>ACE-Step erhält zur Audioerstellung den Musik-/Gesangsstil, vollständige generierte oder abgeglichene Songtexte, Tempo, Tonart, Takt, Sprache, Dauer und Modell-/Sampler-Einstellungen. Bei Cover-/Repaint-Aufträgen wird zusätzlich das Referenzaudio hochgeladen. Die Standardadresse ist ein privater LAN-Dienst. Ollama wird im aktuellen Code für Modelllisten und Verbindungstests angesprochen; alte Ollama-/Anthropic-Textanbieterwerte werden auf OpenAI Codex umgestellt, nicht lokal generiert.</p>
<p>Die tatsächlichen Dienstadressen können durch Datenbankeinstellungen abweichen. Vorgesehene Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO für die angefragte Funktion. TODO(user): tatsächliche ACE-Step-/Ollama-Endpunkte, Betrieb ausschließlich auf eigener Infrastruktur in Deutschland und Löschfristen für Aufträge, Referenzaudio und Ausgaben bestätigen; bei externen Endpunkten Empfänger und Übermittlungsgarantien ergänzen.</p>`,
		},
		{
			id: "source-downloads",
			title: "Referenzaudio und lokaler Cache",
			html: `<p>Für ausdrücklich ausgewählte oder vom Musikdirektor ausgewählte Quellsongs lädt der Server mit yt-dlp Audiodateien, Titel und Dauer herunter. Zulässig sind die Extraktoren YouTube, SoundCloud und Bandcamp; generische beliebige Download-Adressen sind ausgeschlossen. Die Zielanbieter und ihre Medienserver sehen die angefragte URL beziehungsweise YouTube-Suchanfrage, die Server-IP und technische Anfragedaten. Der Browser bindet dafür keinen Player dieser Anbieter ein. Der lokale Download-Cache wird standardmäßig nach sieben Tagen seit letzter Nutzung beziehungsweise nach Größenbedarf bei etwa 1 GiB bereinigt; aktive Aufträge können Dateien länger schützen.</p>`,
		},
		{
			id: "youtube",
			title: "YouTube, falls als Quelle gewählt",
			html: `<p>Für Quellsongs bei YouTube erhält der Anbieter die ausgewählte URL oder eine YouTube-Suchanfrage, die Server-IP und technische Anfragedaten; der Server lädt Audio, Titel und Dauer. Der Browser bindet dafür keinen YouTube-Player ein. Zweck ist das angefragte Referenzaudio, vorgesehene Rechtsgrundlage Art. 6 Abs. 1 lit. f DSGVO.</p>
<p>Für EWR-Nutzer ist der Anbieter Google Ireland Limited, Gordon House, Barrow Street, Dublin 4, Irland. Google nennt für internationale Übermittlungen das EU-US Data Privacy Framework und Standardvertragsklauseln. TODO(user): tatsächliche Nutzung, Erforderlichkeit und providerseitige Aufbewahrung bestätigen. Details: <a href="https://policies.google.com/privacy?hl=de">Google-Datenschutz</a>, <a href="https://policies.google.com/privacy/frameworks?hl=de">Übermittlungsgarantien</a>.</p>`,
		},
		{
			id: "soundcloud",
			title: "SoundCloud, falls als Quelle gewählt",
			html: `<p>Bei SoundCloud erhält der Anbieter die gewählte Quelladresse, Server-IP und technische Anfragedaten für den serverseitigen Download von Audio, Titel und Dauer. Es wird kein SoundCloud-Player eingebettet. Zweck ist das angefragte Referenzaudio, vorgesehene Rechtsgrundlage Art. 6 Abs. 1 lit. f DSGVO.</p>
<p>SoundCloud nennt SoundCloud Global Limited &amp; Co. KG, Karl-Marx-Strasse 101, 12043 Berlin, Deutschland, sowie Standardvertragsklauseln bei internationalen Übermittlungen. TODO(user): tatsächliche Nutzung, Erforderlichkeit und providerseitige Aufbewahrung bestätigen. Details: <a href="https://soundcloud.com/pages/privacy">SoundCloud-Datenschutz</a>.</p>`,
		},
		{
			id: "bandcamp",
			title: "Bandcamp, falls als Quelle gewählt",
			html: `<p>Bei Bandcamp erhält der Anbieter die gewählte Quelladresse, Server-IP und technische Anfragedaten für den serverseitigen Download von Audio, Titel und Dauer. Es wird kein Bandcamp-Player eingebettet. Zweck ist das angefragte Referenzaudio, vorgesehene Rechtsgrundlage Art. 6 Abs. 1 lit. f DSGVO.</p>
<p>Bandcamp nennt Bandcamp Ventures LLC und Verarbeitungen in den USA und weiteren Ländern. Eine genaue Anschrift und ein konkreter Übermittlungsmechanismus sind nicht verifiziert. TODO(user): tatsächliche Nutzung, Erforderlichkeit, Anschrift, Übermittlungsgarantien und providerseitige Aufbewahrung klären. Details: <a href="https://bandcamp.com/privacy">Bandcamp-Datenschutz</a>, <a href="https://bandcamp.com/terms_of_use">Bedingungen</a>.</p>`,
		},
		{
			id: "lrclib",
			title: "LRCLIB",
			html: `<p>Beim Abruf passender Songtexte sendet der Server Titel und Künstlername des Quellsongs sowie die Server-IP und eine technische Infinitune-Kennung an lrclib.net oder den konfigurierten LRCLIB-Endpunkt. Die Dauer dient der lokalen Auswahl eines passenden Ergebnisses. Es werden dabei keine Audiodateien oder Songtexte zu LRCLIB hochgeladen. Abgerufene Texte können anschließend in der Datenbank gespeichert und an ACE-Step beziehungsweise über Agentenwerkzeuge an den gewählten Textanbieter weitergegeben werden.</p>
<p>Zweck ist der Textabgleich für die angefragte Cover-Funktion, vorgesehene Rechtsgrundlage Art. 6 Abs. 1 lit. f DSGVO. TODO(user): tatsächliche Nutzung, verantwortliche Gesellschaft, Anschrift, Verarbeitungsstaaten, Übermittlungsgarantien und Aufbewahrung feststellen. Die <a href="https://lrclib.net">offizielle Website</a> und <a href="https://lrclib.net/docs">Dokumentation</a> ergaben bei der Prüfung keine belastbaren rechtlichen Angaben.</p>`,
		},
		{
			id: "research",
			title: "Abruf öffentlicher Webseiten",
			html: `<p>Musikagenten können öffentliche Webseiten abrufen. Die jeweiligen Server erhalten die Zieladresse, Server-IP und technische Anfragedaten. Inhalte der Recherche können dem gewählten Textmodell als Kontext dienen. Die Empfänger hängen von den tatsächlich abgerufenen Domains ab.</p>
<p>Zweck ist die Musik-/Quellenrecherche, vorgesehene Rechtsgrundlage Art. 6 Abs. 1 lit. f DSGVO. TODO(user): tatsächliche Nutzung und Domains, Erforderlichkeit, vollständige Empfänger mit Anschriften, Aufbewahrung und anwendbare Drittlandgarantien prüfen.</p>`,
		},
		{
			id: "duckduckgo",
			title: "DuckDuckGo für Musikrecherche",
			html: `<p>Musikagenten können Suchanfragen aus dem Playlist-Kontext an DuckDuckGo senden. Der Dienst erhält Suchbegriffe, Server-IP und technische Anfragedaten. Suchanfragen können Einzelheiten Ihrer Eingaben enthalten; Rechercheergebnisse können dem gewählten Textmodell als Kontext dienen.</p>
<p>DuckDuckGo nennt Duck Duck Go, Inc., 20 Paoli Pike, Paoli, Pennsylvania 19301, USA, und erklärt, keine mit IP-Adressen verknüpften Suchverläufe zu speichern. Die offizielle Richtlinie beschreibt weltweiten Betrieb, belegt aber keinen konkreten Übermittlungsmechanismus für diese Anfragen. Zweck ist die Musik-/Quellenrecherche, vorgesehene Rechtsgrundlage Art. 6 Abs. 1 lit. f DSGVO. TODO(user): tatsächliche Nutzung, Erforderlichkeit, Aufbewahrung und anwendbare Drittlandgarantien prüfen. Details: <a href="https://duckduckgo.com/privacy">Datenschutz</a>, <a href="https://duckduckgo.com/terms">Bedingungen</a>, <a href="https://duckduckgo.com/duckduckgo-help-pages/company/contact-us">offizielle Kontaktanschrift</a>.</p>`,
		},
		{
			id: "wikimedia",
			title: "Wikipedia für Musikrecherche",
			html: `<p>Musikagenten können Suchanfragen aus dem Playlist-Kontext an die Wikipedia-Suche senden. Der Dienst erhält Suchbegriffe, Server-IP und technische Anfragedaten. Suchanfragen können Einzelheiten Ihrer Eingaben enthalten; Rechercheergebnisse können dem gewählten Textmodell als Kontext dienen.</p>
<p>Wikipedia wird von Wikimedia Foundation, Inc., 1 Sansome Street, Suite 1895, San Francisco, California 94104, USA, betrieben. Zweck ist die Musik-/Quellenrecherche, vorgesehene Rechtsgrundlage Art. 6 Abs. 1 lit. f DSGVO. TODO(user): tatsächliche Nutzung, Erforderlichkeit, Aufbewahrung und anwendbare Drittlandgarantien prüfen. Details: <a href="https://foundation.wikimedia.org/wiki/Policy:Privacy_policy">Wikimedia-Datenschutz</a>, <a href="https://wikimediafoundation.org/about/contact/">offizielle Kontaktanschrift</a>.</p>`,
		},
		{
			id: "alternate-auth",
			title: "Alternative Anmeldung mit Shoo, falls verwendet",
			html: `<p>Zusätzlich zur Pangolin-Anmeldung akzeptiert der Server optional Shoo-Bearer-Tokens. Er ruft dafür öffentliche Signatur-Schlüssel beim konfigurierten Aussteller ab, standardmäßig shoo.dev. Eine paarweise Nutzerkennung und gegebenenfalls E-Mail-Adresse, Name und Profilbild werden lokal gespeichert. Der Token kann im lokalen Browserspeicher liegen. Es ist nicht verifiziert, dass diese Alternative in Produktion verwendet wird.</p>
<p>Shoo beschreibt sich als Google-Anmeldevermittler und nennt Identitäts-/Einwilligungsdaten bis zur Löschung sowie kurzlebige Sicherheitsdaten. Vorgesehener Zweck ist die angefragte Anmeldung nach Art. 6 Abs. 1 lit. f DSGVO. TODO(user): Nutzung, Erforderlichkeit, genaue Gesellschaft und Anschrift, Staaten, Garantien und Löschfristen bestätigen. Details: <a href="https://shoo.dev/privacy">Shoo-Datenschutz</a>.</p>`,
		},
		{
			id: "umami",
			title: "Selbst betriebenes Umami",
			html: `<p>Die Anwendung ist für Umami auf umami.heerlab.com auf der eigenen Infrastruktur in Deutschland konfiguriert. Erfasst werden bereinigte Seitenpfade, Bildschirm-/Sprachdaten und Lade-/Leistungswerte sowie Ereignisse zu Playlist-Erstellung, Änderungen und Status, Wiedergabe, Ende, Überspringen und Bewertungen, Songwünschen, Raumrolle, Einstellungsänderungen, Fehlerklassen und extern angeklicktem Hostnamen. Der Server sendet Generierungsstart, -ende und -fehler mit zufälligen Song-/Playlist-Kennungen, Anbieter, Modell, Phase, Dauer und Status. Prompts werden als Länge erfasst; Texte, Gerätenamen und Nutzerprofile werden nicht gezielt als Analyseparameter gesendet. Referrer, Abfrageparameter, Fragmente und Freigabetokens werden aus Seitenaufrufen entfernt. Eine Nutzer-Identifizierung wird nicht aufgerufen. Der Dienst und sein Proxy sehen technisch dennoch IP und User-Agent.</p>
<p>Der Code unterstützt zusätzlich Sitzungsaufzeichnungen und Heatmaps, wenn die Umami-Richtlinie Aufzeichnung aktiviert und strikte Text-/Eingabemaskierung sowie Sperren für private Bereiche vorgibt. Eine zusätzliche Bereinigung filtert Inhalte und URLs. Die bisherige Telemetrieprüfung meldete einen durch SSO gesperrten öffentlichen Richtlinien-Endpunkt, weshalb dort keine Aufzeichnung startete. Die aktuelle Produktionsrichtlinie und ihre Erreichbarkeit sind nicht unabhängig bestätigt. Maskierung schließt alle Restrisiken nicht aus. Der untersuchte Tracker setzt keine Cookies und schreibt keine Speicherkennungen; er liest eine gegebenenfalls vorhandene Einstellung umami.disabled.</p>
<p>Zweck sind Nutzungs- und Zuverlässigkeitsauswertungen. Als Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO vorgesehen. Eine Einwilligungsabfrage ist nicht implementiert. TODO(user): Erforderlichkeit und Rechtsgrundlage einschließlich möglicher Einwilligung nach § 25 Abs. 1 TDDDG und Art. 6 Abs. 1 lit. a DSGVO, tatsächliche Aufzeichnungs-/Heatmap-Einstellung sowie Löschfristen einschließlich Sicherungen klären. Eine maximale Aufzeichnungsdauer ist keine Speicherfrist. Die eigenständigen rechtlichen Seiten laden keinen Tracker.</p>`,
		},
		{
			id: "glitchtip",
			title: "Selbst betriebenes GlitchTip",
			html: `<p>Fehlerdiagnose erfolgt mit dem Sentry-SDK an glitchtip.heerlab.com auf der eigenen Infrastruktur in Deutschland. Daten gehen an den selbst betriebenen Dienst, nicht an Sentry SaaS. Browser, Frontend-Server und Hono-/Worker-Server übermitteln Fehler und Stacktraces, bereinigte URLs/Breadcrumbs, Release und Umgebung sowie stichprobenartige Performance-Traces. Die Deployment-Konfiguration sieht eine Trace-Stichprobe von 10 % vor. Generierungsfehler enthalten zusätzlich Song-/Playlist-Kennung, Phase, Anbieter und Modell. Eine gesondert konfigurierte CLI kann ebenfalls Fehler melden.</p>
<p>sendDefaultPii ist deaktiviert. Nutzerobjekte, Anfragekörper, freie Zusatzdaten, Auth-/Cookie-/Remote-Header sowie erkennbare E-Mail-Adressen und Tokens werden entfernt oder bereinigt. Freier Text in Fehlermeldungen kann trotz Bereinigung persönliche Inhalte enthalten. Der Browser verwendet keine Sentry-Sitzungsaufzeichnung; Sitzungsverfolgung ist deaktiviert. Die konfigurierten Integrationen setzen keine zusätzlichen Browser-Speichereinträge. Der empfangende Dienst/Proxy erhält technisch IP und User-Agent.</p>
<p>Zweck ist Fehlerbehebung und Betriebssicherheit, vorgesehene Rechtsgrundlage Art. 6 Abs. 1 lit. f DSGVO. TODO(user): Löschfristen für Fehler, Traces und Sicherungen bestätigen.</p>`,
		},
		{
			id: "resend",
			title: "Resend für Fehlerbenachrichtigungen",
			html: `<p>GlitchTip hat SMTP-Versand über Resend konfiguriert. Falls Fehlerbenachrichtigungen aktiviert sind, können Empfängeradresse, Benachrichtigungsinhalt und E-Mail-Metadaten an Plus Five Five, Inc., 2261 Market Street #5039, San Francisco, CA 94114, USA, gehen. Resends offizieller Auftragsverarbeitungsvertrag nennt EU-US-Data-Privacy-Framework-Zertifizierung und Standardvertragsklauseln. Details: <a href="https://resend.com/legal/privacy-policy">Resend-Datenschutz</a>, <a href="https://resend.com/legal/dpa">Vertrag</a>.</p>
<p>Zweck ist die Benachrichtigung über Fehler, vorgesehene Rechtsgrundlage Art. 6 Abs. 1 lit. f DSGVO. TODO(user): tatsächliche Benachrichtigungen, deren Datenumfang, Erforderlichkeit, Resend-Vertrag und Aufbewahrung bestätigen.</p>`,
		},
		{
			id: "email",
			title: "Kontakt per E-Mail",
			html: `<p>Wenn Sie per E-Mail Kontakt aufnehmen, werden Ihre E-Mail-Adresse, der Inhalt Ihrer Nachricht und die technischen Angaben der E-Mail verarbeitet, um Ihre Anfrage zu beantworten. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Das berechtigte Interesse liegt darin, Anfragen beantworten zu können.</p>
<p>Die E-Mail-Postfächer werden bei der Fastmail Pty Ltd, PO Box 234, Collins Street West, VIC 8007, Australien, als Auftragsverarbeiter betrieben. Dabei können Daten in Länder außerhalb der EU übermittelt werden, insbesondere nach Australien, in die USA und nach Indien. Für diese Übermittlungen verwendet Fastmail Standardvertragsklauseln der EU-Kommission (Art. 46 Abs. 2 lit. c DSGVO). Details: <a href="https://www.fastmail.com/policies/privacy/">Datenschutzerklärung von Fastmail</a>, <a href="https://www.fastmail.com/policies/dpa/">Auftragsverarbeitungsvertrag</a> und <a href="https://www.fastmail.com/policies/dpa/section3/">Standardvertragsklauseln</a>. Eine Kopie der Garantien erhalten Sie auf Anfrage an <a href="mailto:datenschutz@heerlab.com">datenschutz@heerlab.com</a>.</p>
<p>Der Verantwortliche löscht Nachrichten nach Erledigung der Anfrage, soweit keine Aufbewahrung erforderlich ist. Bei Fastmail können anschließend noch Sicherungs- und Protokolldaten nach dessen veröffentlichten Löschregeln verbleiben.</p>`,
		},
		{
			id: "storage",
			title: "Cookies und lokale Speicherung",
			html: `<p>Die rechtlichen Seiten selbst setzen keine Cookies und verwenden keinen Browserspeicher. Für die geschützte Anwendung ergeben sich folgende Einträge aus dem Code und früheren lokalen Telemetrietests; die angemeldete Live-Anwendung konnte wegen einer Unauthorized-Antwort nicht geprüft werden. Es wurde keine IndexedDB-Nutzung im Anwendungscode gefunden.</p>
<table><thead><tr><th scope="col">Eintrag / Anbieter</th><th scope="col">Zweck</th><th scope="col">Dauer</th><th scope="col">Einordnung</th></tr></thead><tbody><tr><td>Pangolin-Sitzungs-Cookie</td><td>Zugang für eingeladene Nutzer</td><td>TODO(user): Name, Geltungsbereich und Laufzeit bestätigen</td><td>Technisch erforderlich, § 25 Abs. 2 Nr. 2 TDDDG</td></tr><tr><td>localStorage: infinitune-player / Infinitune</td><td>Gewünschte Lautstärke und Stummschaltung merken</td><td>Bis zum Löschen der Browserdaten</td><td>Erforderlich für die gewünschte gespeicherte Einstellung, § 25 Abs. 2 Nr. 2 TDDDG</td></tr><tr><td>localStorage: infinitune-shoo-id-token / Infinitune, nur falls verwendet</td><td>Alternativer Anmeldetoken</td><td>Bis zum Entfernen/Löschen; Tokenablauf entfernt den Eintrag nicht</td><td>Für diese Anmeldung erforderlich, § 25 Abs. 2 Nr. 2 TDDDG</td></tr><tr><td>sessionStorage: infinitune-device-id / Infinitune</td><td>Gerät im Wiedergaberaum erkennen</td><td>Tab-Sitzung</td><td>Gewünschte Wiedergabe, § 25 Abs. 2 Nr. 2 TDDDG</td></tr><tr><td>sessionStorage: infinitune-radio-listener-id / Infinitune</td><td>Radiohörer und Wiederverbindung erkennen</td><td>Tab-Sitzung</td><td>Gewünschte Wiedergabe, § 25 Abs. 2 Nr. 2 TDDDG</td></tr><tr><td>sessionStorage: tsr-scroll-restoration-v1_3 / TanStack Router</td><td>Scrollposition bei Navigation wiederherstellen</td><td>Tab-Sitzung</td><td>Gewünschte Navigation, § 25 Abs. 2 Nr. 2 TDDDG</td></tr><tr><td>localStorage: umami.disabled / Umami, nur gelesen falls vorhanden</td><td>Gewünschte Analyse-Deaktivierung beachten</td><td>Bis zum Löschen; wird nicht von der App angelegt</td><td>Beachtung der gewünschten Deaktivierung</td></tr><tr><td>Umami-Tracker und Sentry-SDK</td><td>Analyse und Fehlerdiagnose</td><td>Zustand im Arbeitsspeicher; Serveraufbewahrung siehe oben</td><td>Keine weiteren Speicherkennungen im untersuchten Tracker/SDK; Recorder und Einwilligungsbedarf noch zu bestätigen</td></tr></tbody></table>
<p>TODO(user): HTTP-only-Cookies und vollständige Speicherliste in einer angemeldeten Live-Sitzung prüfen, insbesondere bei aktivierter Aufzeichnung. Lokale Einstellungen können Sie über die Website-Daten Ihres Browsers löschen.</p>`,
		},
		{
			id: "rights",
			title: "Ihre Rechte",
			html: `<p>Sie haben gegenüber dem Verantwortlichen folgende Rechte hinsichtlich Ihrer personenbezogenen Daten:</p>
<ul><li>Auskunft (Art. 15 DSGVO)</li><li>Berichtigung (Art. 16 DSGVO)</li><li>Löschung (Art. 17 DSGVO)</li><li>Einschränkung der Verarbeitung (Art. 18 DSGVO)</li><li>Datenübertragbarkeit (Art. 20 DSGVO)</li><li>Widerruf einer erteilten Einwilligung (Art. 7 Abs. 3 DSGVO): Sie können eine erteilte Einwilligung jederzeit widerrufen. Die Rechtmäßigkeit der Verarbeitung vor dem Widerruf bleibt unberührt.</li></ul>
<p><strong>Widerspruchsrecht (Art. 21 DSGVO):</strong> Soweit eine Verarbeitung auf Art. 6 Abs. 1 lit. f DSGVO beruht, können Sie aus Gründen, die sich aus Ihrer besonderen Situation ergeben, jederzeit widersprechen.</p>
<p>Zur Ausübung Ihrer Rechte genügt eine Nachricht an <a href="mailto:datenschutz@heerlab.com">datenschutz@heerlab.com</a>.</p>
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
