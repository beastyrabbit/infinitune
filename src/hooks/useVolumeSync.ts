import { useStore } from "@tanstack/react-store";
import { useEffect, useRef } from "react";
import { useSetSetting, useSetting } from "@/integrations/api/hooks";
import { playerStore, setVolume } from "@/lib/player-store";

export function useVolumeSync() {
	const savedVolume = useSetting("volume");
	const setSetting = useSetSetting();
	const { volume } = useStore(playerStore);
	const initializedRef = useRef(false);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// On mount: apply saved volume from API
	useEffect(() => {
		if (savedVolume === undefined || initializedRef.current) return;
		initializedRef.current = true;
		if (savedVolume !== null) {
			const parsed = Number.parseFloat(savedVolume);
			if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 1) {
				setVolume(parsed);
			}
		}
	}, [savedVolume]);

	// On volume change: debounce write-back to API
	useEffect(() => {
		if (!initializedRef.current) return;
		if (debounceRef.current) clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(() => {
			setSetting({ key: "volume", value: String(volume) });
		}, 500);
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, [volume, setSetting]);
}
