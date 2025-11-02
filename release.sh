#!/usr/bin/env bash
set -euo pipefail

# release.sh
# Create a zip for the current git tag and create/update a GitHub release with the zip as an asset.
# Behavior:
# - Must be run from repo root.
# - Detects tag for HEAD. If not run on a tag, it fails.
# - If `gh` is available it uses it. Otherwise it requires GITHUB_TOKEN env var and uses the GitHub API.

usage() {
  echo "Usage: $0 [--notes NOTES] [--name NAME]"
  echo "Environment variables: GITHUB_TOKEN (required if 'gh' is not installed)"
  exit 2
}

NOTES="Release created by release.sh"
RELEASE_NAME=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --notes)
      NOTES="$2"; shift 2 ;;
    --name)
      RELEASE_NAME="$2"; shift 2 ;;
    -h|--help)
      usage ;;
    *)
      echo "Unknown arg: $1"; usage ;;
  esac
done

# ensure we're in a git repo
if ! git rev-parse --git-dir > /dev/null 2>&1; then
  echo "Not a git repository (run from repo root)."
  exit 1
fi

# find a tag for HEAD
TAG=""
if TAG=$(git describe --tags --exact-match 2>/dev/null || true); then
  :
fi
if [ -z "$TAG" ]; then
  # try tags pointing at HEAD
  TAG=$(git tag --points-at HEAD | head -n1 || true)
fi

if [ -z "$TAG" ]; then
  echo "No tag found for HEAD. Create and push a tag and try again."
  exit 1
fi

echo "Detected tag: $TAG"

# compute repo owner/name from origin URL
REMOTE_URL=$(git remote get-url origin 2>/dev/null || true)
if [ -z "$REMOTE_URL" ]; then
  echo "Cannot determine remote origin URL. Set REMOTE_URL env var to owner/repo or configure 'origin'."
  exit 1
fi

parse_owner_repo() {
  local url="$1"
  # support git@github.com:owner/repo.git and https://github.com/owner/repo.git
  if [[ "$url" =~ git@([^:]+):([^/]+)/(.+) ]]; then
    owner=${BASH_REMATCH[2]}
    repo=${BASH_REMATCH[3]}
  elif [[ "$url" =~ https?://([^/]+)/([^/]+)/(.+) ]]; then
    owner=${BASH_REMATCH[2]}
    repo=${BASH_REMATCH[3]}
  else
    # fallback: expect owner/repo
    owner_repo=$(basename -s .git "$url")
    owner=$(echo "$owner_repo" | cut -d'/' -f1)
    repo=$(echo "$owner_repo" | cut -d'/' -f2)
  fi
  repo=$(basename -s .git "$repo")
  echo "$owner" "$repo"
}

read OWNER REPO < <(parse_owner_repo "$REMOTE_URL")

if [ -z "$OWNER" ] || [ -z "$REPO" ]; then
  echo "Failed to parse owner/repo from origin URL: $REMOTE_URL"
  exit 1
fi

ARCHIVE_NAME="${REPO}-${TAG}.zip"

echo "Creating zip archive: $ARCHIVE_NAME"
# Use git archive for a clean archive matching the tag
if git rev-parse --verify "$TAG" >/dev/null 2>&1; then
  git archive --format=zip --output="$ARCHIVE_NAME" "$TAG"
else
  # fallback: zip entire working tree excluding .git
  if command -v zip >/dev/null 2>&1; then
    zip -r "$ARCHIVE_NAME" . -x ".git/*"
  else
    echo "Neither git archive nor zip are available. Cannot create archive."
    exit 1
  fi
fi

echo "Archive ready: $ARCHIVE_NAME"

create_release_with_gh() {
  echo "Using gh CLI to create release"
  if [ -z "$RELEASE_NAME" ]; then
    gh release create "$TAG" "$ARCHIVE_NAME" --title "$TAG" --notes "$NOTES"
  else
    gh release create "$TAG" "$ARCHIVE_NAME" --title "$RELEASE_NAME" --notes "$NOTES"
  fi
}

create_release_with_api() {
  if [ -z "${GITHUB_TOKEN:-}" ]; then
    echo "GITHUB_TOKEN is required when 'gh' is not installed."
    exit 1
  fi

  echo "Creating release via GitHub API"
  data=$(printf '{"tag_name":"%s","name":"%s","body":"%s","draft":false,"prerelease":false}' "$TAG" "${RELEASE_NAME:-$TAG}" "$NOTES")
  resp=$(curl -s -X POST -H "Authorization: token $GITHUB_TOKEN" -H "Accept: application/vnd.github.v3+json" \
    https://api.github.com/repos/$OWNER/$REPO/releases -d "$data")

  upload_url=$(echo "$resp" | tr -d '\r' | grep -o '"upload_url": *"[^"]*"' | head -n1 | sed -E 's/"upload_url": *"([^"]+)"/\1/')
  if [ -z "$upload_url" ]; then
    echo "Failed to create release. Response:" >&2
    echo "$resp" >&2
    exit 1
  fi

  # upload_url contains the template {?name,label} - strip the template
  upload_url=${upload_url/%\{?name,label\}/}

  echo "Uploading asset to release"
  curl --silent --show-error -X POST -H "Authorization: token $GITHUB_TOKEN" -H "Content-Type: application/zip" \
    --data-binary @"$ARCHIVE_NAME" "$upload_url?name=$(basename "$ARCHIVE_NAME")"

  echo "Uploaded $ARCHIVE_NAME"
}

if command -v gh >/dev/null 2>&1; then
  create_release_with_gh
else
  create_release_with_api
fi

echo "Release process finished."
