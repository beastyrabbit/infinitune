import {
	AlertTriangle,
	Bot,
	Brain,
	Check,
	CheckCircle2,
	MessageSquare,
	Pencil,
	Save,
	Send,
	Trash2,
	UserRound,
	Wrench,
	X,
} from "lucide-react";
import { forwardRef, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
	type AgentChannelMessage,
	type AgentMemoryEntry,
	type AgentMemoryKind,
	useAgentChatMessages,
	useAgentChatState,
	useAgentMemoryEntries,
	useAnswerAgentQuestion,
	useDeleteAgentMemoryEntry,
	usePostAgentChatMessage,
	useUpdateAgentMemoryEntry,
} from "@/integrations/api/hooks";
import { formatTimeAgo } from "@/lib/format-time";
import { cn } from "@/lib/utils";

const CHANNEL_FILTERS = [
	{ id: "chat", label: "CHAT" },
	{ id: "all", label: "ALL" },
	{ id: "decisions", label: "DECISIONS" },
	{ id: "agents", label: "AGENTS" },
	{ id: "tools", label: "TOOLS" },
	{ id: "memory", label: "MEMORY" },
] as const;

type ChannelFilter = (typeof CHANNEL_FILTERS)[number]["id"];

const MEMORY_KINDS: AgentMemoryKind[] = [
	"taste",
	"avoid",
	"topic",
	"constraint",
	"production",
	"lyrics",
	"summary",
	"feedback",
];

interface OrchestratorPanelProps {
	playlistId: string;
	disabled?: boolean;
}

interface MemoryDraft {
	title: string;
	kind: AgentMemoryKind;
	contentText: string;
	confidence: string;
	importance: string;
}

function senderLabel(message: AgentChannelMessage): string {
	if (message.senderKind === "human") return "YOU";
	if (message.messageType === "decision") return "DIRECTOR DECISION";
	if (message.senderId === "playlist-director") return "DIRECTOR";
	if (message.senderKind === "tool") return "TOOL";
	if (message.senderKind === "system") return "SYSTEM";
	return message.senderId.replaceAll("-", " ").toUpperCase();
}

function messageTypeLabel(message: AgentChannelMessage): string {
	if (message.messageType === "decision") return "internal";
	if (message.messageType === "proposal") return "agent note";
	if (message.messageType === "critique") return "critique";
	if (message.messageType === "tool_summary") return "tool summary";
	if (message.messageType === "memory_note") return "memory";
	return message.messageType;
}

function messageClass(message: AgentChannelMessage): string {
	if (message.senderKind === "human") {
		return "border-white/30 bg-white/[0.14]";
	}
	if (message.messageType === "decision") {
		return "border-yellow-400/40 bg-yellow-500/15";
	}
	if (message.senderId === "playlist-director") {
		return "border-red-400/50 bg-red-950/50";
	}
	if (message.messageType === "critique") {
		return "border-yellow-400/50 bg-yellow-950/40";
	}
	if (message.senderKind === "tool" || message.senderKind === "system") {
		return "border-cyan-400/40 bg-cyan-950/40";
	}
	return "border-white/15 bg-gray-900/95";
}

function iconClass(message: AgentChannelMessage): string {
	if (message.senderKind === "human") {
		return "border-white/30 bg-white/15 text-white";
	}
	if (message.messageType === "decision") {
		return "border-yellow-400/50 bg-yellow-500/20 text-yellow-200";
	}
	if (message.messageType === "critique") {
		return "border-yellow-400/50 bg-yellow-950 text-yellow-200";
	}
	if (message.messageType === "memory_note") {
		return "border-pink-400/40 bg-pink-950/50 text-pink-200";
	}
	if (message.senderId === "playlist-director") {
		return "border-red-400/50 bg-red-950 text-red-100";
	}
	if (message.senderKind === "tool" || message.senderKind === "system") {
		return "border-cyan-400/40 bg-cyan-950 text-cyan-200";
	}
	return "border-white/15 bg-black text-white/70";
}

