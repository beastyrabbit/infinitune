import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	CollapsibleJson,
	formatElapsed,
	LiveTimer,
	StatusBadge,
} from "@/components/autoplayer/test/shared";
import { useSettings } from "@/integrations/api/hooks";

export const Route = createFileRoute("/autoplayer_/testlab/ace")({
	component: AceTestPage,
});

type TaskStatus = "idle" | "submitting" | "running" | "succeeded" | "failed";

function AceTestPage() {
	const settings = useSettings();

	const [caption, setCaption] = useState(
		"upbeat electronic dance, synthesizer leads, driving bass, energetic drums",
	);
	const [lyrics, setLyrics] = useState(
		`[Verse 1]\nNeon lights across the sky\nWe're dancing through the night\nFeel the rhythm, feel the beat\nMoving to the light\n\n[Chorus]\nWe are alive tonight\nNothing's gonna stop us now\nWe are alive tonight\nLet the music show us how`,
	);
	const [bpm, setBpm] = useState(128);
	const [keyScale, setKeyScale] = useState("C minor");
	const [timeSignature, setTimeSignature] = useState("4/4");
	const [duration, setDuration] = useState(240);
	const [aceModel, setAceModel] = useState("");
	const [aceModels, setAceModels] = useState<string[]>([]);

	const [taskStatus, setTaskStatus] = useState<TaskStatus>("idle");
	const [taskId, setTaskId] = useState<string | null>(null);
	const [startedAt, setStartedAt] = useState<number | null>(null);
	const [pollCount, setPollCount] = useState(0);
	const [audioUrl, setAudioUrl] = useState<string | null>(null);
	const [rawResult, setRawResult] = useState<unknown>(null);
	const [error, setError] = useState<string | null>(null);

	const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

	// Sync model from settings
	useEffect(() => {
		if (settings?.aceModel) setAceModel(settings.aceModel);
	}, [settings]);

	// Fetch ACE models
	useEffect(() => {
		fetch("/api/autoplayer/ace-models")
			.then((r) => r.json())
			.then((data) => {
				const names = (data.models || []).map(
					(m: unknown) => (m as { name: string }).name,
				);
				setAceModels(names);
				if (names.length > 0 && !aceModel) setAceModel(names[0]);
			})
			.catch(() => {});
	}, [aceModel]);

	const stopPolling = useCallback(() => {
		if (pollRef.current) {
			clearInterval(pollRef.current);
			pollRef.current = null;
		}
	}, []);

	const handleSubmit = useCallback(async () => {
		setTaskStatus("submitting");
		setTaskId(null);
		setStartedAt(Date.now());
		setPollCount(0);
		setAudioUrl(null);
		setRawResult(null);
		setError(null);
		stopPolling();

		try {
			const input = {
				lyrics,
				caption,
				bpm,
				keyScale,
				timeSignature,
				audioDuration: duration,
				aceModel: aceModel || undefined,
			};

			const res = await fetch("/api/autoplayer/submit-ace", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(input),
			});

			const data = await res.json();
			if (!res.ok || data.error) {
				setTaskStatus("failed");
				setError(data.error || `HTTP ${res.status}`);
				return;
			}

			setTaskId(data.taskId);
			setTaskStatus("running");

			// Start polling
			pollRef.current = setInterval(async () => {
				setPollCount((c) => c + 1);
				try {
					const pollRes = await fetch("/api/autoplayer/poll-ace", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ taskId: data.taskId }),
					});

					if (!pollRes.ok) return;

					const pollData = await pollRes.json();

					if (pollData.status === "succeeded") {
						stopPolling();
						setTaskStatus("succeeded");
						setRawResult(pollData);

						// Build audio URL from ACE-Step server
						const aceStepUrl =
							settings?.aceStepUrl || "http://192.168.10.120:8001";
						setAudioUrl(`${aceStepUrl}${pollData.audioPath}`);
					} else if (pollData.status === "failed") {
						stopPolling();
						setTaskStatus("failed");
						setError(pollData.error || "Audio generation failed");
						setRawResult(pollData);
					}
				} catch {
					// Poll errors are transient, continue polling
				}
			}, 5000);
		} catch (e: unknown) {
			setTaskStatus("failed");
			setError(e instanceof Error ? e.message : String(e));
		}
	}, [
		lyrics,
		caption,
		bpm,
		keyScale,
		timeSignature,
		duration,
		aceModel,
		settings,
		stopPolling,
	]);

	// Cleanup on unmount
	useEffect(() => {
		return () => stopPolling();
	}, [stopPolling]);

	const statusMap: Record<
		TaskStatus,
		"pending" | "running" | "done" | "error"
	> = {
		idle: "pending",
		submitting: "running",
		running: "running",
		succeeded: "done",
		failed: "error",
	};

	return (
		<div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
			{/* INPUT FORM */}
			<section className="border-4 border-white/10 bg-black">
				<div className="border-b-2 border-white/10 px-4 py-2">
					<span className="text-xs font-black uppercase tracking-widest text-white/40">
						ACE-STEP AUDIO
					</span>
				</div>
				<div className="p-4 space-y-4">
					<div>
						{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps control */}
						<label className="text-xs font-bold uppercase text-white/40 mb-1 block">
							Caption
						</label>
						<input
							className="w-full h-8 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-xs text-white px-2 focus:outline-none focus:border-yellow-500"
							value={caption}
							onChange={(e) => setCaption(e.target.value)}
							disabled={taskStatus === "submitting" || taskStatus === "running"}
						/>
					</div>

					<div>
						{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps control */}
						<label className="text-xs font-bold uppercase text-white/40 mb-1 block">
							Lyrics
						</label>
						<textarea
							className="w-full h-40 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-sm text-white p-2 focus:outline-none focus:border-yellow-500"
							value={lyrics}
							onChange={(e) => setLyrics(e.target.value)}
							disabled={taskStatus === "submitting" || taskStatus === "running"}
						/>
					</div>

					<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
						<div>
							{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps control */}
							<label className="text-xs font-bold uppercase text-white/40 mb-1 block">
								BPM
							</label>
							<input
								type="number"
								className="w-full h-8 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-xs text-white px-2 focus:outline-none focus:border-yellow-500"
								value={bpm}
								onChange={(e) => setBpm(Number(e.target.value))}
								disabled={
									taskStatus === "submitting" || taskStatus === "running"
								}
							/>
						</div>
						<div>
							{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps control */}
							<label className="text-xs font-bold uppercase text-white/40 mb-1 block">
								Key
							</label>
							<input
								className="w-full h-8 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-xs text-white px-2 focus:outline-none focus:border-yellow-500"
								value={keyScale}
								onChange={(e) => setKeyScale(e.target.value)}
								disabled={
									taskStatus === "submitting" || taskStatus === "running"
								}
							/>
						</div>
						<div>
							{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps control */}
							<label className="text-xs font-bold uppercase text-white/40 mb-1 block">
								Time Sig
							</label>
							<input
								className="w-full h-8 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-xs text-white px-2 focus:outline-none focus:border-yellow-500"
								value={timeSignature}
								onChange={(e) => setTimeSignature(e.target.value)}
								disabled={
									taskStatus === "submitting" || taskStatus === "running"
								}
							/>
						</div>
						<div>
							{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps control */}
							<label className="text-xs font-bold uppercase text-white/40 mb-1 block">
								Duration (s)
							</label>
							<input
								type="number"
								className="w-full h-8 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-xs text-white px-2 focus:outline-none focus:border-yellow-500"
								value={duration}
								onChange={(e) => setDuration(Number(e.target.value))}
								disabled={
									taskStatus === "submitting" || taskStatus === "running"
								}
							/>
						</div>
					</div>

					<div>
						{/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps control */}
						<label className="text-xs font-bold uppercase text-white/40 mb-1 block">
							Model
						</label>
						<select
							className="w-full h-8 rounded-none border-4 border-white/20 bg-gray-900 font-mono text-xs text-white px-2 focus:outline-none focus:border-yellow-500"
							value={aceModel}
							onChange={(e) => setAceModel(e.target.value)}
							disabled={taskStatus === "submitting" || taskStatus === "running"}
						>
							{aceModels.length === 0 && <option value="">Loading...</option>}
							{aceModels.map((m) => (
								<option key={m} value={m}>
									{m}
								</option>
							))}
						</select>
					</div>

					<button
						type="button"
						className={`w-full h-10 border-4 font-mono text-xs font-black uppercase transition-colors ${
							taskStatus === "submitting" || taskStatus === "running"
								? "border-white/10 bg-white/5 text-white/20 cursor-not-allowed"
								: "border-white/20 bg-green-600 text-white hover:bg-green-500"
						}`}
						onClick={handleSubmit}
						disabled={taskStatus === "submitting" || taskStatus === "running"}
					>
						{taskStatus === "submitting" ? (
							<span className="flex items-center justify-center gap-2">
								<Loader2 className="h-3 w-3 animate-spin" />
								SUBMITTING...
							</span>
						) : taskStatus === "running" ? (
							"WAITING FOR AUDIO..."
						) : (
							"[SUBMIT]"
						)}
					</button>
				</div>
			</section>

			{/* STATUS PANEL */}
			{taskStatus !== "idle" && (
				<section
					className={`border-4 bg-black ${
						taskStatus === "failed"
							? "border-red-500/40"
							: taskStatus === "succeeded"
								? "border-green-600/30"
								: "border-yellow-500/40"
					}`}
				>
					<div className="px-4 py-2 flex items-center justify-between border-b-2 border-white/10">
						<span className="text-xs font-black uppercase tracking-widest">
							STATUS
						</span>
						<StatusBadge status={statusMap[taskStatus]} />
					</div>
					<div className="p-4 space-y-2">
						{taskId && (
							<div className="text-[10px] font-bold uppercase text-white/30">
								TASK ID:{" "}
								<span className="text-white/60 font-mono">{taskId}</span>
							</div>
						)}

						{startedAt && (
							<div className="text-[10px] font-bold uppercase text-white/30">
								ELAPSED:{" "}
								<span className="text-white/60">
									{taskStatus === "running" || taskStatus === "submitting" ? (
										<LiveTimer startedAt={startedAt} />
									) : (
										formatElapsed(Date.now() - startedAt)
									)}
								</span>
							</div>
						)}

						{taskStatus === "running" && (
							<div className="text-[10px] font-bold uppercase text-white/30">
								POLL COUNT: <span className="text-white/60">{pollCount}</span>
							</div>
						)}

						{error && (
							<p className="text-[10px] font-bold uppercase text-red-400 border-2 border-red-500/30 bg-red-950/30 px-2 py-1">
								{error}
							</p>
						)}

						{audioUrl && (
							<div className="mt-4">
								<span className="text-[10px] font-black uppercase text-white/40 block mb-2">
									AUDIO
								</span>
								<audio controls className="w-full" src={audioUrl}>
									<track kind="captions" />
								</audio>
							</div>
						)}

						<CollapsibleJson label="RAW RESPONSE" data={rawResult} />
					</div>
				</section>
			)}
		</div>
	);
}
