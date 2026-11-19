#!/usr/bin/env bash
# Instala o painel num servidor Ubuntu (Oracle Cloud ou qualquer VPS).
# Rode de dentro da pasta do projeto:
#   sudo bash deploy/instalar.sh painel.seudominio.com.br     (com HTTPS, recomendado)
#   sudo bash deploy/instalar.sh                              (só pelo IP, sem HTTPS, para testar)
# Pode rodar de novo quando quiser: ele não apaga dados nem troca senhas já criadas.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Rode com sudo."; exit 1; }

DOMINIO="${1:-}"
APP="$(cd "$(dirname "$0")/.." && pwd)"
USUARIO="${SUDO_USER:-ubuntu}"
ENV="$APP/.env"
echo "==> Pasta do painel: $APP (usuário $USUARIO)"

echo "==> Pacotes do sistema"
apt-get update -y
apt-get install -y curl git ca-certificates gnupg postgresql iptables-persistent debian-keyring debian-archive-keyring apt-transport-https

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "==> Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v caddy >/dev/null; then
  echo "==> Caddy (HTTPS automático)"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

echo "==> Banco Postgres"
systemctl enable --now postgresql
if [ ! -f "$ENV" ]; then
  DBPASS="$(openssl rand -hex 16)"
  ADMIN="$(openssl rand -base64 12 | tr -d '/+=')"
  sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='painel') THEN CREATE ROLE painel LOGIN PASSWORD '$DBPASS';
  ELSE ALTER ROLE painel PASSWORD '$DBPASS'; END IF;
END \$\$;
SQL
  sudo -u postgres psql -tc "select 1 from pg_database where datname='painel'" | grep -q 1 || sudo -u postgres createdb -O painel painel
  cat > "$ENV" <<CFG
DATABASE_URL=postgres://painel:$DBPASS@localhost:5432/painel
ADMIN_PASSWORD=$ADMIN
SESSION_SECRET=$(openssl rand -base64 32)
PORT=3000
CFG
  [ -z "$DOMINIO" ] && echo "COOKIE_SEGURO=0" >> "$ENV"
  chown "$USUARIO" "$ENV"; chmod 600 "$ENV"
  NOVA_SENHA="$ADMIN"
fi

echo "==> Dependências do projeto"
sudo -u "$USUARIO" bash -c "cd '$APP' && npm ci --omit=dev --no-audit --no-fund"

echo "==> Serviço (liga sozinho quando o servidor reinicia)"
cat > /etc/systemd/system/painel.service <<UNIT
[Unit]
Description=Painel financeiro
After=network.target postgresql.service

[Service]
User=$USUARIO
WorkingDirectory=$APP
ExecStart=$(command -v node) --env-file=$ENV server.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable painel
systemctl restart painel

echo "==> Caddy"
if [ -n "$DOMINIO" ]; then SITE="$DOMINIO"; else SITE=":80"; fi
cat > /etc/caddy/Caddyfile <<CADDY
$SITE {
	encode gzip
	request_body {
		max_size 20MB
	}
	reverse_proxy 127.0.0.1:3000
}
CADDY
systemctl enable caddy
systemctl reload caddy || systemctl restart caddy

echo "==> Firewall do Ubuntu (as imagens da Oracle bloqueiam 80/443 por padrão)"
for P in 80 443; do
  iptables -C INPUT -p tcp --dport $P -m state --state NEW -j ACCEPT 2>/dev/null || iptables -I INPUT 5 -p tcp --dport $P -m state --state NEW -j ACCEPT
done
netfilter-persistent save

echo
echo "Pronto!"
if [ -n "$DOMINIO" ]; then echo "Endereço: https://$DOMINIO"; else echo "Endereço: http://$(curl -s https://ifconfig.me || echo IP-DO-SERVIDOR)"; fi
[ -n "${NOVA_SENHA:-}" ] && echo "Senha do consultor: $NOVA_SENHA   (anote; fica em $ENV)"
echo "Lembre de liberar as portas 80 e 443 na Security List da VCN no painel da Oracle."