function MessageTypeIcon({ message }: { message: AgentChannelMessage }) {
	if (message.senderKind === "human") return <UserRound className="h-4 w-4" />;
	if (message.messageType === "decision") {
		return <CheckCircle2 className="h-4 w-4" />;
	}
	if (message.messageType === "critique") {
		return <AlertTriangle className="h-4 w-4" />;
	}
	if (message.messageType === "memory_note")
		return <Brain className="h-4 w-4" />;
	if (message.senderKind === "tool" || message.senderKind === "system") {
		return <Wrench className="h-4 w-4" />;
	}
	if (message.senderId === "playlist-director") {
		return <MessageSquare className="h-4 w-4" />;
	}
	return <Bot className="h-4 w-4" />;
}

function matchesFilter(
	message: AgentChannelMessage,
	filter: ChannelFilter,
): boolean {
	if (filter === "chat") {
		return (
			(message.messageType === "chat" || message.messageType === "question") &&
			(message.senderKind === "human" ||
				message.senderId === "playlist-director")
		);
	}
	if (filter === "all") return true;
	if (filter === "decisions") return message.messageType === "decision";
	if (filter === "memory") return message.messageType === "memory_note";
	if (filter === "agents") {
		return (
			message.senderKind === "agent" &&
			message.senderId !== "playlist-director" &&
			message.messageType !== "decision"
		);
	}
	return (
		message.senderKind === "tool" ||
		message.senderKind === "system" ||
		message.messageType === "tool_summary"
	);
}

function toDisplayJson(value: unknown): string {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value ?? {}, null, 2);
	} catch {
		return String(value);
	}
}

function toEditableJson(value: unknown): string {
	try {
		return JSON.stringify(value ?? {}, null, 2);
	} catch {
		return "{}";
	}
}

function clamp01(value: number, fallback: number): number {
	if (!Number.isFinite(value)) return fallback;
	return Math.max(0, Math.min(1, value));
}

function draftFromEntry(entry: AgentMemoryEntry): MemoryDraft {
	return {
		title: entry.title,
		kind: entry.kind,
		contentText: toEditableJson(entry.content),
		confidence: entry.confidence.toFixed(2),
		importance: entry.importance.toFixed(2),
	};
}

