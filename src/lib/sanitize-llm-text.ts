/** Strip common LLM output artifacts from free-text responses */
export function sanitizeLlmText(text: string, maxLength = 2000): string {
	let s = text.trim();
	// Remove markdown code fences
	const fenced = s.match(/^```(?:\w+)?\s*([\s\S]*?)```$/);
	if (fenced) s = fenced[1].trim();
	// Remove surrounding quotes
	if (
		(s.startsWith('"') && s.endsWith('"')) ||
		(s.startsWith("'") && s.endsWith("'"))
	)
		s = s.slice(1, -1).trim();
	// Remove common LLM preamble patterns
	s = s
		.replace(
			/^(?:Here(?:'s| is) (?:the |an? )?(?:enhanced|updated|refined|improved) (?:prompt|request|version)[:\s]*)/i,
			"",
		)
		.trim();
	// Enforce max length
	if (s.length > maxLength) s = s.slice(0, maxLength);
	return s;
}
