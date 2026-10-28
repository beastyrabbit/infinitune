#!/usr/bin/env bash
set -euo pipefail

# Compare the complete JavaScript path/hash sets, not just files present in
# both builds. Never upload maps from a rebuild that differs from the image.
export_dir=${1:?Usage: verify-telemetry-sourcemaps.sh EXPORT_DIR RUNTIME_PUBLIC_DIR}
runtime_dir=${2:?Usage: verify-telemetry-sourcemaps.sh EXPORT_DIR RUNTIME_PUBLIC_DIR}
manifest_dir=$(mktemp -d)
trap 'rm -rf "$manifest_dir"' EXIT

js_manifest() {
  (
    cd "$1"
    find . -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.cjs' \) -print0 |
      LC_ALL=C sort -z | xargs -0 -r sha256sum
  )
}

js_manifest "$export_dir" > "$manifest_dir/export"
js_manifest "$runtime_dir" > "$manifest_dir/runtime"
if [ ! -s "$manifest_dir/export" ] || ! cmp -s "$manifest_dir/export" "$manifest_dir/runtime"; then
  echo 'Source-map JavaScript differs from the published runtime image; refusing upload.' >&2
  exit 1
fi
if [ -z "$(find "$export_dir" -type f -name '*.map' -print -quit)" ]; then
  echo 'No source maps exported; refusing upload.' >&2
  exit 1
fi
if [ -n "$(find "$runtime_dir" -type f -name '*.map' -print -quit)" ]; then
  echo 'Source maps found in the runtime public directory.' >&2
  exit 1
fi
echo "Verified $(wc -l < "$manifest_dir/export") JavaScript files against the runtime image with SHA256."
