#!/bin/sh
set -eu

release_id=${1:?release id is required}
archive=${2:?release archive path is required}
install_root=/opt/game-ui-design-copilot-online
release_dir="$install_root/releases/$release_id"
classic_release="$install_root/releases/20260812-113232-f9dc444"
config_root=/etc/game-ui-design-copilot-online
data_root=/var/lib/game-ui-design-copilot-online
log_root=/var/log/game-ui-design-copilot-online
service_user=game-ui-design-copilot
service_group=game-ui-design-copilot
base_env="$config_root/game-ui-design-copilot-online.env"
current_env="$config_root/game-ui-design-copilot-current.env"
router_env="$config_root/version-router.env"
current_unit=/etc/systemd/system/game-ui-design-copilot-current.service

case "$release_id" in
  *[!0-9A-Za-z._-]*|'') echo 'invalid release id' >&2; exit 2 ;;
esac
test -f "$archive"
test -d "$classic_release"
test -f "$base_env"
test ! -e "$release_dir"

if ss -H -ltn 'sport = :9031' | grep -q .; then
  curl --max-time 5 -fsS http://127.0.0.1:9031/healthz >/dev/null || { echo 'port 9031 is occupied by an unhealthy service' >&2; exit 3; }
fi
if ss -H -ltn 'sport = :9032' | grep -q .; then
  curl --max-time 5 -fsS http://127.0.0.1:9032/healthz >/dev/null || { echo 'port 9032 is occupied by an unhealthy service' >&2; exit 3; }
fi

