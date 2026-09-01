#!/bin/sh
set -eu

release_id=${1:?release id is required}
output_dir=${2:?output directory is required}
git_commit=${3:?git commit is required}
repo_root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
stage="$output_dir/$release_id"
archive="$output_dir/$release_id.tar.gz"

case "$release_id" in
  *[!0-9A-Za-z._-]*|'') echo 'invalid release id' >&2; exit 2 ;;
esac
test ! -e "$stage"
test ! -e "$archive"

install -d "$stage/dist" "$stage/electron/services" "$stage/server" "$stage/deploy/online"
cp -R "$repo_root/dist/." "$stage/dist/"
find "$repo_root/electron/services" -maxdepth 1 -type f -name '*.cjs' ! -name '*.test.cjs' -exec cp {} "$stage/electron/services/" \;
find "$repo_root/server" -maxdepth 1 -type f -name '*.cjs' ! -name '*.test.cjs' -exec cp {} "$stage/server/" \;
cp "$repo_root/package.json" "$stage/package.json"
cp "$repo_root/pnpm-lock.yaml" "$stage/pnpm-lock.yaml"
cp "$repo_root/pnpm-workspace.yaml" "$stage/pnpm-workspace.yaml"
cp "$repo_root/deploy/online/"*.service "$repo_root/deploy/online/"*.sh "$stage/deploy/online/"
chmod 0755 "$stage/deploy/online/"*.sh

cat > "$stage/RELEASE.json" <<EOF
{
  "schema_version": "1.0",
  "release_id": "$release_id",
  "git_commit": "$git_commit",
  "git_dirty": true,
  "built_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "entrypoints": {
    "router": "server/versionRouter.cjs",
    "current": "server/webServer.cjs",
    "classic_release": "20260812-113232-f9dc444"
  },
  "runtime": "Node.js 22 LTS (existing project-local runtime)",
  "public_url": "http://10.8.0.176:9030",
  "data_policy": "classic and current use independent data roots",
  "baseline_release": "20260812-113232-f9dc444"
}
EOF

(cd "$stage" && find . -type f ! -name MANIFEST.sha256 -print0 | sort -z | xargs -0 shasum -a 256 > MANIFEST.sha256)
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$archive" -C "$stage" .
printf '%s\n' "$archive"
