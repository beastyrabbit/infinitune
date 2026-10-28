import { createMiddleware, createStart } from "@tanstack/react-start";

const reportFunctionErrors = createMiddleware({ type: "function" }).server(
	async ({ next }) => {
		try {
			const result = await next();
			if ("error" in result && result.error instanceof Error) {
				const { captureError } = await import(
					"@infinitune/shared/telemetry-node"
				);
				captureError(result.error, { runtime: "server-function" });
			}
			return result;
		} catch (error) {
			const { captureError } = await import(
				"@infinitune/shared/telemetry-node"
			);
			captureError(error, { runtime: "server-function" });
			throw error;
		}
	},
);

export const startInstance = createStart(() => ({
	functionMiddleware: [reportFunctionErrors],
}));
