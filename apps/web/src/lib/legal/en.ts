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
			html: `<p>E-mail: <a href="mailto:impressum@heerlab.com">impressum@heerlab.com</a><br>Contact form: <a href="https://beastyrabbit.com/kontakt">beastyrabbit.com/kontakt</a></p>`,
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
<p>E-mail: <a href="mailto:datenschutz@heerlab.com">datenschutz@heerlab.com</a></p>
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
<p>The legal basis is Art. 6(1)(f) GDPR. The legitimate interest is the secure and reliable provision of the website.</p>`,
		},
		{
			id: "logs",
			title: "Server log files",
			html: `<p>For every request, the reverse proxy automatically stores the following data:</p>
<ul><li>IP address of the requesting device</li><li>date and time of access</li><li>requested address (path including parameters), HTTP method and protocol</li><li>HTTP status code, amount of data transferred, and response time</li><li>browser identifier (user agent)</li><li>TLS version and cipher used</li><li>target service</li></ul>
<p>The Cookie and Authorization headers are redacted. URL paths and query parameters are logged.</p>
<p>This data is used to operate the site, analyse errors, and defend against attacks and abuse. The legal basis is Art. 6(1)(f) GDPR. The legitimate interest is the stability and security of the service. The intended deletion limit for Traefik logs is 14 days. TODO(user): automatic deletion has not yet been confirmed; confirm the actual limit and backups before publication.</p>
<p>Pangolin also keeps HTTP request logs with connection and request data, authentication logs with identity data, IP and sign-in time, and network logs. The intended limits are 14 days for HTTP requests, 90 days for authentication and 30 days for network logs. TODO(user): confirm that these limits are implemented, including backups.</p>
<p>The application uses Pino to log request ID, method, path without query parameters, status, duration and size, along with song/playlist IDs, titles, artist names, device names, source addresses and errors. Share tokens in API paths are replaced. Normal request logging does not collect user profiles, full request bodies or client IP addresses. Proxy-configuration warnings can include the connecting peer's IP. An agent-memory error path can log chat content; exception messages can contain other supplied content.</p>
<p>File logging is enabled by default unless LOG_TO_FILE is 0. The current file is trimmed every 15 seconds to the last 10,000 lines; files from previous process starts have no automatic time-based deletion. Kubernetes also retains short-lived container logs. CrowdSec stores local alerts and blocking decisions. This processing also serves operation, diagnostics and security under Art. 6(1)(f) GDPR. TODO(user): establish and confirm deletion limits for application files, container logs, local CrowdSec data and backups.</p>`,
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
<p>The legal basis is Art. 6(1)(f) GDPR. The legitimate interest is restricting access to invited family members. The intended authentication-log retention is 90 days; actual deletion still needs confirmation. Deletion of user profiles in Pocket-ID and Pangolin, including backups, is subject to TODO(user): confirm the actual deletion criteria. The legal information pages are intended to be accessible without sign-in.</p>`,
		},
		{
			id: "accounts",
			title: "User account and content",
			html: `<p>For trusted Pangolin requests, Infinitune receives a user identifier, e-mail address and display name. A SQLite database on the controller's infrastructure stores an internal ID, identity subject, creation time and last-seen time. These records link playlists, registered devices and management of provider credentials to a user.</p>
<p>The application also stores playlists and prompts including changes, generated songs with lyrics, descriptions and persona extracts, ratings, albums, radio requests, play history and schedule, source addresses, share tokens, settings, agent chat, memories and agent-run inputs/outputs. Audio and covers are also stored as files. Registered devices include names, owner, token hash, capabilities, version and last contact; room and playback data are also processed in memory. Valid share links allow access to shared content subject to access restrictions.</p>
<p>You can upload cover images as image data for local storage. An auth.json file containing credentials can be uploaded to set up OpenAI access. Settings include service addresses and models. OpenRouter API keys are migrated from legacy database entries to a local Pi credential file with restricted file permissions; OAuth credentials may also be stored locally. The application needs these data for the requested music generation and playback. Art. 6(1)(f) GDPR is the intended basis, with the interest in providing the requested family service.</p>
<p>Songs and playlists can be deleted through the application, shares revoked and manageable credentials removed. This does not establish complete deletion of all files, agent sessions or backups. Persistent content and user accounts have no general automatic deletion limit. Anonymous temporary playlists are designed to expire after 24 hours and are cleaned up periodically; starred temporary playlists are excluded. TODO(user): establish deletion criteria for accounts, content, media copies, agent history, devices, credentials, shares and backups. Erasure requests can be sent to datenschutz@heerlab.com.</p>`,
		},
		{
			id: "openai",
			title: "OpenAI and Pi agents",
			html: `<p>Depending on configuration, text generation uses OpenAI through the Pi openai-codex provider or OpenRouter. OpenAI is the default provider; prompt optimization also targets this provider. Pi is a locally executed library, not an additional hosting provider. Actual production configuration was not read from the database.</p>
<p>The selected text provider receives music prompts, steering instructions and chat messages, language and musical constraints, previous titles, artists and descriptions, positive/negative ratings and musical persona extracts. Persona analysis sends metadata and lyric excerpts. Agents can also retrieve memories, chat history and tool results containing full song lyrics, source metadata and playback/rating information and pass them to the model. Persistent Pi sessions continue locally. Names or e-mail addresses are not deliberately added as user profiles to these requests; supplied or retrieved content can still contain personal data.</p>
<p>A separately enabled OpenAI Codex image provider instead receives the derived cover prompt with image instructions, possibly band and album text. It requires dedicated credentials and explicit server configuration; temporary image-job directories are removed after the job. The text requests described here do not send audio files to the text provider.</p>
<p>The purpose is the requested music and cover creation; Art. 6(1)(f) GDPR is the intended basis. TODO(user): confirm enabled providers and account contract type, exact OpenAI recipient entity and address, processing countries, applicable transfer safeguards, training/logging settings and retention. The official legal pages could not be retrieved during the review. Sources to resolve this: <a href="https://openai.com/policies/eu-privacy-policy/">EU privacy policy</a>, <a href="https://openai.com/policies/data-processing-addendum/">data processing addendum</a>.</p>`,
		},
		{
			id: "openrouter",
			title: "OpenRouter, if configured",
			html: `<p>When OpenRouter is selected, the same text and context data described above go to OpenRouter, Inc., 169 Madison Avenue, New York, NY 10016, USA and the selected downstream model provider. There is no separate direct Anthropic text integration in the current code; Anthropic may nevertheless be a model provider behind OpenRouter.</p>
<p>The purpose and intended Art. 6(1)(f) GDPR basis are the same as for text generation. The official policy cites adequacy decisions and EU Standard Contractual Clauses for transfers outside the EEA. Retention and possible use of inputs also depend on account and model-provider settings. TODO(user): confirm actual models, downstream recipients with addresses and countries, contractual safeguards, training/logging settings and specific deletion limits. Details: <a href="https://openrouter.ai/privacy">privacy</a>, <a href="https://openrouter.ai/terms">terms</a>.</p>`,
		},
		{
			id: "inference",
			title: "Inference.sh, if configured",
			html: `<p>The cover service Inference.sh receives the cover prompt derived from the music context, possibly band/album text, image model and output parameters, service credentials and server IP. The application downloads the finished image on the server. Full listening histories, ratings or audio files are not deliberately attached to this image call; the cover prompt can contain user-related details.</p>
<p>The official policy identifies the provider as Inference Shell Inc., Delaware, USA. The selected app/model provider also processes inputs; Pruna image models are selectable in the code. The policy describes US processing and Standard Contractual Clauses with subprocessors. It specifies account lifetime with a deletion option for inputs/outputs, 90 days for API usage/authentication logs and one year for security audit logs. The purpose is cover creation, with Art. 6(1)(f) GDPR as the intended basis. TODO(user): confirm production use, full postal address, actual model subprocessors and countries, applicable contractual transfer safeguards and specific account deletion. Details: <a href="https://inference.sh/privacy">privacy</a>, <a href="https://inference.sh/terms">terms</a>, <a href="https://inference.sh/providers">providers</a>.</p>`,
		},
		{
			id: "local-generation",
			title: "ACE-Step and Ollama",
			html: `<p>For audio generation, ACE-Step receives the music/vocal style, full generated or matched lyrics, tempo, key, meter, language, duration and model/sampler settings. Cover/repaint jobs also upload reference audio. The default address is a private LAN service. The current code contacts Ollama for model lists and connection tests; legacy Ollama/Anthropic text-provider values are converted to OpenAI Codex, not generated locally.</p>
<p>Actual service addresses can differ through database settings. Art. 6(1)(f) GDPR is the intended basis for the requested function. TODO(user): confirm actual ACE-Step/Ollama endpoints, operation entirely on the controller's own German infrastructure and deletion limits for tasks, reference audio and outputs; add recipients and transfer safeguards for any external endpoints.</p>`,
		},
		{
			id: "source-downloads",
			title: "Reference audio and local cache",
			html: `<p>For source songs explicitly selected by users or selected by the music director, the server downloads audio files, titles and duration using yt-dlp. YouTube, SoundCloud and Bandcamp extractors are allowed; generic arbitrary download addresses are excluded. The destination providers and their media servers see the requested URL or YouTube search query, server IP and technical request data. The browser does not embed their players for this purpose. By default the local download cache is pruned after seven days since last use or as space is needed at about 1 GiB; active jobs can protect files longer.</p>`,
		},
		{
			id: "youtube",
			title: "YouTube, if selected as a source",
			html: `<p>For YouTube source songs, the provider receives the selected URL or a YouTube search query, server IP and technical request data; the server downloads audio, title and duration. The browser does not embed a YouTube player for this purpose. The purpose is the requested reference audio, with Art. 6(1)(f) GDPR as the intended basis.</p>
<p>For EEA users, the provider is Google Ireland Limited, Gordon House, Barrow Street, Dublin 4, Ireland. Google cites the EU-US Data Privacy Framework and Standard Contractual Clauses for international transfers. TODO(user): confirm actual use, necessity and provider-side retention. Details: <a href="https://policies.google.com/privacy?hl=en">Google privacy</a>, <a href="https://policies.google.com/privacy/frameworks?hl=en">transfer safeguards</a>.</p>`,
		},
		{
			id: "soundcloud",
			title: "SoundCloud, if selected as a source",
			html: `<p>For SoundCloud, the provider receives the selected source address, server IP and technical request data for server-side downloading of audio, title and duration. No SoundCloud player is embedded. The purpose is the requested reference audio, with Art. 6(1)(f) GDPR as the intended basis.</p>
<p>SoundCloud identifies SoundCloud Global Limited &amp; Co. KG, Karl-Marx-Strasse 101, 12043 Berlin, Germany, and cites Standard Contractual Clauses for international transfers. TODO(user): confirm actual use, necessity and provider-side retention. Details: <a href="https://soundcloud.com/pages/privacy">SoundCloud privacy</a>.</p>`,
		},
		{
			id: "bandcamp",
			title: "Bandcamp, if selected as a source",
			html: `<p>For Bandcamp, the provider receives the selected source address, server IP and technical request data for server-side downloading of audio, title and duration. No Bandcamp player is embedded. The purpose is the requested reference audio, with Art. 6(1)(f) GDPR as the intended basis.</p>
<p>Bandcamp identifies Bandcamp Ventures LLC and processing in the US and other countries. An exact address and specific transfer mechanism have not been verified. TODO(user): clarify actual use, necessity, address, transfer safeguards and provider-side retention. Details: <a href="https://bandcamp.com/privacy">Bandcamp privacy</a>, <a href="https://bandcamp.com/terms_of_use">terms</a>.</p>`,
		},
		{
			id: "lrclib",
			title: "LRCLIB",
			html: `<p>To find matching lyrics, the server sends the source track title and artist name, server IP and a technical Infinitune identifier to lrclib.net or the configured LRCLIB endpoint. Duration is used locally to select a matching result. No audio files or lyrics are uploaded to LRCLIB in this call. Retrieved lyrics may then be stored in the database and passed to ACE-Step or, through agent tools, to the selected text provider.</p>
<p>The purpose is lyric matching for the requested cover function, with Art. 6(1)(f) GDPR as the intended basis. TODO(user): establish actual use, responsible entity, address, processing countries, transfer safeguards and retention. The <a href="https://lrclib.net">official website</a> and <a href="https://lrclib.net/docs">documentation</a> did not provide reliable legal details during this review.</p>`,
		},
		{
			id: "research",
			title: "Public web fetches",
			html: `<p>Music agents can retrieve public web pages. Their servers receive the destination address, server IP and technical request data. Research content can become context for the selected text model. Recipients depend on the domains actually fetched.</p>
<p>The purpose is music/source research, with Art. 6(1)(f) GDPR as the intended basis. TODO(user): review actual use and domains, necessity, full recipients and addresses, retention and applicable third-country safeguards.</p>`,
		},
		{
			id: "duckduckgo",
			title: "DuckDuckGo for music research",
			html: `<p>Music agents can send queries derived from playlist context to DuckDuckGo. The service receives search terms, server IP and technical request data. Queries can contain details from your prompts; research results can become context for the selected text model.</p>
<p>DuckDuckGo identifies Duck Duck Go, Inc., 20 Paoli Pike, Paoli, Pennsylvania 19301, USA, and states that it does not store IP-linked search histories. Its official policy describes worldwide operation but does not establish a specific transfer mechanism for these requests. The purpose is music/source research, with Art. 6(1)(f) GDPR as the intended basis. TODO(user): review actual use, necessity, retention and applicable third-country safeguards. Details: <a href="https://duckduckgo.com/privacy">privacy</a>, <a href="https://duckduckgo.com/terms">terms</a>, <a href="https://duckduckgo.com/duckduckgo-help-pages/company/contact-us">official contact address</a>.</p>`,
		},
		{
			id: "wikimedia",
			title: "Wikipedia for music research",
			html: `<p>Music agents can send queries derived from playlist context to Wikipedia search. The service receives search terms, server IP and technical request data. Queries can contain details from your prompts; research results can become context for the selected text model.</p>
<p>Wikipedia is operated by Wikimedia Foundation, Inc., 1 Sansome Street, Suite 1895, San Francisco, California 94104, USA. The purpose is music/source research, with Art. 6(1)(f) GDPR as the intended basis. TODO(user): review actual use, necessity, retention and applicable third-country safeguards. Details: <a href="https://foundation.wikimedia.org/wiki/Policy:Privacy_policy">Wikimedia privacy</a>, <a href="https://wikimediafoundation.org/about/contact/">official contact address</a>.</p>`,
		},
		{
			id: "alternate-auth",
			title: "Alternative Shoo sign-in, if used",
			html: `<p>In addition to Pangolin sign-in, the server optionally accepts Shoo bearer tokens. It retrieves public signature keys from the configured issuer, shoo.dev by default. A pairwise user identifier and any e-mail address, name and profile picture are stored locally. The token may be kept in browser local storage. Production use of this alternative has not been verified.</p>
<p>Shoo describes itself as a Google sign-in broker and lists identity/consent data kept until deletion and short-lived security data. The intended purpose is requested sign-in under Art. 6(1)(f) GDPR. TODO(user): confirm use, necessity, exact entity and address, countries, safeguards and deletion limits. Details: <a href="https://shoo.dev/privacy">Shoo privacy</a>.</p>`,
		},
		{
			id: "umami",
			title: "Self-hosted Umami",
			html: `<p>The application is configured for Umami at umami.heerlab.com on the controller's German infrastructure. It collects sanitized page paths, screen/language data and load/performance measurements, plus events for playlist creation, steering and status, play, completion, skip and ratings, song requests, room role, settings changes, error classes and externally clicked hostname. The server sends generation starts, completions and failures with random song/playlist IDs, provider, model, stage, duration and status. Prompts become lengths; lyrics, device names and user profiles are not deliberately sent as analytics properties. Referrers, query parameters, fragments and share tokens are removed from pageviews. No identify call is made. The service and its proxy nevertheless technically receive IP and user agent.</p>
<p>The code also supports session recordings and heatmaps when Umami's policy enables recording and requires strict text/input masking and blocks private regions. A further sanitization layer filters content and URLs. The previous telemetry verification reported an SSO-blocked public policy endpoint, which prevented recording there. The current production policy and reachability have not been independently confirmed. Masking does not remove every residual risk. The inspected tracker sets no cookies and writes no storage identifiers; it reads umami.disabled if already present.</p>
<p>The purpose is usage and reliability analysis. Art. 6(1)(f) GDPR is the intended basis. No consent prompt is implemented. TODO(user): clarify necessity and legal basis including possible consent under Section 25(1) TDDDG and Art. 6(1)(a) GDPR, actual recording/heatmap settings and deletion limits including backups. A maximum recording duration is not a retention limit. The standalone legal pages load no tracker.</p>`,
		},
		{
			id: "glitchtip",
			title: "Self-hosted GlitchTip",
			html: `<p>Error diagnostics use the Sentry SDK with glitchtip.heerlab.com on the controller's German infrastructure. Data go to the self-hosted service, not Sentry SaaS. The browser, frontend server and Hono/worker server send errors and stack traces, sanitized URLs/breadcrumbs, release and environment, plus sampled performance traces. Deployment configuration specifies a 10% trace sample. Generation errors also include song/playlist ID, stage, provider and model. A separately configured CLI can report errors too.</p>
<p>sendDefaultPii is disabled. User objects, request bodies, arbitrary extras, auth/cookie/Remote headers and recognizable e-mail addresses and tokens are removed or sanitized. Free text in exception messages can still contain personal content. The browser uses no Sentry session replay; session tracking is disabled. Configured integrations create no additional browser storage entries. The receiving service/proxy technically receives IP and user agent.</p>
<p>The purpose is debugging and operational security, with Art. 6(1)(f) GDPR as the intended basis. TODO(user): confirm deletion limits for errors, traces and backups.</p>`,
		},
		{
			id: "resend",
			title: "Resend for error notifications",
			html: `<p>GlitchTip is configured to send SMTP mail through Resend. If error notifications are enabled, recipient address, notification content and e-mail metadata may go to Plus Five Five, Inc., 2261 Market Street #5039, San Francisco, CA 94114, USA. Resend's official data processing agreement cites EU-US Data Privacy Framework certification and Standard Contractual Clauses. Details: <a href="https://resend.com/legal/privacy-policy">Resend privacy</a>, <a href="https://resend.com/legal/dpa">agreement</a>.</p>
<p>The purpose is error notification, with Art. 6(1)(f) GDPR as the intended basis. TODO(user): confirm actual notifications, their data scope, necessity, the Resend agreement and retention.</p>`,
		},
		{
			id: "email",
			title: "Contact by e-mail",
			html: `<p>If you contact us by e-mail, your e-mail address, the content of your message and the technical details of the e-mail are processed to answer your request. The legal basis is Art. 6(1)(f) GDPR. The legitimate interest is being able to answer requests.</p>
<p>The mailboxes are hosted by Fastmail Pty Ltd, PO Box 234, Collins Street West, VIC 8007, Australia, as a processor. Data may be transferred to countries outside the EU, in particular Australia, the USA and India. For these transfers, Fastmail uses the European Commission's Standard Contractual Clauses (Art. 46(2)(c) GDPR). Details: <a href="https://www.fastmail.com/policies/privacy/">Fastmail privacy policy</a>, <a href="https://www.fastmail.com/policies/dpa/">data processing agreement</a> and <a href="https://www.fastmail.com/policies/dpa/section3/">Standard Contractual Clauses</a>. You can obtain a copy of the safeguards by writing to <a href="mailto:datenschutz@heerlab.com">datenschutz@heerlab.com</a>.</p>
<p>The controller deletes messages after dealing with the request unless retention remains necessary. Fastmail may subsequently retain backup and log data under its published deletion rules.</p>`,
		},
		{
			id: "storage",
			title: "Cookies and local storage",
			html: `<p>The legal pages themselves set no cookies and use no browser storage. The protected application has the following entries according to source and previous local telemetry tests; an Unauthorized response prevented inspection of the signed-in live application. No IndexedDB use was found in application code.</p>
<table><thead><tr><th scope="col">Entry / provider</th><th scope="col">Purpose</th><th scope="col">Duration</th><th scope="col">Assessment</th></tr></thead><tbody><tr><td>Pangolin session cookie</td><td>Invited-user access</td><td>TODO(user): confirm name, scope and lifetime</td><td>Technically necessary, Section 25(2) no. 2 TDDDG</td></tr><tr><td>localStorage: infinitune-player / Infinitune</td><td>Remember requested volume and mute setting</td><td>Until browser data are cleared</td><td>Necessary for the requested saved preference, Section 25(2) no. 2 TDDDG</td></tr><tr><td>localStorage: infinitune-shoo-id-token / Infinitune, only if used</td><td>Alternative sign-in token</td><td>Until removed/cleared; token expiry does not remove the key</td><td>Necessary for that sign-in, Section 25(2) no. 2 TDDDG</td></tr><tr><td>sessionStorage: infinitune-device-id / Infinitune</td><td>Identify a device in a playback room</td><td>Tab session</td><td>Requested playback, Section 25(2) no. 2 TDDDG</td></tr><tr><td>sessionStorage: infinitune-radio-listener-id / Infinitune</td><td>Identify radio listener and reconnect</td><td>Tab session</td><td>Requested playback, Section 25(2) no. 2 TDDDG</td></tr><tr><td>sessionStorage: tsr-scroll-restoration-v1_3 / TanStack Router</td><td>Restore scroll position on navigation</td><td>Tab session</td><td>Requested navigation, Section 25(2) no. 2 TDDDG</td></tr><tr><td>localStorage: umami.disabled / Umami, read only if already present</td><td>Honor requested analytics opt-out</td><td>Until cleared; the app does not create it</td><td>Honor requested opt-out</td></tr><tr><td>Umami tracker and Sentry SDK</td><td>Analytics and diagnostics</td><td>In-memory state; server retention above</td><td>No additional storage identifiers in inspected tracker/SDK; recorder and consent requirement still to confirm</td></tr></tbody></table>
<p>TODO(user): verify HTTP-only cookies and the full storage list in a signed-in live session, especially with recording enabled. You can remove local preferences through your browser website-data settings.</p>`,
		},
		{
			id: "rights",
			title: "Your rights",
			html: `<p>You have the following rights regarding your personal data:</p>
<ul><li>access (Art. 15 GDPR)</li><li>rectification (Art. 16 GDPR)</li><li>erasure (Art. 17 GDPR)</li><li>restriction of processing (Art. 18 GDPR)</li><li>data portability (Art. 20 GDPR)</li><li>withdrawal of consent (Art. 7(3) GDPR): you may withdraw consent at any time. Withdrawal does not affect the lawfulness of processing before withdrawal.</li></ul>
<p><strong>Right to object (Art. 21 GDPR):</strong> Where processing is based on Art. 6(1)(f) GDPR, you may object at any time on grounds relating to your particular situation.</p>
<p>To exercise your rights, simply send a message to <a href="mailto:datenschutz@heerlab.com">datenschutz@heerlab.com</a>.</p>
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
