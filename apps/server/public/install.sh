#!/bin/sh
# CodeCash CLI installer.  Usage:
#   curl -fsSL https://codecash.sh/install.sh | sh
#
# Installs the open-source CodeCash client into ~/.codecash-cli and puts
# `codecash` + `codecash-advertiser` on your PATH (~/.local/bin). No sudo.
set -e

REPO="https://github.com/stakksoftware/codecash"
DIR="${CODECASH_DIR:-$HOME/.codecash-cli}"
SERVER="${CODECASH_SERVER:-https://codecash.sh}"
BIN="$HOME/.local/bin"

printf '\n  \033[1;32mCodeCash\033[0m — get paid for the time you wait.\n\n'

command -v git  >/dev/null 2>&1 || { echo "  git is required."; exit 1; }
command -v node >/dev/null 2>&1 || { echo "  Node.js >= 20 is required (https://nodejs.org)."; exit 1; }

if [ -d "$DIR/.git" ]; then
  printf '  Updating %s ...\n' "$DIR"
  git -C "$DIR" pull --ff-only --quiet
else
  printf '  Cloning into %s ...\n' "$DIR"
  git clone --depth 1 --quiet "$REPO" "$DIR"
fi

printf '  Installing dependencies ...\n'
( cd "$DIR" && npm install --silent --no-audit --no-fund >/dev/null 2>&1 )

mkdir -p "$BIN"
for cmd in codecash codecash-advertiser; do
  cat > "$BIN/$cmd" <<EOF
#!/bin/sh
exec node "$DIR/apps/cli/bin/$cmd.js" "\$@"
EOF
  chmod +x "$BIN/$cmd"
done

printf '\n  \033[1;32m✓ Installed.\033[0m\n\n'
case ":$PATH:" in
  *":$BIN:"*) : ;;
  *) printf '  Add this to your shell profile:\n      export PATH="$HOME/.local/bin:$PATH"\n\n' ;;
esac
printf '  Get started:\n'
printf '      export CODECASH_SERVER=%s\n' "$SERVER"
printf '      codecash login --email you@dev.com\n'
printf '      codecash install        # plug into your agent CLI status line\n'
printf '      codecash sync && codecash status\n\n'
printf '  Dashboard:  %s/dashboard\n\n' "$SERVER"