function MemoryEntryEditor({
	entry,
	playlistId,
}: {
	entry: AgentMemoryEntry;
	playlistId: string;
}) {
	const updateMemory = useUpdateAgentMemoryEntry();
	const deleteMemory = useDeleteAgentMemoryEntry();
	const [editing, setEditing] = useState(false);
	const [saving, setSaving] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [draft, setDraft] = useState<MemoryDraft>(() => draftFromEntry(entry));

	useEffect(() => {
		if (!editing) setDraft(draftFromEntry(entry));
	}, [entry, editing]);

	const resetDraft = () => {
		setDraft(draftFromEntry(entry));
	};

	const handleSave = async () => {
		let content: unknown;
		try {
			content = JSON.parse(draft.contentText);
		} catch {
			toast.error("Memory JSON is invalid");
			return;
		}
		const title = draft.title.trim();
		if (!title) {
			toast.error("Memory title is required");
			return;
		}

		setSaving(true);
		try {
			await updateMemory({
				id: entry.id,
				playlistId,
				patch: {
					title,
					kind: draft.kind,
					content,
					confidence: clamp01(
						Number.parseFloat(draft.confidence),
						entry.confidence,
					),
					importance: clamp01(
						Number.parseFloat(draft.importance),
						entry.importance,
					),
				},
			});
			setEditing(false);
		} finally {
			setSaving(false);
		}
	};

	const handleDelete = async () => {
		setDeleting(true);
		try {
			await deleteMemory({ id: entry.id, playlistId });
		} finally {
			setDeleting(false);
		}
	};

	if (editing) {
		return (
			<article className="border-2 border-white/20 bg-black p-3">
				<div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
					<Input
						aria-label="Memory title"
						className="h-9 rounded-none border-2 border-white/20 bg-gray-950 font-mono text-xs font-bold uppercase text-white focus-visible:ring-0"
						value={draft.title}
						onChange={(event) =>
							setDraft((current) => ({
								...current,
								title: event.target.value,
							}))
						}
					/>
					<select
						aria-label="Memory kind"
						className="h-9 rounded-none border-2 border-white/20 bg-gray-950 px-2 font-mono text-xs font-black uppercase text-white outline-none"
						value={draft.kind}
						onChange={(event) =>
							setDraft((current) => ({
								...current,
								kind: event.target.value as AgentMemoryKind,
							}))
						}
					>
						{MEMORY_KINDS.map((kind) => (
							<option key={kind} value={kind}>
								{kind.toUpperCase()}
							</option>
						))}
					</select>
				</div>
				<Textarea
					aria-label="Memory JSON"
					className="mt-2 max-h-56 min-h-32 resize-y rounded-none border-2 border-white/20 bg-gray-950 font-mono text-[11px] text-white focus-visible:ring-0"
					value={draft.contentText}
					onChange={(event) =>
						setDraft((current) => ({
							...current,
							contentText: event.target.value,
						}))
					}
				/>
				<div className="mt-2 grid grid-cols-2 gap-2">
					<Input
						aria-label="Memory confidence"
						className="h-8 rounded-none border-2 border-white/20 bg-gray-950 font-mono text-xs font-bold uppercase text-white focus-visible:ring-0"
						type="number"
						min="0"
						max="1"
						step="0.05"
						value={draft.confidence}
						onChange={(event) =>
							setDraft((current) => ({
								...current,
								confidence: event.target.value,
							}))
						}
					/>
					<Input
						aria-label="Memory importance"
						className="h-8 rounded-none border-2 border-white/20 bg-gray-950 font-mono text-xs font-bold uppercase text-white focus-visible:ring-0"
						type="number"
						min="0"
						max="1"
						step="0.05"
						value={draft.importance}
						onChange={(event) =>
							setDraft((current) => ({
								...current,
								importance: event.target.value,
							}))
						}
					/>
				</div>
				<div className="mt-3 flex gap-2">
					<Button
						className="h-8 flex-1 rounded-none border-2 border-white/20 bg-white font-mono text-xs font-black uppercase text-black hover:bg-green-500 hover:text-black"
						disabled={saving}
						onClick={handleSave}
					>
						<Save className="h-3.5 w-3.5" />
						SAVE
					</Button>
					<Button
						className="h-8 rounded-none border-2 border-white/20 bg-transparent px-3 font-mono text-xs font-black uppercase text-white/70 hover:bg-white/10"
						disabled={saving}
						onClick={() => {
							resetDraft();
							setEditing(false);
						}}
					>
						<X className="h-3.5 w-3.5" />
					</Button>
				</div>
			</article>
		);
	}

	return (
		<article className="border-2 border-white/10 bg-black p-3">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-1.5">
						<Badge className="rounded-none border-white/20 bg-white/10 font-mono text-[10px] font-black uppercase text-white/70">
							{entry.scope.toUpperCase()}
						</Badge>
						<Badge className="rounded-none border-red-500/30 bg-red-500/10 font-mono text-[10px] font-black uppercase text-red-200">
							{entry.kind.toUpperCase()}
						</Badge>
					</div>
					<h4 className="mt-2 break-words font-mono text-xs font-black uppercase text-white">
						{entry.title}
					</h4>
				</div>
				<div className="flex shrink-0 gap-1">
					<Button
						aria-label="Edit memory"
						className="h-7 w-7 rounded-none border border-white/20 bg-transparent p-0 text-white/60 hover:bg-white hover:text-black"
						onClick={() => setEditing(true)}
					>
						<Pencil className="h-3.5 w-3.5" />
					</Button>
					<Button
						aria-label="Delete memory"
						className="h-7 w-7 rounded-none border border-red-500/30 bg-transparent p-0 text-red-300 hover:bg-red-500 hover:text-white"
						disabled={deleting}
						onClick={handleDelete}
					>
						<Trash2 className="h-3.5 w-3.5" />
					</Button>
				</div>
			</div>
			<pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-white/55">
				{toDisplayJson(entry.content)}
			</pre>
			<div className="mt-3 flex flex-wrap gap-2 font-mono text-[10px] font-bold uppercase text-white/30">
				<span>CONF {entry.confidence.toFixed(2)}</span>
				<span>IMP {entry.importance.toFixed(2)}</span>
				<span>USED {entry.useCount}</span>
				<span>{formatTimeAgo(entry.updatedAt)}</span>
			</div>
		</article>
	);
}

export const OrchestratorPanel = forwardRef<
	HTMLDivElement,
	OrchestratorPanelProps
