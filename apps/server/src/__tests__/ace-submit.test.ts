import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../external/service-urls", () => ({
	getServiceUrls: vi.fn(async () => ({
		aceStepUrl: "http://ace.test",
		ollamaUrl: "http://ollama.test",
		comfyuiUrl: "http://comfy.test",
	})),
}));

import { submitToAce } from "../external/ace";

function mockAceSubmitResponse() {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () =>
			Response.json({
				data: { task_id: "task-1" },
			}),
		),
	);
}

function baseSubmitOptions() {
	return {
		lyrics: "hello",
		caption: "electronic pop",
		bpm: 120,
		keyScale: "C major",
		timeSignature: "4/4",
		audioDuration: 180,
	};
}

describe("submitToAce", () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
		mockAceSubmitResponse();
	});

	it("sends XL model and DCW params without VAE per-request payload", async () => {
		await submitToAce({
			...baseSubmitOptions(),
			aceModel: "acestep-v15-xl-turbo",
			aceDcwEnabled: true,
			aceDcwMode: "double",
			aceDcwScaler: 0.05,
			aceDcwHighScaler: 0.02,
			aceDcwWavelet: "haar",
		});

		const fetchMock = vi.mocked(fetch);
		const payload = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);

		expect(payload.model).toBe("acestep-v15-xl-turbo");
		expect(payload.dcw_enabled).toBe(true);
		expect(payload.dcw_mode).toBe("double");
		expect(payload.dcw_scaler).toBe(0.05);
		expect(payload.dcw_high_scaler).toBe(0.02);
		expect(payload.dcw_wavelet).toBe("haar");
		expect(payload.vae_checkpoint).toBeUndefined();
	});

	it("omits the default model sentinel", async () => {
		await submitToAce({
			...baseSubmitOptions(),
			aceModel: "__default__",
		});

		const fetchMock = vi.mocked(fetch);
		const payload = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);

		expect(payload.model).toBeUndefined();
	});

	it("preserves an explicit DCW off setting", async () => {
		await submitToAce({
			...baseSubmitOptions(),
			aceDcwEnabled: false,
		});

		const fetchMock = vi.mocked(fetch);
		const payload = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);

		expect(payload.dcw_enabled).toBe(false);
		expect(payload.dcw_mode).toBeUndefined();
	});
});
