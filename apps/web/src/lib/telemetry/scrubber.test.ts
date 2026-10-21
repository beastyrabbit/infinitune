import { scrubString, scrubTelemetry } from "@infinitune/shared/telemetry";
import { describe, expect, it } from "vitest";

describe("telemetry scrubber", () => {
	it.each([
		["A.B+tag%test@example-domain.COM", "[Filtered]"],
		["one@example.com two@host.test", "[Filtered] [Filtered]"],
		["a@b.c a@b.12 a@b", "a@b.c a@b.12 a@b"],
		[
			"a@b.co1 a@b.com.123 a@b.co.test",
			"[Filtered]1 [Filtered].123 [Filtered]",
		],
		["@example.com a@@b.test", "@example.com a@@b.test"],
		["a@b.test@c.test", "[Filtered]@c.test"],
		["a@b.co1@c.test", "[Filtered][Filtered]"],
		["a@.test a@..test a@.co.test", "a@.test [Filtered] [Filtered]"],
		[
			"https://user:pass@example.com/path?token=test#fragment",
			"https://example.com/path",
		],
		[
			"https://example.com/https://user:pass@host/path",
			"https://example.com/https://[Filtered]@host/path",
		],
		[
			"https://example.com/https://:user:pass@host/path",
			"https://example.com/https://[Filtered]@host/path",
		],
		[
			"https://example.com/https://user:@host/path",
			"https://example.com/https://user:@host/path",
		],
		[
			"https://example.com/https://:pass@host/path",
			"https://example.com/https://:pass@host/path",
		],
		["https://user:pass@", "[Filtered URL]"],
		["Bearer test-token; Basic dGVzdA==", "[Filtered]; [Filtered]"],
		["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signature", "[Filtered]"],
		[
			'token=test&key=test; secret: test password="test" code=test api_key=test api-key=test apikey=test authorization=test cookie=test',
			'token=[Filtered]&key=[Filtered]; secret: [Filtered] password="[Filtered]" code=[Filtered] api_key=[Filtered] api-key=[Filtered] apikey=[Filtered] authorization=[Filtered] cookie=[Filtered]',
		],
		[
			"/share/test/path /by-key/test?foo=bar",
			"/share/[Filtered]/path /by-key/[Filtered]?foo=bar",
		],
	])("preserves redaction for %s", (input, expected) => {
		expect(scrubString(input)).toBe(expected);
	});

	it.each([
		"Authorization",
		"cookie",
		"x-token",
		"Password",
		"client_secret",
		"x-apiKey",
		"API_KEY",
		"api-key",
		"key",
		"code",
		"Remote-Name",
		"remote_user",
		"email",
		"prompt",
		"lyrics",
		"user",
		"ip_address",
		"x-forwarded-for",
		"x-real_ip",
		"cf-connecting-ip",
		"query_string",
		"data",
		"body",
		"extra",
		"vars",
	])("filters sensitive key %s for strings and objects", (key) => {
		expect(scrubTelemetry({ [key]: "test value" })).toEqual({
			[key]: "[Filtered]",
		});
		expect(scrubTelemetry({ [key]: { nested: "test value" } })).toEqual({
			[key]: undefined,
		});
	});

	it("preserves exact-key boundaries and the wildcard separator semantics", () => {
		expect(
			scrubTelemetry({
				keyboard: "ok",
				codebase: "ok",
				users: "ok",
				metadata: "ok",
				"x-remote-name": "ok",
				"forwarded\nfor": "ok",
				realXip: "test",
				apiKey: "ok",
				"key\n": "ok",
			}),
		).toEqual({
			keyboard: "ok",
			codebase: "ok",
			users: "ok",
			metadata: "ok",
			"x-remote-name": "ok",
			"forwarded\nfor": "ok",
			realXip: "[Filtered]",
			apiKey: "ok",
			"key\n": "ok",
		});
	});

	it.each([
		["email local part", "a".repeat(50_000)],
		["domain without dots", `a@${"a".repeat(50_000)}`],
		["domain without suffix", `a@${".".repeat(50_000)}`],
		[
			"userinfo without terminator",
			`https://example.com/https://${":".repeat(50_000)}`,
		],
		[
			"userinfo with terminator",
			`https://example.com/https://${":".repeat(50_000)}@host/path`,
		],
	])("scrubs 50k-character %s in under one second", (_name, input) => {
		const started = performance.now();
		const result = scrubString(input);
		expect(result.length).toBeGreaterThan(0);
		expect(performance.now() - started).toBeLessThan(1000);
	});

	it("checks a long sensitive-key candidate in under one second", () => {
		const key = `${"a".repeat(50_000)}API_KEY`;
		const started = performance.now();
		expect(scrubTelemetry({ [key]: "test" })).toEqual({ [key]: "[Filtered]" });
		expect(performance.now() - started).toBeLessThan(1000);
	});
});
