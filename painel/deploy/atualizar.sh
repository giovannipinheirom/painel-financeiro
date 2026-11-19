#!/usr/bin/env bash
# Baixa a versão nova do GitHub e reinicia o painel.  Uso: bash deploy/atualizar.sh
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
npm ci --omit=dev --no-audit --no-fund
sudo systemctl restart painel
echo "Atualizado: $(git log -1 --format='%h %s')"
