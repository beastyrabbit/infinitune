import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, MessageSquareText, Send } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useRadioQueue, useSubmitRadioRequest } from "@/integrations/api/hooks";

export const Route = createFileRoute("/autoplayer_/orchestrator")({
	component: OrchestratorPage,
});

function OrchestratorPage() {
	const queue = useRadioQueue();
	const submitRequest = useSubmitRadioRequest();
	const [prompt, setPrompt] = useState("");
	const [submitting, setSubmitting] = useState(false);

	async function handleSubmit() {
		const trimmed = prompt.trim();
		if (!trimmed) return;
		setSubmitting(true);
		try {
			await submitRequest({ prompt: trimmed });
			setPrompt("");
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<div className="min-h-screen bg-[#101213] text-stone-100">
			<header className="border-b border-white/10 bg-black/70 px-4 py-4">
				<div className="mx-auto flex max-w-5xl items-center gap-4">
					<Link to="/autoplayer" className="text-white/55 hover:text-white">
						<ArrowLeft className="h-5 w-5" />
					</Link>
					<div>
						<h1 className="flex items-center gap-3 font-mono text-2xl font-black uppercase tracking-[0.18em]">
							<MessageSquareText className="h-6 w-6 text-emerald-300" />
							Radio Phone Line
						</h1>
						<p className="mt-1 font-mono text-xs uppercase tracking-[0.2em] text-white/35">
							Song, album, and generation requests
						</p>
					</div>
				</div>
			</header>

			<main className="mx-auto grid max-w-5xl gap-6 px-4 py-6 md:grid-cols-[1fr_320px]">
				<section className="border border-white/10 bg-[#171a1b] p-4">
					<Textarea
						value={prompt}
						onChange={(event) => setPrompt(event.target.value)}
						className="min-h-44 rounded-none border-white/15 bg-black/40 font-mono text-sm text-white placeholder:text-white/25"
						placeholder="Ask for a track, a full album direction, or a specific radio generation..."
					/>
					<div className="mt-3 flex justify-end">
						<Button
							onClick={handleSubmit}
							disabled={submitting || !prompt.trim()}
							className="rounded-none bg-emerald-300 font-mono font-black uppercase text-black hover:bg-emerald-200"
						>
							<Send className="mr-2 h-4 w-4" />
							Send
						</Button>
					</div>
				</section>

				<aside className="border border-white/10 bg-black/30">
					<div className="border-b border-white/10 px-4 py-3 font-mono text-xs font-black uppercase tracking-[0.22em] text-white/45">
						Requests
					</div>
					<div className="divide-y divide-white/10">
						{queue?.requests.map((request) => (
							<div key={request.id} className="p-4">
								<div className="mb-2 flex items-center justify-between gap-2">
									<span className="font-mono text-[10px] font-black uppercase tracking-widest text-emerald-300">
										{request.kind}
									</span>
									<span className="font-mono text-[10px] uppercase tracking-widest text-white/35">
										{request.status}
									</span>
								</div>
								<p className="text-sm leading-6 text-white/75">
									{request.prompt}
								</p>
							</div>
						))}
						{!queue?.requests.length && (
							<div className="p-6 text-center font-mono text-xs font-black uppercase tracking-widest text-white/25">
								No requests yet
							</div>
						)}
					</div>
				</aside>
			</main>
		</div>
	);
}
