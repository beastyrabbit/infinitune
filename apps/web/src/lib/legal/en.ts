import type { LegalDocument } from "./types";

export const notice: LegalDocument = {
	lang: "en",
	kind: "notice",
	title: "Legal Notice (Impressum)",
	updated: "21 October 2026",
	sections: [
		{
			id: "provider",
			title: "Provider",
			html: `<p>Tobias Heer<br>c/o Impressumservice Dein-Impressum<br>Stettiner Str. 41<br>35410 Hungen<br>Germany</p>`,
		},
		{
			id: "contact",
			title: "Contact",
			html: `<p>E-mail: <a href="mailto:impressum-infinitune@heerlab.com">impressum-infinitune@heerlab.com</a><br>Contact form: <a href="https://beastyrabbit.com/kontakt?from=infinitune">beastyrabbit.com/kontakt</a></p>`,
		},
		{
			id: "note",
			title: "Note",
			html: `<p>Infinitune is a private, non-commercial project.</p>`,
		},
		{
			id: "privacy",
			title: "Privacy",
			html: `<p>For information on how personal data is processed, see the <a href="/privacy">Privacy Policy</a>.</p>`,
		},
	],
};

export const privacy: LegalDocument = {
	lang: "en",
	kind: "privacy",
	title: "Privacy Policy",
	updated: "21 October 2026",
	sections: [
		{
			id: "controller",
			title: "Controller",
			html: `<p>The controller responsible for processing personal data on https://infinitune.heerlab.com is:</p>
<p>Tobias Heer<br>c/o Impressumservice Dein-Impressum<br>Stettiner Str. 41<br>35410 Hungen<br>Germany</p>
<p>E-mail: <a href="mailto:datenschutz-infinitune@heerlab.com">datenschutz-infinitune@heerlab.com</a></p>
<p>No data protection officer has been appointed, as there is no legal obligation to do so.</p>`,
		},
		{
			id: "overview",
			title: "Overview",
			html: `<p>This policy explains which personal data is processed when you use Infinitune, for what purposes, on which legal basis, and for how long. Infinitune is a private, non-commercial project. Infinitune generates and plays AI music based on your descriptions. Ratings and previous tracks influence music selection without making legal or similarly significant decisions about you.</p>
<p>Personal data is not sold and not used for advertising. There is no automated decision-making, including profiling, within the meaning of Art. 22 GDPR.</p>`,
		},
		{
			id: "hosting",
			title: "Hosting and delivery",
			html: `<p>Infinitune runs on the controller's own server infrastructure in Germany. Requests from the internet reach the application through a reverse proxy on a virtual server operated by netcup GmbH, Emmy-Noether-Straße 10, 76131 Karlsruhe, Germany (data center in Nuremberg). netcup processes the data as a processor under a data processing agreement pursuant to Art. 28 GDPR. The connection is TLS-encrypted up to the reverse proxy and forwarded from there to the controller's infrastructure through an encrypted tunnel.</p>
<p>The legal basis is Art. 6(1)(f) GDPR. The legitimate interest is the secure and reliable provision of the website.</p>
<p>Backups are regularly created within the controller's own infrastructure to safeguard data; they are overwritten after their retention period expires.</p>`,
		},
		{
			id: "logs",
			title: "Server log files",
			html: `<p>For every request, the reverse proxy automatically stores the following data:</p>
<ul><li>IP address of the requesting device</li><li>date and time of access</li><li>requested address (path including parameters), HTTP method and protocol</li><li>HTTP status code, amount of data transferred, and response time</li><li>browser identifier (user agent)</li><li>TLS version and cipher used</li><li>target service</li></ul>
<p>The Cookie and Authorization headers are redacted. URL paths and query parameters are logged.</p>
<p>This data is used to operate the site, analyse errors, and defend against attacks and abuse. The legal basis is Art. 6(1)(f) GDPR. The legitimate interest is the stability and security of the service. Log files are deleted automatically after 14 days.</p>
<p>The sign-in proxy Pangolin keeps request logs for 14 days, sign-in logs for 90 days and network logs for 30 days. The application keeps its own technical logs of requests, song and playlist IDs and titles, and errors for 14 days; there are also short-lived container logs. These logs support operation, error analysis and security under Art. 6(1)(f) GDPR.</p>`,
		},
		{
			id: "crowdsec",
			title: "Protection against attacks (CrowdSec)",
			html: `<p>To protect against attacks, the security software CrowdSec automatically analyses the server log files and blocks IP addresses that are clearly the source of attacks (for example mass login attempts or scanning for vulnerabilities). When CrowdSec detects an attack, the IP address, time and type of attack are sent to CrowdSec SAS, 20 rue Maurice Arnoux, 92120 Montrouge, France. CrowdSec uses these reports for a shared blocklist that protects many servers. No data is sent to CrowdSec during normal browsing.</p>
<p>The legal basis is Art. 6(1)(f) GDPR. The legitimate interest is protecting the website and its users from attacks.</p>
<p>According to CrowdSec, the controller and CrowdSec are jointly responsible for this processing (Art. 26 GDPR): CrowdSec is responsible for operating its central services and blocklists, the controller for its use on this server. You can exercise your rights against either of them; CrowdSec can be reached at <a href="mailto:dpo@crowdsec.net">dpo@crowdsec.net</a>. CrowdSec may pass the reported data on to members and partners of its network. According to CrowdSec, transfers to countries outside the EU are based on the European Commission's Standard Contractual Clauses (Art. 46(2)(c) GDPR).</p>
<p>Full IP addresses are generally retained for no more than three months and then progressively generalised. CrowdSec describes exceptions of up to one year before anonymisation for certain attack analyses and training purposes. Details: <a href="https://www.crowdsec.net/privacy-policy">crowdsec.net/privacy-policy</a>.</p>`,
		},
		{
			id: "sso",
			title: "Sign-in (single sign-on)",
			html: `<p>Infinitune is only accessible to invited people. Sign-in is handled by the Pangolin reverse proxy with Pocket-ID, an identity service self-hosted on the controller's infrastructure. This processes your user name, e-mail address, group membership, time of sign-in and IP address. After sign-in, Pangolin sets a session cookie that is technically required for access.</p>
<p>The legal basis is Art. 6(1)(f) GDPR. The legitimate interest is restricting access to authorised people. The user account in Pocket-ID and Pangolin exists for as long as access is granted and is deleted on request or after access is withdrawn. Sign-in logs are deleted after 90 days.</p>`,
		},
		{
			id: "accounts",
			title: "User account and content",
			html: `<p>Infinitune stores identity data from the sign-in proxy, including user ID, e-mail address and name, along with playlists, music descriptions, generated songs including lyrics and cover images, ratings and musical preferences derived from them, and settings. Data are processed on the controller's own infrastructure in Germany to provide music generation, the library and playback, and adapt them to musical preferences. The legal basis is Art. 6(1)(f) GDPR; the legitimate interest is providing the service for invited people.</p>
<p>Content is kept until deleted, for up to 10 years at most. Songs and playlists can be deleted in the application. You can request deletion of your account and other content at <a href="mailto:datenschutz-infinitune@heerlab.com">datenschutz-infinitune@heerlab.com</a>.</p>`,
		},
		{
			id: "openai",
			title: "OpenAI for text generation",
			html: `<p>Infinitune uses OpenAI for text generation and analysis of musical preferences. The recipient is OpenAI Ireland Limited, 1st Floor, The Liffey Trust Centre, 117-126 Sheriff Street Upper, Dublin 1, D01 YC43, Ireland, acting as its own controller under its terms. Data sent include music descriptions and requested changes, generated texts, and musical preferences derived from ratings. The legal basis is Art. 6(1)(f) GDPR; the legitimate interest is providing the requested music generation.</p>
<p>Data are also processed in the USA and other countries; according to OpenAI, transfers rely on adequacy decisions or the European Commission's Standard Contractual Clauses. Use of the data, including possible use to improve its services, and retention are governed by the rules in the <a href="https://openai.com/policies/eu-privacy-policy/">OpenAI EU privacy policy</a>.</p>`,
		},
		{
			id: "local-generation",
			title: "ACE-Step and Ollama",
			html: `<p>Music generation with ACE-Step and operation of Ollama run on the controller's own hardware in Germany, without transferring data to external providers. Further optional software integrations are not in use; this privacy policy will be updated before any is enabled.</p>`,
		},
		{
			id: "umami",
			title: "Self-hosted Umami",
			html: `<p>Infinitune uses self-hosted Umami on the controller's own infrastructure in Germany for usage events and page views without cookies or device identifiers; there is no session recording. The legal basis is Art. 6(1)(f) GDPR; the legitimate interest is understanding use of the service and detecting technical problems. Analytics data are deleted automatically after 25 months.</p>`,
		},
		{
			id: "glitchtip",
			title: "Self-hosted GlitchTip",
			html: `<p>Infinitune uses self-hosted GlitchTip on the controller's own infrastructure in Germany for error reports containing error details, technical context and sampled performance data. Personal data are removed as far as possible. The legal basis is Art. 6(1)(f) GDPR; the legitimate interest is debugging and operational security, and the data are deleted after 90 days at the latest.</p>`,
		},
		{
			id: "email",
			title: "Contact by e-mail",
			html: `<p>If you contact us by e-mail, your e-mail address, the content of your message and the technical details of the e-mail are processed to answer your request. The legal basis is Art. 6(1)(f) GDPR. The legitimate interest is being able to answer requests.</p>
<p>The mailboxes are hosted by Fastmail Pty Ltd, PO Box 234, Collins Street West, VIC 8007, Australia, as a processor. Data may be transferred to countries outside the EU, in particular Australia, the USA and India. For these transfers, Fastmail uses the European Commission's Standard Contractual Clauses (Art. 46(2)(c) GDPR). Details: <a href="https://www.fastmail.com/policies/privacy/">Fastmail privacy policy</a>, <a href="https://www.fastmail.com/policies/dpa/">data processing agreement</a> and <a href="https://www.fastmail.com/policies/dpa/section3/">Standard Contractual Clauses</a>. You can obtain a copy of the safeguards by writing to <a href="mailto:datenschutz-infinitune@heerlab.com">datenschutz-infinitune@heerlab.com</a>.</p>
<p>The controller deletes messages after dealing with the request unless retention remains necessary. Fastmail may subsequently retain backup and log data under its published deletion rules.</p>`,
		},
		{
			id: "storage",
			title: "Cookies and local storage",
			html: `<p>Pangolin sets a technically necessary sign-in session cookie lasting 30 days. Local browser storage is used for player settings and the playback session; this storage is technically necessary under Section 25(2) no. 2 TDDDG. No tracking cookies are used.</p>`,
		},
		{
			id: "rights",
			title: "Your rights",
			html: `<p>You have the following rights regarding your personal data:</p>
<ul><li>access (Art. 15 GDPR)</li><li>rectification (Art. 16 GDPR)</li><li>erasure (Art. 17 GDPR)</li><li>restriction of processing (Art. 18 GDPR)</li><li>data portability (Art. 20 GDPR)</li><li>withdrawal of consent (Art. 7(3) GDPR): you may withdraw consent at any time. Withdrawal does not affect the lawfulness of processing before withdrawal.</li></ul>
<p><strong>Right to object (Art. 21 GDPR):</strong> Where processing is based on Art. 6(1)(f) GDPR, you may object at any time on grounds relating to your particular situation.</p>
<p>To exercise your rights, simply send a message to <a href="mailto:datenschutz-infinitune@heerlab.com">datenschutz-infinitune@heerlab.com</a>.</p>
<p>You also have the right to lodge a complaint with a data protection supervisory authority, in particular in the member state of your habitual residence, place of work or place of the alleged infringement (Art. 77 GDPR).</p>`,
		},
		{
			id: "required-data",
			title: "Obligation to provide data",
			html: `<p>You are not obliged to provide personal data. However, the website cannot be delivered without the technically necessary connection data, and the protected areas cannot be used without signing in.</p>`,
		},
		{
			id: "changes",
			title: "Changes",
			html: `<p>This privacy policy is updated when the website or the legal situation changes. The version published here applies.</p>`,
		},
	],
};
