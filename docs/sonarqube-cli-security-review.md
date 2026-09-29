# CLI security finding review

Reviewed on 2026-09-29 against the campaign's MAIN baseline. Line numbers below
refer to that baseline, before this change. No finding was classified remotely
as part of this review.

## Executable lookup

Rule `typescript:S4036` asks whether PATH contains fixed, non-writable directories.
A malicious executable earlier in PATH can run with the caller's privileges.
Passing arguments without a shell prevents shell interpolation, but does not
prevent PATH substitution.

The six CLI sites below run desktop commands as the invoking user. The service
installer explicitly uses `systemctl --user`; it does not elevate privileges.
README.md documents this user service and the wrapper in `~/.local/bin`.
`getSystemdUserDir` and `getLocalBinDir` in `apps/cli/src/lib/paths.ts` resolve into
the caller's home directory. Remote playback data can affect command arguments,
but these call sites never take an executable name or PATH from that data.

The maintenance script is a separate local invocation, `pnpm tag:mp3s`, with the
operator's environment. The server imports `apps/server/src/external/tag-mp3.ts`,
not `scripts/tag-mp3s.ts`. Dockerfile copies neither `apps/cli` nor `scripts` into
the production image. These findings therefore do not establish remote command
execution in the deployed server.

| Issue ID | Baseline location | Verified execution and proposed disposition |
| --- | --- | --- |
| `a719f977-6d6b-47eb-883b-8e5d89e8ce7b` | `apps/cli/src/audio/ffplay-engine.ts:273` | Fixed `ffplay` executable, shell-free argument array and inherited caller environment. URL is an argument to `-i`. Contextual false-positive candidate for the supported user-owned desktop invocation. |
| `a030da7d-5feb-4266-a31b-70a0ea1af178` | `apps/cli/src/audio/ffplay-engine.ts:355` | Fixed `pactl`, shell-free `set-sink-input-volume` arguments. Runs in the desktop user's audio session. Contextual false-positive candidate under the same caller-owned PATH assumption. |
| `de5fb0d6-db38-4ae3-984c-bfae79d7f3c5` | `apps/cli/src/audio/ffplay-engine.ts:390` | Fixed `pactl` with constant `list`, `sink-inputs` arguments. No request can select the executable or PATH. Contextual false-positive candidate for user-owned desktop execution. |
| `02e7737c-4669-48a0-858a-dba8b8fa8dcc` | `apps/cli/src/cli.ts:1830` | Fixed `systemctl`, `--user` always prepended; remaining callers use fixed service operations and unit name. Contextual false-positive candidate for a user service installer with a trusted caller environment. |
| `c610855a-1c62-48ad-b9cb-a49e389f3887` | `apps/cli/src/cli.ts:1937` | Fixed `man`, `-l` and a locally resolved manpage path in an argument array. Explicit interactive command, no privilege change. Contextual false-positive candidate with caller-owned PATH. |
| `0a188cba-60da-4521-9cb3-e6fbbaf78cba` | `apps/cli/src/lib/fzf.ts:34` | Fixed `fzf`, argument array and picker data on stdin. No `shell` option or executable derived from a song or playlist. Contextual false-positive candidate for the invoking user's interactive picker. |
| `6281127b-b164-4c22-8473-d3d9018b5cde` | `scripts/tag-mp3s.ts:139` | Fixed `ffmpeg` through `execFileSync`, metadata passed as individual arguments. Operator-run maintenance script absent from the runtime image and unused by the worker. Contextual false-positive candidate under a trusted operator environment. |

These dispositions depend on the caller controlling and trusting PATH. The code
does not enforce that property for every installation. A deployment that runs
these commands with elevated privileges or includes another user's writable
directory in PATH must be reviewed separately. The review does not certify
arbitrary runtime environments or the independent server-side ffmpeg call sites.
Hardcoding `/usr/bin` would break legitimate local installations without proving
those broader assumptions. No PATH behavior or global rule configuration changed.

Campaign decision: leave all seven PATH issues OPEN. The table records the
supported execution context, but the repository cannot prove that every caller's
PATH excludes directories writable by another user. No risk was accepted and no
false-positive classification was applied to those seven issues.

## Wrapper permissions

Issue `c50811af-0d08-45bb-8680-49c1cafb5b7d`, `typescript:S2612`, points to
`apps/cli/src/cli.ts:1826`. `writeExecutableScript` writes the user's
`~/.local/bin/infi` wrapper and applies mode `0755`. The wrapper contains the
Node executable path, loader path, CLI entry path and forwarded arguments. It
does not embed device tokens. Only its owner has write permission; other users
can read and execute the non-secret wrapper. Recommended disposition is false
positive for this specific chmod operation. This does not establish the safety
of every ancestor directory on an arbitrary user's machine.

## Confirmed adjacent permission problems

The service installer embeds the selected device token in the generated unit's
`ExecStart`. Previously it wrote that file using default permissions, normally
`0644` under a `0022` umask, making the token readable by other local users who
could traverse the home directory. Existing files retained their old modes.
`saveConfig` in `apps/cli/src/config.ts` also saved the device token to
`config.json` using default permissions.

The installer now opens new units with mode `0600` and applies `fchmod(0600)` to
the open descriptor before writing content. That also restricts an existing
unit before writing a new token. It closes the descriptor on write failure.
Regression tests cover both first installation and replacement of a `0644` unit,
including the mode at the moment content is written. Child processes are mocked;
the tests do not contact systemd, a server or an AI provider.

Configuration writes now use the same descriptor-before-write restriction.
Separate regression tests cover new and existing `0644` configuration files,
check their permissions when content is written, and verify the saved
configuration still loads unchanged. Existing files are restricted when next
saved; this change does not alter files on machines where the CLI is not run.

This is a confirmed code hardening fix found during the permissions review, not
a fix to the reported wrapper issue. It does not remove tokens from process
arguments; that remaining local credential exposure requires a separate focused
change.
