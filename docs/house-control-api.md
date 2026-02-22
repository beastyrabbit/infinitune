# House Control API

Backend-first control endpoints for house-wide playback automation.

## Auth

Use one of:

- `Authorization: Bearer <Shoo ID token>`
- `x-device-token: <device token>`

`x-device-token` is enough for automation clients after a device has been issued a token.

## Core Commands

### House-wide command

`POST /api/v1/house/commands`

```json
{
	"action": "stop",
	"playlistIds": ["playlist_id_optional"],
	"payload": {}
}
```

- If `playlistIds` is omitted, command is sent to all active accessible sessions.
- Response:

```json
{
	"ok": true,
	"affectedPlaylistIds": ["..."],
	"affectedRoomIds": ["..."],
	"skippedPlaylistIds": ["..."]
}
```

### Per-playlist command

`POST /api/v1/commands`

```json
{
	"playlistId": "playlist_id",
	"action": "pause",
	"targetDeviceId": "optional_device_id",
	"payload": {}
}
```

## Sessions and Devices

- `GET /api/v1/house/sessions` (returns all accessible active sessions)
- `GET /api/v1/playlists/:playlistId/session`
- `GET /api/v1/devices`
- `POST /api/v1/devices` (issue token)
- `POST /api/v1/devices/register`
- `POST /api/v1/playlists/:playlistId/devices/:deviceId/assign`
- `POST /api/v1/playlists/:playlistId/devices/:deviceId/unassign`

## Home Assistant Example

Stop all active sessions:

```bash
curl -X POST "https://your-host/api/v1/house/commands" \
  -H "Content-Type: application/json" \
  -H "x-device-token: ${INFINITUNE_DEVICE_TOKEN}" \
  -d '{"action":"stop"}'
```

Stop one playlist session:

```bash
curl -X POST "https://your-host/api/v1/house/commands" \
  -H "Content-Type: application/json" \
  -H "x-device-token: ${INFINITUNE_DEVICE_TOKEN}" \
  -d '{"action":"stop","playlistIds":["playlist_id"]}'
```