>(function OrchestratorPanel({ playlistId, disabled }, ref) {
	const [filter, setFilter] = useState<ChannelFilter>("chat");
	const [message, setMessage] = useState("");
	const [commitDirection, setCommitDirection] = useState(false);
	const [sending, setSending] = useState(false);
	const [answeringId, setAnsweringId] = useState<string | null>(null);
	const [answers, setAnswers] = useState<Record<string, string>>({});
	const messages = useAgentChatMessages(playlistId) ?? [];
	const chatState = useAgentChatState(playlistId);
	const memoryEntries = useAgentMemoryEntries(playlistId) ?? [];
	const postChat = usePostAgentChatMessage();
	const answerQuestion = useAnswerAgentQuestion();

	const filteredMessages = useMemo(
		() =>
			messages
				.filter((item) => matchesFilter(item, filter))
				.slice()
				.sort((a, b) => b.createdAt - a.createdAt),
		[messages, filter],
	);

	const handleSubmit = async () => {
		const trimmed = message.trim();
		if (!trimmed || sending || disabled) return;
		setSending(true);
		try {
			await postChat({
				playlistId,
				content: trimmed,
				commitDirection,
			});
			setMessage("");
			setCommitDirection(false);
		} finally {
			setSending(false);
		}
	};

	const handleAnswer = async (questionId: string) => {
		const content = answers[questionId]?.trim();
		if (!content || answeringId) return;
		setAnsweringId(questionId);
		try {
			await answerQuestion({ playlistId, questionId, content });
			setAnswers((current) => {
				const next = { ...current };
				delete next[questionId];
				return next;
			});
		} finally {
			setAnsweringId(null);
		}
	};

	return (
		<section ref={ref} className="border-y-4 border-white/20 bg-gray-950 p-4">
			<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
				<div className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-widest text-white/60">
					<MessageSquare className="h-3.5 w-3.5 text-red-400" />
					ORCHESTRATOR
				</div>
				<div className="flex flex-wrap gap-1.5">
					<Badge className="rounded-none border-white/10 bg-white/5 font-mono text-[10px] font-black uppercase text-white/50">
						{messages.length} MSG
					</Badge>
					<Badge className="rounded-none border-white/10 bg-white/5 font-mono text-[10px] font-black uppercase text-white/50">
						{memoryEntries.length} MEMORY
					</Badge>
				</div>
			</div>

			<div className="border-2 border-white/10 bg-black p-3">
				<div className="flex items-start gap-2">
					<Textarea
						aria-label="Chat with orchestrator"
						className="min-h-20 flex-1 resize-y rounded-none border-2 border-white/25 bg-gray-950 font-mono text-sm font-semibold text-white/90 placeholder:font-black placeholder:uppercase placeholder:text-white/25 focus-visible:ring-0"
						placeholder="MESSAGE PLAYLIST DIRECTOR..."
						value={message}
						onChange={(event) => setMessage(event.target.value)}
						onKeyDown={(event) => {
							if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
								event.preventDefault();
								void handleSubmit();
							}
						}}
						disabled={disabled || sending}
					/>
					<Button
						aria-label="Send orchestrator message"
						className="h-20 w-14 rounded-none border-2 border-white/20 bg-white p-0 text-black hover:bg-red-500 hover:text-white"
						disabled={disabled || sending || !message.trim()}
						onClick={handleSubmit}
					>
						<Send className="h-5 w-5" />
					</Button>
				</div>
				<div className="mt-2 flex flex-wrap items-center justify-between gap-2">
					<button
						type="button"
						disabled={disabled}
						className={cn(
							"inline-flex h-8 items-center gap-1 border-2 px-3 font-mono text-[10px] font-black uppercase transition-colors",
							commitDirection
								? "border-yellow-500 bg-yellow-500 text-black"
								: "border-white/20 bg-transparent text-white/50 hover:text-white",
						)}
						onClick={() => setCommitDirection((current) => !current)}
					>
						{commitDirection && <Check className="h-3.5 w-3.5" />}
						COMMIT DIRECTION
					</button>
					{chatState?.generationBlocked && (
						<span className="font-mono text-[10px] font-black uppercase text-yellow-300">
							WAITING FOR ANSWER
						</span>
					)}
				</div>
			</div>

			{chatState?.requiredQuestions.length ? (
				<div className="mt-3 space-y-2 border-2 border-yellow-500/30 bg-yellow-500/10 p-3">
					<div className="font-mono text-[10px] font-black uppercase tracking-widest text-yellow-200">
						DIRECTOR QUESTIONS
					</div>
					{chatState.requiredQuestions.map((question) => (
						<div key={question.id} className="space-y-2">
							<p className="break-words font-mono text-xs font-bold uppercase text-white/80">
								{question.content}
							</p>
							<div className="flex gap-2">
								<Input
									aria-label="Answer director question"
									className="h-9 rounded-none border-2 border-white/20 bg-gray-950 font-mono text-xs font-bold uppercase text-white focus-visible:ring-0"
									value={answers[question.id] ?? ""}
									onChange={(event) =>
										setAnswers((current) => ({
											...current,
											[question.id]: event.target.value,
										}))
									}
									onKeyDown={(event) => {
										if (event.key === "Enter") {
											void handleAnswer(question.id);
										}
									}}
								/>
								<Button
									className="h-9 rounded-none border-2 border-white/20 bg-white px-3 font-mono text-xs font-black uppercase text-black hover:bg-yellow-500"
									disabled={
										answeringId === question.id || !answers[question.id]?.trim()
									}
									onClick={() => handleAnswer(question.id)}
								>
									<Send className="h-3.5 w-3.5" />
								</Button>
							</div>
						</div>
					))}
				</div>
			) : null}

			<div className="mt-4">
				<div className="mb-2 flex items-center gap-2 font-mono text-[10px] font-black uppercase tracking-widest text-white/35">
					<Bot className="h-3.5 w-3.5" />
					{filter === "memory" ? "MEMORY" : "CHANNEL"}
				</div>
				<div className="mb-2 flex flex-wrap gap-1.5">
					{CHANNEL_FILTERS.map((item) => (
						<button
							key={item.id}
							type="button"
							className={cn(
								"h-7 border px-2 font-mono text-[10px] font-black uppercase transition-colors",
								filter === item.id
									? "border-red-500 bg-red-500 text-white"
									: "border-white/10 bg-black text-white/45 hover:text-white",
							)}
							onClick={() => setFilter(item.id)}
						>
							{item.label}
						</button>
					))}
				</div>
				<div className="space-y-2 pr-1">
					{filter === "memory" ? (
						memoryEntries.length === 0 ? (
							<div className="border-2 border-white/10 bg-black p-4 text-center font-mono text-xs font-black uppercase text-white/30">
								NO MEMORY ENTRIES
							</div>
						) : (
							memoryEntries.map((entry) => (
								<MemoryEntryEditor
									key={entry.id}
									entry={entry}
									playlistId={playlistId}
								/>
							))
						)
					) : filteredMessages.length === 0 ? (
						<div className="border-2 border-white/10 bg-black p-4 text-center font-mono text-xs font-black uppercase text-white/30">
							NO CHANNEL MESSAGES
						</div>
					) : (
						filteredMessages.map((item) => (
							<article
								key={item.id}
								className={cn(
									"border-2 p-3 shadow-[0_10px_24px_rgba(0,0,0,0.28)]",
									messageClass(item),
									item.visibility === "collapsed" && "opacity-70",
								)}
							>
								<div className="flex gap-3">
									<div
										className={cn(
											"mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center border-2",
											iconClass(item),
										)}
									>
										<MessageTypeIcon message={item} />
									</div>
									<div className="min-w-0 flex-1">
										<div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
											<div className="flex min-w-0 flex-wrap items-center gap-1.5">
												<Badge className="rounded-none border-white/15 bg-black/60 font-mono text-[10px] font-black uppercase text-white/75">
													{senderLabel(item)}
												</Badge>
												<span className="font-mono text-[10px] font-black uppercase tracking-wide text-white/45">
													{messageTypeLabel(item)}
												</span>
											</div>
											<span className="font-mono text-[10px] font-bold uppercase text-white/35">
												{formatTimeAgo(item.createdAt)}
											</span>
										</div>
										<p className="whitespace-pre-wrap break-words font-mono text-sm font-semibold leading-6 text-white/90">
											{item.content}
										</p>
										{item.data ? (
											<details className="group mt-3 border-t border-white/15 pt-2">
												<summary className="cursor-pointer font-mono text-[10px] font-black uppercase tracking-widest text-white/35 marker:text-white/35 hover:text-white/60">
													METADATA
												</summary>
												<pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap break-words bg-black/35 p-2 font-mono text-[10px] leading-relaxed text-white/50">
													{toDisplayJson(item.data)}
												</pre>
											</details>
										) : null}
									</div>
								</div>
							</article>
						))
					)}
				</div>
			</div>
		</section>
	);
});
