import {
	createInspector,
	type StatelyInspectionEvent,
} from "@statelyai/inspect";
import type { InspectionEvent, Observer } from "xstate";

type InspectionRecord = {
	at: number;
	event: StatelyInspectionEvent;
};

const INSPECT_ENABLED =
	process.env.XSTATE_INSPECT_ENABLED === "1" ||
	process.env.XSTATE_INSPECT_ENABLED === "true";
const DEFAULT_MAX_EVENTS = 200;
const MAX_EVENTS = Number.isFinite(
	Number(process.env.XSTATE_INSPECT_MAX_EVENTS ?? DEFAULT_MAX_EVENTS),
)
	? Math.max(
			1,
			Number(process.env.XSTATE_INSPECT_MAX_EVENTS ?? DEFAULT_MAX_EVENTS),
		)
	: DEFAULT_MAX_EVENTS;

let inspector: ReturnType<typeof createInspector> | null = null;
const events: InspectionRecord[] = [];

function getOrCreateInspector() {
	if (!INSPECT_ENABLED) return null;
	if (inspector) return inspector;

	const adapter = {
		start() {},
		stop() {},
		send(event: StatelyInspectionEvent) {
			const record: InspectionRecord = {
				at: Date.now(),
				event,
			};
			events.push(record);
			if (events.length > MAX_EVENTS) {
				events.shift();
			}
		},
	};
	inspector = createInspector(adapter, {
		autoStart: true,
		maxDeferredEvents: MAX_EVENTS,
	});
	return inspector;
}

export function getWorkerInspectObserver():
	| Observer<InspectionEvent>
	| undefined {
	const currentInspector = getOrCreateInspector();
	return currentInspector?.inspect;
}

export function getWorkerInspectionLog(limit = DEFAULT_MAX_EVENTS) {
	const resolved = Math.max(
		1,
		Math.min(
			Number.isFinite(limit) ? Math.floor(limit) : DEFAULT_MAX_EVENTS,
			MAX_EVENTS,
		),
	);
	return {
		enabled: INSPECT_ENABLED,
		maxEvents: MAX_EVENTS,
		events: events.slice(-resolved),
	};
}

export function clearWorkerInspectionLog(): void {
	events.splice(0, events.length);
}
