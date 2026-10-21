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
<p>Backups are stored within the controller's own infrastructure and overwritten after no more than three months.</p>`,
		},
		{
			id: "logs",
			title: "Server log files",
			html: `<p>For every request, the reverse proxy automatically stores the following data:</p>
<ul><li>IP address of the requesting device</li><li>date and time of access</li><li>requested address (path including parameters), HTTP method and protocol</li><li>HTTP status code, amount of data transferred, and response time</li><li>browser identifier (user agent)</li><li>TLS version and cipher used</li><li>target service</li></ul>
<p>The Cookie and Authorization headers are redacted. URL paths and query parameters are logged.</p>
<p>This data is used to operate the site, analyse errors, and defend against attacks and abuse. The legal basis is Art. 6(1)(f) GDPR. The legitimate interest is the stability and security of the service. Log files are deleted automatically after 14 days.</p>
<p>Pangolin also keeps HTTP request logs with connection and request data for 14 days, sign-in logs with identity data, IP and sign-in time for 90 days, and network logs with connection data for 30 days.</p>
<p>The application logs request ID, method, path without query parameters, status, duration and size, plus song/playlist IDs, titles, artist names, device names and errors. Share tokens in API paths are replaced. Normal request logging does not collect user profiles, full request bodies or client IP addresses. Proxy-configuration warnings can contain the peer IP; error messages can contain supplied content. The current file is trimmed to the last 10,000 lines every 15 seconds. Application log entries are automatically deleted no later than 14 days after they were written. Retention is checked in all log files at startup and hourly thereafter; empty inactive files are removed.</p>
<p>Kubernetes also keeps short-lived container logs. CrowdSec stores attacker IP, incident time and type, and blocking decisions locally. Local alerts are pruned after seven days or when they exceed 5,000 entries, except alerts with active blocking decisions. Local blocking profiles last four hours; imported blocks can have different lifetimes. Expired decision records can remain until their associated alert is pruned. These logs also support operation, debugging and security under Art. 6(1)(f) GDPR. Backups follow the limit stated in the hosting section.</p>`,
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
<p>The legal basis is Art. 6(1)(f) GDPR. The legitimate interest is restricting access to authorised people. The user account in Pocket-ID and Pangolin exists for as long as access is granted and is deleted on request or after access is withdrawn. Sign-in logs are deleted after 90 days. Backups are overwritten after no more than three months.</p>`,
		},
		{
			id: "accounts",
			title: "User account and content",
			html: `<p>For trusted Pangolin requests, Infinitune receives the user identifier, e-mail address and display name. A SQLite database on the controller's own infrastructure in Germany stores an internal ID, the identity ID, creation time and last-use time. These data associate playlists and provider credential management with a user.</p>
<p>Stored content includes playlists, music prompts and steering instructions, generation parameters, songs with metadata and lyrics, musical persona extracts, ratings, cover images and audio files. Settings include service addresses and models; OAuth credentials for text generation are stored locally with restricted file permissions. Audio is stored on the controller's own NAS in Germany. Playback rooms process device IDs, device names, roles and playback positions in memory. The purpose is the requested music generation, library and playback, including adaptation to musical preferences. The legal basis is Art. 6(1)(f) GDPR; the legitimate interest is providing the requested service for invited people.</p>
<p>Content is kept until you or the controller delete it. There is no general automatic content deletion. Songs and playlists can be deleted in the application. To delete your account, other content and remaining files, contact <a href="mailto:datenschutz-infinitune@heerlab.com">datenschutz-infinitune@heerlab.com</a>. Backups are overwritten after no more than three months.</p>`,
		},
		{
			id: "openai",
			title: "OpenAI for text generation",
			html: `<p>Infinitune uses OpenAI through the locally executed Pi library and a ChatGPT/Codex login for text generation and persona analysis. The recipient is OpenAI Ireland Limited, 1st Floor, The Liffey Trust Centre, 117-126 Sheriff Street Upper, Dublin 1, D01 YC43, Ireland. For this ChatGPT account, OpenAI acts as its own controller under its own terms and privacy policy.</p>
<p>Data sent include music prompts and steering instructions, language and musical constraints, generated metadata and lyrics, persona extracts derived from ratings, and information about liked or disliked songs. The application does not add a user name or e-mail address as a user profile. Supplied and generated content can still contain personal data. These text requests contain no audio files. The purpose is generating the requested music. The legal basis is Art. 6(1)(f) GDPR; the legitimate interest is providing this function.</p>
<p>OpenAI also processes and stores data in the USA and other countries outside the European Economic Area. According to its privacy policy, OpenAI relies on adequacy decisions or the European Commission's Standard Contractual Clauses under Art. 46(2)(c) GDPR for transfers. A copy of the safeguards can be requested from <a href="mailto:privacy@openai.com">privacy@openai.com</a>.</p>
<p>According to its privacy policy, OpenAI may use submitted content to improve its services, including model training, and offers an opt-out from this use. Retention and deletion at OpenAI follow its own rules in the linked privacy policy. Details: <a href="https://openai.com/policies/eu-privacy-policy/">OpenAI EU privacy policy</a>.</p>`,
		},
		{
			id: "local-generation",
			title: "ACE-Step and Ollama",
			html: `<p>ACE-Step generates audio on the controller's own hardware in Germany. It processes music and vocal descriptions, lyrics, tempo, key, meter, language, duration and model/sampler parameters. Ollama also runs on the controller's own hardware and is contacted for model lists and connection tests. These services do not transfer data to external providers.</p>
<p>The purpose is the requested music generation and its technical operation. The legal basis is Art. 6(1)(f) GDPR. Stored content and backups follow the deletion criteria stated above.</p>
<p>Further optional software integrations are not in use; this privacy policy will be updated before any is enabled.</p>`,
		},
		{
			id: "umami",
			title: "Self-hosted Umami",
			html: `<p>Infinitune uses Umami at umami.heerlab.com on the controller's own infrastructure in Germany. It collects sanitized page paths, screen size, language, load and performance measurements, plus events for playlist creation, steering and status, play, completion, skip and ratings, song requests, room role, settings changes, error classes and externally clicked hostname. The server sends generation starts, completions and failures with random song/playlist IDs, provider, model, stage, duration and status. Prompts become lengths; lyrics, device names and user profiles are not sent as analytics properties. Referrers, query parameters, fragments and share tokens are removed from pageviews. No identify call is made. The service and its proxy technically receive IP and user agent.</p>
<p>The tracker reads screen size, browser language, current page address, document title and referrer, plus performance and navigation data. Titles and addresses are sanitized before sending as described above. It sets no cookies and writes no identifiers to localStorage, sessionStorage or IndexedDB. An existing localStorage setting umami.disabled is read to honor a requested analytics opt-out; the application does not create it. Session state and the analytics cache stay in memory. Session replay and heatmaps are disabled in the application; the recorder is not loaded. The standalone legal pages load no tracker.</p>
<p>The purpose is usage and reliability analysis. The legal basis is Art. 6(1)(f) GDPR. The legitimate interest is understanding use of the service and detecting technical problems. Umami analytics data are currently stored with no fixed deletion period.</p>`,
		},
		{
			id: "glitchtip",
			title: "Self-hosted GlitchTip",
			html: `<p>Error diagnostics use the Sentry SDK with glitchtip.heerlab.com on the controller's German infrastructure. Data go to the self-hosted service, not Sentry SaaS. The browser, frontend server and Hono/worker server send errors and stack traces, sanitized URLs/breadcrumbs, release and environment, plus sampled performance traces. Deployment configuration specifies a 10% trace sample. Generation errors also include song/playlist ID, stage, provider and model. A separately configured CLI can report errors too.</p>
<p>sendDefaultPii is disabled. User objects, request bodies, arbitrary extras, auth/cookie/Remote headers and recognizable e-mail addresses and tokens are removed or sanitized. Free text in exception messages can still contain personal content. The browser uses no Sentry session replay; session tracking is disabled. Configured integrations create no additional browser storage entries. The receiving service/proxy technically receives IP and user agent.</p>
<p>The purpose is debugging and operational security. The legal basis is Art. 6(1)(f) GDPR; the legitimate interest is reliable and secure operation. Errors and transactions are deleted after 90 days, raw spans after 30 days. Backups follow the limit stated in the hosting section.</p>`,
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
			html: `<p>The legal pages themselves set no cookies and use no browser storage. The protected application uses the following entries. The application uses no IndexedDB database.</p>
<table><thead><tr><th scope="col">Entry / provider</th><th scope="col">Purpose</th><th scope="col">Duration</th><th scope="col">Assessment</th></tr></thead><tbody><tr><td>Cookie: p_session_token_s.&lt;timestamp&gt; / Pangolin</td><td>Invited-user access; on the resource domain, HttpOnly, Secure, SameSite=Lax</td><td>30 days</td><td>Technically necessary, Section 25(2) no. 2 TDDDG</td></tr><tr><td>localStorage: infinitune-player / Infinitune</td><td>Remember requested volume and mute setting</td><td>Until browser data are cleared</td><td>Necessary for the requested saved preference, Section 25(2) no. 2 TDDDG</td></tr><tr><td>sessionStorage: infinitune-device-id / Infinitune</td><td>Identify a device in a playback room</td><td>Tab session</td><td>Requested playback, Section 25(2) no. 2 TDDDG</td></tr><tr><td>sessionStorage: infinitune-radio-listener-id / Infinitune</td><td>Identify radio listener and reconnect</td><td>Tab session</td><td>Requested playback, Section 25(2) no. 2 TDDDG</td></tr><tr><td>sessionStorage: tsr-scroll-restoration-v1_3 / TanStack Router</td><td>Restore scroll position on navigation</td><td>Tab session</td><td>Requested navigation, Section 25(2) no. 2 TDDDG</td></tr><tr><td>localStorage: umami.disabled / Umami, read only if already present</td><td>Honor requested analytics opt-out</td><td>Until cleared; the app does not create it</td><td>Honor requested opt-out</td></tr><tr><td>Umami tracker and Sentry SDK</td><td>Analytics and diagnostics</td><td>In-memory state; server retention above</td><td>No additional cookies or storage identifiers; no session replay or heatmaps</td></tr></tbody></table>
<p>You can remove local preferences through your browser website-data settings.</p>`,
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
