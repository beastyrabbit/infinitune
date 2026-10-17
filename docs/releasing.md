# Release and review workflow

The current checkout uses GitHub as `origin`
(`git@github.com:beastyrabbit/infinitune.git`). Verify the remote before
pushing from another checkout.

Pushing a lightweight `vX.Y.Z` tag runs `.github/workflows/build.yaml`. The
workflow publishes the semver, `major.minor`, short-SHA, and `latest` tags to
`ghcr.io/${github.repository}` and records the image digest in the workflow
summary. Any production rollout is downstream of that image publication and
must be verified in the deployment system separately.
