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
<p>Zur Datensicherung werden regelmäßig Sicherungskopien innerhalb der eigenen Infrastruktur erstellt; sie werden nach Ablauf ihrer Aufbewahrungszeit überschrieben.</p>`,
		},
		{
			id: "logs",
			title: "Server-Logfiles",
			html: `<p>Bei jedem Aufruf speichert der Reverse-Proxy automatisch folgende Daten:</p>
<ul><li>IP-Adresse des anfragenden Geräts</li><li>Datum und Uhrzeit des Zugriffs</li><li>aufgerufene Adresse (Pfad einschließlich Parameter), HTTP-Methode und Protokoll</li><li>HTTP-Statuscode, übertragene Datenmenge und Antwortzeit</li><li>Browser-Kennung (User-Agent)</li><li>verwendete TLS-Version und Verschlüsselung</li><li>angesprochener Dienst</li></ul>
<p>Die Header Cookie und Authorization werden geschwärzt. URL-Pfade und Abfrageparameter werden protokolliert.</p>
<p>Die Daten dienen dem Betrieb, der Fehleranalyse und der Abwehr von Angriffen und Missbrauch. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Das berechtigte Interesse liegt in Stabilität und Sicherheit des Angebots. Die Logfiles werden nach 14 Tagen automatisch gelöscht.</p>
<p>Der Anmelde-Proxy Pangolin speichert Anfrageprotokolle für 14 Tage, Anmeldeprotokolle für 90 Tage und Netzwerkprotokolle für 30 Tage. Die Anwendung führt eigene technische Protokolle zu Anfragen, Song- und Playlist-Kennungen und Titeln sowie Fehlern für 14 Tage; hinzu kommen kurzlebige Container-Protokolle. Diese Protokolle dienen Betrieb, Fehleranalyse und Sicherheit auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO.</p>`,
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
<p>Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Das berechtigte Interesse liegt in der Beschränkung des Zugangs auf berechtigte Personen. Das Benutzerkonto in Pocket-ID und Pangolin besteht, solange der Zugang eingeräumt ist, und wird auf Anfrage oder nach Entzug des Zugangs gelöscht. Anmeldeprotokolle werden nach 90 Tagen gelöscht.</p>`,
		},
		{
			id: "accounts",
			title: "Nutzerkonto und Inhalte",
			html: `<p>Infinitune speichert Identitätsdaten aus dem Anmelde-Proxy, insbesondere Nutzerkennung, E-Mail-Adresse und Name, sowie Playlists, Musikbeschreibungen, generierte Songs einschließlich Songtexten und Coverbildern, Bewertungen und daraus abgeleitete musikalische Vorlieben sowie Einstellungen. Die Verarbeitung erfolgt auf der eigenen Infrastruktur in Deutschland, um Musikgenerierung, Bibliothek und Wiedergabe bereitzustellen und an musikalische Vorlieben anzupassen. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO; das berechtigte Interesse liegt in der Bereitstellung des Angebots für eingeladene Personen.</p>
<p>Inhalte bleiben bis zur Löschung gespeichert, höchstens bis zu 10 Jahre. Songs und Playlists können in der Anwendung gelöscht werden. Die Löschung Ihres Kontos und weiterer Inhalte können Sie unter <a href="mailto:datenschutz-infinitune@heerlab.com">datenschutz-infinitune@heerlab.com</a> anfragen.</p>`,
		},
		{
			id: "openai",
			title: "OpenAI für Textgenerierung",
			html: `<p>Infinitune verwendet OpenAI zur Textgenerierung und zur Auswertung musikalischer Vorlieben. Empfänger ist OpenAI Ireland Limited, 1st Floor, The Liffey Trust Centre, 117-126 Sheriff Street Upper, Dublin 1, D01 YC43, Irland, als eigener Verantwortlicher nach seinen Bedingungen. Übermittelt werden Musikbeschreibungen und Änderungswünsche, generierte Texte sowie aus Bewertungen abgeleitete musikalische Vorlieben. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO; das berechtigte Interesse liegt in der Bereitstellung der gewünschten Musikgenerierung.</p>
<p>Daten werden auch in den USA und weiteren Ländern verarbeitet; nach Angaben von OpenAI beruhen Übermittlungen auf Angemessenheitsbeschlüssen oder Standardvertragsklauseln der EU-Kommission. Für die Nutzung der Daten, einschließlich einer möglichen Verwendung zur Verbesserung seiner Dienste, und die Aufbewahrung gelten die Regeln in der <a href="https://openai.com/policies/eu-privacy-policy/">OpenAI EU-Datenschutzerklärung</a>.</p>`,
		},
		{
			id: "local-generation",
			title: "ACE-Step und Ollama",
			html: `<p>Die Musikgenerierung mit ACE-Step und der Betrieb von Ollama erfolgen auf eigener Hardware des Verantwortlichen in Deutschland; dabei werden keine Daten an externe Anbieter übermittelt. Weitere optionale Integrationen der Software sind nicht im Einsatz; vor ihrer Aktivierung wird diese Datenschutzerklärung aktualisiert.</p>`,
		},
		{
			id: "umami",
			title: "Selbst betriebenes Umami",
			html: `<p>Infinitune verwendet selbst betriebenes Umami auf der eigenen Infrastruktur in Deutschland für Nutzungsereignisse und Seitenaufrufe ohne Cookies oder Gerätekennungen; Sitzungsaufzeichnungen finden nicht statt. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO; das berechtigte Interesse liegt darin, die Nutzung des Angebots zu verstehen und technische Probleme zu erkennen. Die Analysedaten werden bis zu 10 Jahre gespeichert.</p>`,
		},
		{
			id: "glitchtip",
			title: "Selbst betriebenes GlitchTip",
			html: `<p>Infinitune verwendet selbst betriebenes GlitchTip auf der eigenen Infrastruktur in Deutschland für Fehlerberichte mit Fehlerdetails, technischem Kontext und stichprobenartigen Leistungsdaten. Personenbezogene Daten werden dabei soweit wie möglich entfernt. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO; das berechtigte Interesse liegt in Fehlerbehebung und Betriebssicherheit, und die Daten werden nach 90 Tagen gelöscht.</p>`,
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
			html: `<p>Pangolin setzt für die Anmeldung ein technisch notwendiges Sitzungs-Cookie mit einer Laufzeit von 30 Tagen. Lokaler Browserspeicher wird für Player-Einstellungen und die Wiedergabesitzung verwendet; diese Speicherung ist technisch erforderlich gemäß § 25 Abs. 2 Nr. 2 TDDDG. Tracking-Cookies werden nicht eingesetzt.</p>`,
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
