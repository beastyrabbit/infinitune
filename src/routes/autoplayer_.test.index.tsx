import { createFileRoute, Link } from "@tanstack/react-router";
import { Cpu, Image, Music, PlayCircle, Plug } from "lucide-react";

export const Route = createFileRoute("/autoplayer_/test/")({
	component: TestLabIndex,
});

const TEST_CARDS = [
	{
		title: "E2E PIPELINE",
		description: "Full pipeline: LLM → cover → audio → save",
		to: "/autoplayer/test/e2e",
		icon: PlayCircle,
	},
	{
		title: "LLM GENERATION",
		description: "Test song metadata generation with full prompt visibility",
		to: "/autoplayer/test/llm",
		icon: Cpu,
	},
	{
		title: "COVER ART",
		description: "Generate covers, side-by-side comparison",
		to: "/autoplayer/test/cover",
		icon: Image,
	},
	{
		title: "ACE-STEP AUDIO",
		description: "Submit + poll audio generation",
		to: "/autoplayer/test/ace",
		icon: Music,
	},
	{
		title: "CONNECTIONS",
		description: "Test all service endpoints",
		to: "/autoplayer/test/connections",
		icon: Plug,
	},
] as const;

function TestLabIndex() {
	return (
		<div className="max-w-5xl mx-auto px-4 py-8">
			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
				{TEST_CARDS.map((card) => (
					<Link
						key={card.to}
						to={card.to}
						className="group border-4 border-white/10 bg-black hover:border-white/30 transition-colors"
					>
						<div className="p-6 space-y-4">
							<card.icon className="h-8 w-8 text-white/40 group-hover:text-white/70 transition-colors" />
							<div>
								<h2 className="text-lg font-black uppercase tracking-tight">
									{card.title}
								</h2>
								<p className="text-xs font-bold uppercase text-white/30 mt-1">
									{card.description}
								</p>
							</div>
						</div>
					</Link>
				))}
			</div>
		</div>
	);
}