install -d -o root -g root -m 0755 "$release_dir"
tar -xzf "$archive" -C "$release_dir"
(cd "$release_dir" && sha256sum -c MANIFEST.sha256)
(cd "$release_dir" && env PATH=/opt/game-ui-design-copilot-online/runtime/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin /opt/game-ui-design-copilot-online/runtime/node/bin/corepack pnpm install --prod --frozen-lockfile)
# 候选 release 预检必须证明 ADR-010 的缓解真的随包生效：只 require('sharp') 无法发现
# sharpRuntime.cjs 缺失或其中 sharp.block 调用被移除的候选。GIF 解码被拒绝即缓解生效。
(cd "$release_dir" && /opt/game-ui-design-copilot-online/runtime/node/bin/node -e '
const sharp = require("./electron/services/sharpRuntime.cjs");
const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
sharp(gif).metadata().then(
  () => { console.error("sharp-mitigation-ineffective: GIF decoded"); process.exit(1); },
  () => console.log("sharp-runtime-ok sharp=" + sharp.versions.sharp + " libvips=" + sharp.versions.vips),
);
')
chown -R root:root "$release_dir"

install -d -o "$service_user" -g "$service_group" -m 0700 "$data_root/version-data/v2"
install -d -o "$service_user" -g "$service_group" -m 0750 "$log_root"

current_tmp=$(mktemp "$config_root/.current-env.XXXXXX")
router_tmp=$(mktemp "$config_root/.router-env.XXXXXX")
classic_unit_tmp=$(mktemp "$config_root/.classic-unit.XXXXXX")
current_unit_tmp=$(mktemp "$config_root/.current-unit.XXXXXX")
current_env_backup=$(mktemp "$config_root/.current-env-backup.XXXXXX")
current_unit_backup=$(mktemp "$config_root/.current-unit-backup.XXXXXX")
classic_unit=/etc/systemd/system/game-ui-design-copilot-classic.service
classic_unit_backup=$(mktemp "$config_root/.classic-unit-backup.XXXXXX")
candidate_ready=0
current_reconfigured=0

if test -f "$current_env"; then install -o root -g root -m 0600 "$current_env" "$current_env_backup"; else rm -f "$current_env_backup"; fi
if test -f "$current_unit"; then install -o root -g root -m 0644 "$current_unit" "$current_unit_backup"; else rm -f "$current_unit_backup"; fi
if test -f "$classic_unit"; then install -o root -g root -m 0644 "$classic_unit" "$classic_unit_backup"; else rm -f "$classic_unit_backup"; fi

cleanup() {
  result=$?
  trap - EXIT HUP INT TERM
  if test "$candidate_ready" -eq 0 && test "$current_reconfigured" -eq 1; then
    if test -f "$current_env_backup"; then install -o root -g root -m 0600 "$current_env_backup" "$current_env"; else rm -f "$current_env"; fi
    if test -f "$current_unit_backup"; then install -o root -g root -m 0644 "$current_unit_backup" "$current_unit"; else rm -f "$current_unit"; fi
    if test -f "$classic_unit_backup"; then install -o root -g root -m 0644 "$classic_unit_backup" "$classic_unit"; else rm -f "$classic_unit"; fi
    systemctl daemon-reload
    systemctl restart game-ui-design-copilot-current.service || true
    systemctl restart game-ui-design-copilot-classic.service || true
    echo 'candidate preparation failed; restored previous current and classic services' >&2
  fi
  rm -f "$current_tmp" "$router_tmp" "$classic_unit_tmp" "$current_unit_tmp" "$current_env_backup" "$current_unit_backup" "$classic_unit_backup"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

if test -f "$current_env"; then
  awk -F= '!($1 ~ /^(NODE_ENV|HOST|PORT|PUBLIC_URL|DESIGN_COPILOT_DATA_ROOT|DESIGN_COPILOT_DIST_ROOT|FEISHU_REDIRECT_URI|SESSION_COOKIE_NAME|OAUTH_COOKIE_NAME|DESIGN_COPILOT_RELEASE_ID|DESIGN_COPILOT_VERSION_LABEL)$/)' "$current_env" > "$current_tmp"
else
  awk -F= '!($1 ~ /^(NODE_ENV|HOST|PORT|PUBLIC_URL|DESIGN_COPILOT_DATA_ROOT|DESIGN_COPILOT_DIST_ROOT|FEISHU_REDIRECT_URI|SESSION_SECRET|SESSION_COOKIE_NAME|OAUTH_COOKIE_NAME|DESIGN_COPILOT_RELEASE_ID|DESIGN_COPILOT_VERSION_LABEL)$/)' "$base_env" > "$current_tmp"
  printf 'SESSION_SECRET=%s\n' "$(openssl rand -hex 48)" >> "$current_tmp"
fi
{
  printf '%s\n' 'NODE_ENV=production'
  printf '%s\n' 'HOST=127.0.0.1'
  printf '%s\n' 'PORT=9032'
  printf '%s\n' 'PUBLIC_URL=http://10.8.0.176:9030'
  printf '%s\n' "DESIGN_COPILOT_DATA_ROOT=$data_root/version-data/v2"
  printf '%s\n' "DESIGN_COPILOT_DIST_ROOT=$release_dir/dist"
  printf '%s\n' 'FEISHU_REDIRECT_URI=http://10.8.0.176:9030/auth/feishu/callback'
  printf '%s\n' 'SESSION_COOKIE_NAME=design_copilot_current_session'
  printf '%s\n' 'OAUTH_COOKIE_NAME=design_copilot_current_oauth'
  printf '%s\n' "DESIGN_COPILOT_RELEASE_ID=$release_id"
  printf '%s\n' 'DESIGN_COPILOT_VERSION_LABEL=新版'
} >> "$current_tmp"
install -o root -g root -m 0600 "$current_tmp" "$current_env"

{
  printf '%s\n' 'ROUTER_HOST=0.0.0.0'
  printf '%s\n' 'ROUTER_PORT=9030'
  printf '%s\n' 'ROUTER_PUBLIC_URL=http://10.8.0.176:9030'
  printf '%s\n' 'ROUTER_DEFAULT_VERSION=classic'
  printf '%s\n' 'ROUTER_CLASSIC_UPSTREAM=http://127.0.0.1:9031'
  printf '%s\n' 'ROUTER_CURRENT_UPSTREAM=http://127.0.0.1:9032'
  printf '%s\n' 'ROUTER_VERSION_COOKIE_NAME=design_copilot_version'
  printf '%s\n' 'ROUTER_CLASSIC_SESSION_COOKIE_NAME=design_copilot_session'
  printf '%s\n' 'ROUTER_MAX_HTML_BYTES=1048576'
  printf '%s\n' 'ROUTER_UPSTREAM_TIMEOUT_MS=1320000'
  printf '%s\n' 'ROUTER_HEALTH_TIMEOUT_MS=2000'
} > "$router_tmp"
install -o root -g root -m 0600 "$router_tmp" "$router_env"

sed "s|@@CLASSIC_RELEASE_DIR@@|$classic_release|g" "$release_dir/deploy/online/game-ui-design-copilot-classic.service" > "$classic_unit_tmp"
sed "s|@@CURRENT_RELEASE_DIR@@|$release_dir|g" "$release_dir/deploy/online/game-ui-design-copilot-current.service" > "$current_unit_tmp"
# systemctl start 对已在运行的经典版是空操作：改过的 unit 不会进入运行中的进程。
# 只有 unit 内容真的变了才 restart，避免每次预检都无谓打断经典版会话。
classic_unit_changed=1
if test -f "$classic_unit" && cmp -s "$classic_unit_tmp" "$classic_unit"; then classic_unit_changed=0; fi
install -o root -g root -m 0644 "$classic_unit_tmp" "$classic_unit"
install -o root -g root -m 0644 "$current_unit_tmp" "$current_unit"
current_reconfigured=1

systemctl daemon-reload
if test "$classic_unit_changed" -eq 1; then
  systemctl restart game-ui-design-copilot-classic.service
else
  systemctl start game-ui-design-copilot-classic.service
fi
systemctl restart game-ui-design-copilot-current.service
curl --retry 10 --retry-delay 1 --retry-connrefused --max-time 10 -fsS http://127.0.0.1:9031/healthz >/dev/null
curl --retry 10 --retry-delay 1 --retry-connrefused --max-time 10 -fsS http://127.0.0.1:9032/healthz >/dev/null
# 只从进程环境里取 DIST_ROOT 这一个键。经典版的前端必须来自它自己钉住的 release，
# 不能随 current 漂移（2026-09-02 线上实际发生过，回归见 scripts/deployUnits.test.cjs）。
classic_pid=$(systemctl show -p MainPID --value game-ui-design-copilot-classic.service)
if test -z "$classic_pid" || test "$classic_pid" = 0; then
  echo 'classic service has no main pid' >&2
  exit 4
fi
classic_dist_root=$(tr '\0' '\n' < "/proc/$classic_pid/environ" | sed -n 's|^DESIGN_COPILOT_DIST_ROOT=||p')
if test "$classic_dist_root" != "$classic_release/dist"; then
  echo "classic-dist-root-drifted: ${classic_dist_root:-<unset>}" >&2
  exit 4
fi
candidate_ready=1
printf 'candidate-ready release=%s classic=9031 current=9032 classic-dist-root=%s\n' "$release_id" "$classic_dist_root"
