#!/bin/sh

set -eu

repo_root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
dist_dir="${repo_root}/dist"
stage_dir=$(mktemp -d "${TMPDIR:-/tmp}/tryfox-companion-extension.XXXXXX")

cleanup() {
  rm -rf "$stage_dir"
}

trap cleanup EXIT INT TERM

version=${TRYFOX_EXTENSION_VERSION:-$(node -e 'const fs = require("node:fs"); const path = require("node:path"); const manifest = JSON.parse(fs.readFileSync(path.join(process.argv[1], "manifest.json"), "utf8")); process.stdout.write(manifest.version);' "$repo_root")}

artifact_name="tryfox-companion-extension-${version}.xpi"
latest_artifact_name="tryfox-companion-extension.xpi"

mkdir -p "$dist_dir"
rm -f "${dist_dir}/${artifact_name}" "${dist_dir}/${latest_artifact_name}"

cp "${repo_root}/manifest.json" "$stage_dir/"
cp -R "${repo_root}/popup" "$stage_dir/"
cp -R "${repo_root}/settings" "$stage_dir/"
cp -R "${repo_root}/icons" "$stage_dir/"
cp "${repo_root}/LICENSE" "$stage_dir/"
cp "${repo_root}/README.md" "$stage_dir/"

(
  cd "$stage_dir"
  zip -qr "${dist_dir}/${artifact_name}" .
)

cp "${dist_dir}/${artifact_name}" "${dist_dir}/${latest_artifact_name}"

printf 'Built %s\n' "${dist_dir}/${artifact_name}"
printf 'Updated %s\n' "${dist_dir}/${latest_artifact_name}"
