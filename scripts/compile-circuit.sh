#!/usr/bin/env bash
# Compile the Noir circuit to a real `prove_credential.json` artifact.
# Designed to run inside WSL where MSYS-Windows can't host nargo natively.
# Idempotent: installs noirup if missing, then compiles.

set -euo pipefail

# Reset PATH to known-good linux dirs so any inherited Windows paths
# (with spaces and parens) don't break later commands.
PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export PATH

NARGO_BIN="$HOME/.nargo/bin/nargo"
NOIR_VERSION="1.0.0-beta.20"

# Always ensure noirup is installed and the right Noir version is active —
# pre-existing 0.x installations are incompatible with the >=1.0.0-beta.20
# project requirement.
if ! command -v noirup >/dev/null 2>&1 && [ ! -x "$HOME/.nargo/bin/noirup" ]; then
  echo "==> Installing noirup..."
  curl -sSL https://raw.githubusercontent.com/noir-lang/noirup/main/install -o /tmp/noirup-install.sh
  bash /tmp/noirup-install.sh
fi
export PATH="$HOME/.nargo/bin:$PATH"

# Pin nargo to project version (idempotent — noirup re-downloads only if needed).
echo "==> Ensuring nargo $NOIR_VERSION via noirup..."
noirup -v "$NOIR_VERSION"

nargo --version

CIRCUIT_DIR="/mnt/c/Users/danie/zk-hires/circuit"
echo "==> nargo compile in $CIRCUIT_DIR"
cd "$CIRCUIT_DIR"
nargo compile

echo "==> Done. Artifact:"
ls -la target/prove_credential.json
echo "==> Bytecode size (chars):"
python3 -c "import json; d = json.load(open('target/prove_credential.json')); print('bytecode_chars:', len(d.get('bytecode', ''))); print('parameters:', len(d.get('abi', {}).get('parameters', [])))"
