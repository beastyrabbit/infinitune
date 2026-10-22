# Release and review workflow

The current checkout uses GitHub as `origin`
(`git@github.com:beastyrabbit/infinitune.git`). Verify the remote before
pushing from another checkout.

Pushing a lightweight `vX.Y.Z` tag runs `.github/workflows/build.yaml`. The
workflow publishes the semver, `major.minor`, short-SHA, and `latest` tags to
`ghcr.io/${github.repository}` and records the image digest in the workflow
summary. Any production rollout is downstream of that image publication and
is checked automatically after the sourcemap job succeeds.

Before building or publishing, the workflow requires the newest main push
CI run for the exact checked-out commit to have succeeded. It waits up to
30 minutes while that run is in progress. This applies to tags and manual
`workflow_dispatch` runs. A manual run on a feature branch commit without
a main push CI run fails by design.

Wait for main CI before tagging. Tagging before its CI run exists fails
the gate. A newer main push can cancel an older commit's CI run, which
must be re-run successfully before that commit can be released. Branch
protection on main is the repository owner's choice.

Prerelease tags skip the rollout job because Flux's `>=0.0.0` ImagePolicy
excludes prereleases.

For stable version tags, the rollout smoke job polls the trusted LAN route
`http://192.168.60.30/api/version` until it reports the exact release,
then requires a 2xx response or a same-origin redirect from `GET /` without
following redirects. The overall bound is 20 minutes, including up to
8 minutes to establish reachability, covering the outage during a Recreate
rollout. The public URL is behind Pangolin SSO. The check uses
only GET requests and makes no generation or paid AI calls. An older or
unavailable version keeps waiting; a newer semver release fails as
`Superseded`, rather than counting as success.

If the gate fails, fix the commit on main or re-run CI for that commit,
then re-run the release workflow. If the smoke check times out, the image
is already published. Inspect Flux's ImagePolicy and HelmRelease for
infinitune, then re-run the failed job. For `Superseded`, verify the newer
release instead. Flux picks the highest semver, so a rollback requires
releasing a higher fixed version.
