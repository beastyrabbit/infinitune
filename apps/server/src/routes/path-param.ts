import type { Context } from "hono";

/**
 * Read a path parameter declared by the matched route. Hono widens the type
 * to `string | undefined` for handlers behind untyped middleware or helpers
 * taking a plain Context, although the router always supplies it.
 */
export function pathParam(c: Context, name: string): string {
	return c.req.param(name) ?? "";
}
