import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../external/service-urls", () => ({
	getServiceUrls: vi.fn(async () => ({
		aceStepUrl: "http://ace.test",
		ollamaUrl: "http://ollama.test",
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

	it("sends the complete Preset M payload by default", async () => {
		await submitToAce(baseSubmitOptions());

		const fetchMock = vi.mocked(fetch);
		const payload = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);

		expect(payload).toMatchObject({
			model: "acestep-v15-xl-sft",
			thinking: false,
			use_format: false,
			use_cot_caption: false,
			use_cot_metas: false,
			use_cot_language: false,
			inference_steps: 50,
			guidance_scale: 7,
			infer_method: "ode",
			sampler_mode: "heun",
			shift: 1,
			velocity_norm_threshold: 2,
			velocity_ema_factor: 0.1,
			use_adg: false,
			dcw_enabled: false,
		});
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

	it("omits the model for an explicit empty server-default setting", async () => {
		await submitToAce({
			...baseSubmitOptions(),
			aceModel: "",
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

	it("preserves valid explicit Preset M overrides", async () => {
		await submitToAce({
			...baseSubmitOptions(),
			inferenceSteps: 72,
			guidanceScale: 12,
			inferMethod: "sde",
			samplerMode: "euler",
			shift: 4,
			velocityNormThreshold: 3.5,
			velocityEmaFactor: 0.25,
			useAdg: true,
			aceDcwEnabled: true,
			aceThinking: true,
		});

		const fetchMock = vi.mocked(fetch);
		const payload = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);

		expect(payload).toMatchObject({
			thinking: true,
			inference_steps: 72,
			guidance_scale: 12,
			infer_method: "sde",
			sampler_mode: "euler",
			shift: 4,
			velocity_norm_threshold: 3.5,
			velocity_ema_factor: 0.25,
			use_adg: true,
			dcw_enabled: true,
		});
	});
});
