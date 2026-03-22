#!/usr/bin/env bash
#
# Bootstrap a freshly created T3Code worktree by copying local env files
# and running the main project install/setup command when needed.

set -euo pipefail

STAMP_FILE_NAME=".t3code-worktree-bootstrap.json"
ENV_FILES=(
  ".env.local"
  ".env"
  ".env.development.local"
  ".env.development"
  ".env.test.local"
  ".env.test"
)

BOOTSTRAP_KIND=""
BOOTSTRAP_FILES=()
BOOTSTRAP_CMD=()

log() {
  printf '%s\n' "$*"
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

resolve_dir() {
  local path=$1
  cd "$path" >/dev/null 2>&1 && pwd -P
}

require_cmd() {
  local name=$1
  command -v "$name" >/dev/null 2>&1 || die "required command not found: $name"
}

hash_files() {
  local file

  if command -v sha256sum >/dev/null 2>&1; then
    for file in "$@"; do
      printf '%s\n' "${file##*/}"
      cat "$file"
    done | sha256sum | awk '{print $1}'
    return 0
  fi

  if command -v shasum >/dev/null 2>&1; then
    for file in "$@"; do
      printf '%s\n' "${file##*/}"
      cat "$file"
    done | shasum -a 256 | awk '{print $1}'
    return 0
  fi

  die "sha256sum or shasum is required"
}

copy_env_file() {
  local name=$1
  local src="$PROJECT_ROOT/$name"
  local dest="$WORKTREE_PATH/$name"

  if [[ ! -f "$src" ]]; then
    return 0
  fi

  if [[ -e "$dest" ]]; then
    log "skipped $name (already exists)"
    return 0
  fi

  cp "$src" "$dest"
  log "copied $name"
}

uses_uv_pyproject() {
  local pyproject=$1

  [[ -f "$pyproject" ]] || return 1
  grep -Eq '^\[tool\.uv(\..*)?\]|^[[:space:]]*build-backend[[:space:]]*=[[:space:]]*"uv_build"' "$pyproject"
}

detect_bootstrap() {
  local root=$1

  BOOTSTRAP_KIND=""
  BOOTSTRAP_FILES=()
  BOOTSTRAP_CMD=()

  if [[ -f "$root/package.json" && -f "$root/pnpm-lock.yaml" ]]; then
    BOOTSTRAP_KIND="pnpm"
    BOOTSTRAP_FILES=("$root/package.json" "$root/pnpm-lock.yaml")
    BOOTSTRAP_CMD=(pnpm install --frozen-lockfile)
    return 0
  fi

  if [[ -f "$root/package.json" && -f "$root/package-lock.json" ]]; then
    BOOTSTRAP_KIND="npm"
    BOOTSTRAP_FILES=("$root/package.json" "$root/package-lock.json")
    BOOTSTRAP_CMD=(npm ci)
    return 0
  fi

  if [[ -f "$root/package.json" && -f "$root/yarn.lock" ]]; then
    BOOTSTRAP_KIND="yarn"
    BOOTSTRAP_FILES=("$root/package.json" "$root/yarn.lock")
    BOOTSTRAP_CMD=(yarn install --frozen-lockfile)
    return 0
  fi

  if [[ -f "$root/package.json" && ( -f "$root/bun.lock" || -f "$root/bun.lockb" ) ]]; then
    BOOTSTRAP_KIND="bun"
    BOOTSTRAP_FILES=("$root/package.json")
    [[ -f "$root/bun.lock" ]] && BOOTSTRAP_FILES+=("$root/bun.lock")
    [[ -f "$root/bun.lockb" ]] && BOOTSTRAP_FILES+=("$root/bun.lockb")

    if command -v bun >/dev/null 2>&1 && bun install --help 2>/dev/null | grep -q -- '--frozen-lockfile'; then
      BOOTSTRAP_CMD=(bun install --frozen-lockfile)
    else
      BOOTSTRAP_CMD=(bun install)
    fi
    return 0
  fi

  if [[ -f "$root/uv.lock" ]]; then
    BOOTSTRAP_KIND="uv"
    BOOTSTRAP_FILES=("$root/uv.lock")
    [[ -f "$root/pyproject.toml" ]] && BOOTSTRAP_FILES+=("$root/pyproject.toml")
    BOOTSTRAP_CMD=(uv sync)
    return 0
  fi

  if [[ -f "$root/poetry.lock" ]]; then
    BOOTSTRAP_KIND="poetry"
    BOOTSTRAP_FILES=("$root/poetry.lock")
    [[ -f "$root/pyproject.toml" ]] && BOOTSTRAP_FILES+=("$root/pyproject.toml")
    BOOTSTRAP_CMD=(poetry install --no-root)
    return 0
  fi

  if [[ -f "$root/Cargo.toml" ]]; then
    BOOTSTRAP_KIND="cargo"
    BOOTSTRAP_FILES=("$root/Cargo.toml")
    [[ -f "$root/Cargo.lock" ]] && BOOTSTRAP_FILES+=("$root/Cargo.lock")
    BOOTSTRAP_CMD=(cargo fetch)
    return 0
  fi

  if uses_uv_pyproject "$root/pyproject.toml"; then
    BOOTSTRAP_KIND="uv"
    BOOTSTRAP_FILES=("$root/pyproject.toml")
    BOOTSTRAP_CMD=(uv sync)
    return 0
  fi

  if [[ -f "$root/go.mod" ]]; then
    BOOTSTRAP_KIND="go"
    BOOTSTRAP_FILES=("$root/go.mod")
    [[ -f "$root/go.sum" ]] && BOOTSTRAP_FILES+=("$root/go.sum")
    BOOTSTRAP_CMD=(go mod download)
    return 0
  fi

  return 1
}

read_stamp_field() {
  local field=$1
  local stamp_path=$2
  local content

  [[ -f "$stamp_path" ]] || return 1
  content=$(<"$stamp_path")

  if [[ $content =~ \"$field\"[[:space:]]*:[[:space:]]*\"([^\"]*)\" ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
    return 0
  fi

  return 1
}

write_stamp() {
  local stamp_path=$1
  local kind=$2
  local hash=$3

  printf '{\n  "kind": "%s",\n  "hash": "%s"\n}\n' "$kind" "$hash" >"$stamp_path"
}

[[ -n "${T3CODE_PROJECT_ROOT:-}" ]] || die "T3CODE_PROJECT_ROOT is required"
[[ -n "${T3CODE_WORKTREE_PATH:-}" ]] || die "T3CODE_WORKTREE_PATH is required"
[[ -d "$T3CODE_PROJECT_ROOT" ]] || die "T3CODE_PROJECT_ROOT does not exist: $T3CODE_PROJECT_ROOT"
[[ -d "$T3CODE_WORKTREE_PATH" ]] || die "T3CODE_WORKTREE_PATH does not exist: $T3CODE_WORKTREE_PATH"

PROJECT_ROOT=$(resolve_dir "$T3CODE_PROJECT_ROOT")
WORKTREE_PATH=$(resolve_dir "$T3CODE_WORKTREE_PATH")
STAMP_PATH="$WORKTREE_PATH/$STAMP_FILE_NAME"

[[ -n "$PROJECT_ROOT" ]] || die "failed to resolve T3CODE_PROJECT_ROOT"
[[ -n "$WORKTREE_PATH" ]] || die "failed to resolve T3CODE_WORKTREE_PATH"
[[ "$PROJECT_ROOT" != "$WORKTREE_PATH" ]] || die "T3CODE_PROJECT_ROOT and T3CODE_WORKTREE_PATH must be different directories"

for env_file in "${ENV_FILES[@]}"; do
  copy_env_file "$env_file"
done

if ! detect_bootstrap "$WORKTREE_PATH"; then
  log "no bootstrap action detected"
  exit 0
fi

log "detected bootstrap: $BOOTSTRAP_KIND"

current_hash=$(hash_files "${BOOTSTRAP_FILES[@]}")
stamp_kind=$(read_stamp_field "kind" "$STAMP_PATH" || true)
stamp_hash=$(read_stamp_field "hash" "$STAMP_PATH" || true)

if [[ "$stamp_kind" == "$BOOTSTRAP_KIND" && "$stamp_hash" == "$current_hash" ]]; then
  log "skipped bootstrap (inputs unchanged)"
  exit 0
fi

require_cmd "${BOOTSTRAP_CMD[0]}"
log "running bootstrap: ${BOOTSTRAP_CMD[*]}"
(cd "$WORKTREE_PATH" && "${BOOTSTRAP_CMD[@]}")
write_stamp "$STAMP_PATH" "$BOOTSTRAP_KIND" "$current_hash"
