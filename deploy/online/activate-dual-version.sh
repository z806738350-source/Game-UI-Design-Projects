#!/bin/sh
set -eu

release_id=${1:?release id is required}
install_root=/opt/game-ui-design-copilot-online
release_dir="$install_root/releases/$release_id"
classic_release="$install_root/releases/20260812-113232-f9dc444"
unit=/etc/systemd/system/game-ui-design-copilot-online.service
backup=/etc/game-ui-design-copilot-online/game-ui-design-copilot-online.single-version.service
unit_tmp=$(mktemp /etc/game-ui-design-copilot-online/.router-unit.XXXXXX)
active_unit_backup=$(mktemp /etc/game-ui-design-copilot-online/.active-unit.XXXXXX)
link_tmp="$install_root/.current-$release_id"
previous_current=$(readlink -f "$install_root/current")
activation_complete=0

case "$release_id" in
  *[!0-9A-Za-z._-]*|'') echo 'invalid release id' >&2; exit 2 ;;
esac
test -d "$release_dir"
test -d "$classic_release"
test -d "$previous_current"
test -f "$release_dir/deploy/online/game-ui-design-copilot-online.service"
curl --retry 3 --retry-delay 1 --retry-connrefused --max-time 10 -fsS http://127.0.0.1:9031/healthz >/dev/null
curl --retry 3 --retry-delay 1 --retry-connrefused --max-time 10 -fsS http://127.0.0.1:9032/healthz >/dev/null

if test ! -f "$backup"; then install -o root -g root -m 0644 "$unit" "$backup"; fi
install -o root -g root -m 0644 "$unit" "$active_unit_backup"
sed "s|@@CURRENT_RELEASE_DIR@@|$release_dir|g" "$release_dir/deploy/online/game-ui-design-copilot-online.service" > "$unit_tmp"

rollback() {
  result=$?
  trap - EXIT HUP INT TERM
  if test "$activation_complete" -eq 0; then
    install -o root -g root -m 0644 "$active_unit_backup" "$unit"
    rollback_link="$install_root/.current-rollback"
    rm -f "$rollback_link"
    ln -s "$previous_current" "$rollback_link"
    mv -Tf "$rollback_link" "$install_root/current"
    systemctl daemon-reload
    systemctl restart game-ui-design-copilot-online.service || true
    echo 'activation failed; restored previous online service' >&2
  fi
  rm -f "$unit_tmp" "$active_unit_backup" "$link_tmp"
  exit "$result"
}
trap rollback EXIT
trap 'exit 1' HUP INT TERM

install -o root -g root -m 0644 "$unit_tmp" "$unit"
rm -f "$unit_tmp"
rm -f "$link_tmp"
ln -s "$release_dir" "$link_tmp"
mv -Tf "$link_tmp" "$install_root/current"
systemctl daemon-reload
systemctl restart game-ui-design-copilot-online.service
curl --retry 10 --retry-delay 1 --retry-connrefused --max-time 15 -fsS http://127.0.0.1:9030/__versions/status | grep -q '"classic":{"available":true'
curl --retry 10 --retry-delay 1 --retry-connrefused --max-time 15 -fsS http://127.0.0.1:9030/__versions/status | grep -q '"current":{"available":true'
systemctl enable game-ui-design-copilot-classic.service game-ui-design-copilot-current.service >/dev/null
activation_complete=1
printf 'activated release=%s router=9030 classic=9031 current=9032\n' "$release_id"
