import { useEffect, useState } from "react";
import { formatElapsed } from "@/lib/format-time";

interface LiveTimerProps {
	startedAt: number;
	className?: string;
}

export function LiveTimer({ startedAt, className }: LiveTimerProps) {
	const [elapsed, setElapsed] = useState(Date.now() - startedAt);

	useEffect(() => {
		const interval = setInterval(() => {
			setElapsed(Date.now() - startedAt);
		}, 1000);
		return () => clearInterval(interval);
	}, [startedAt]);

	if (className) {
		return <span className={className}>{formatElapsed(elapsed)}</span>;
	}
	return <>{formatElapsed(elapsed)}</>;
}
