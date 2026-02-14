import { createDocument } from "zod-openapi";
import {
	CreateRoomRequestSchema,
	NowPlayingResponseSchema,
	RoomInfoSchema,
} from "./protocol.js";

export function generateOpenApiSpec() {
	return createDocument({
		openapi: "3.1.0",
		info: {
			title: "Infinitune Room Server",
			version: "1.0.0",
			description:
				"Multi-device playback coordination for Infinitune. Manages rooms where multiple players and controllers share playback state.",
		},
		servers: [{ url: "http://localhost:5174" }],
		paths: {
			"/api/v1/rooms": {
				get: {
					summary: "List active rooms",
					operationId: "listRooms",
					responses: {
						"200": {
							description: "List of rooms",
							content: {
								"application/json": {
									schema: RoomInfoSchema.array(),
								},
							},
						},
					},
				},
				post: {
					summary: "Create a new room",
					operationId: "createRoom",
					requestBody: {
						required: true,
						content: {
							"application/json": {
								schema: CreateRoomRequestSchema,
							},
						},
					},
					responses: {
						"201": {
							description: "Room created",
							content: {
								"application/json": {
									schema: CreateRoomRequestSchema,
								},
							},
						},
					},
				},
			},
			"/api/v1/now-playing": {
				get: {
					summary: "Get now-playing info for a room (Waybar compatible)",
					operationId: "getNowPlaying",
					parameters: [
						{
							name: "room",
							in: "query",
							required: true,
							schema: { type: "string" },
							description: "Room ID",
						},
					],
					responses: {
						"200": {
							description: "Now playing info",
							content: {
								"application/json": {
									schema: NowPlayingResponseSchema,
								},
							},
						},
					},
				},
			},
		},
	});
}
