export function preserveInheritedPlaylistValue<T>(
	value: T,
	inheritedValue: T,
	currentOverride: T | null | undefined,
): T | null {
	return currentOverride == null && Object.is(value, inheritedValue)
		? null
		: value;
}
