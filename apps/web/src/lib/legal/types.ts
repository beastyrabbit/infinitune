export interface LegalSection {
	id: string;
	title: string;
	/** Trusted, authored HTML. Never populate this field from requests or user content. */
	html: string;
}

export interface LegalDocument {
	lang: "de" | "en";
	kind: "notice" | "privacy";
	title: string;
	updated: string;
	sections: LegalSection[];
}
