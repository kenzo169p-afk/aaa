#!/usr/bin/env bash
# =============================================================================
# INSTALADOR AUTOMÁTICO PARA HOSTINGER VPS (Ubuntu 22.04 / 24.04 / Debian 12)
# Configura: Python3 + Systemd + Nginx Reverse Proxy + SSL Let's Encrypt + Backup Diário
# Uso na VPS:
#   sudo bash deploy/hostinger/install_hostinger_vps.sh [SEU_DOMINIO_OPCIONAL] [SEU_EMAIL_OPCIONAL]
# Exemplo com domínio:
#   sudo bash deploy/hostinger/install_hostinger_vps.sh app.suaempresa.com.br contato@suaempresa.com.br
# Exemplo apenas por IP da VPS:
#   sudo bash deploy/hostinger/install_hostinger_vps.sh
# =============================================================================
set -euo pipefail

DOMAIN="${1:-_}"
SSL_EMAIL="${2:-}"
APP_DIR="/opt/saas-contabil"
DATA_DIR="/var/lib/saas-contabil"
BACKUP_DIR="/var/backups/saas-contabil"
SERVICE_PORT="8090"

echo "======================================================================="
echo " 🚀 Iniciando Instalação na Hostinger VPS — SaaS Contábil Multi-Tenant"
echo "======================================================================="

if [ "$EUID" -ne 0 ]; then
  echo "❌ Por favor, execute este script como root (ou com sudo):"
  echo "   sudo bash deploy/hostinger/install_hostinger_vps.sh"
  exit 1
fi

echo "📦 [1/6] Atualizando pacotes e instalando dependências (Python3, Nginx, SQLite3, Certbot)..."
apt-get update -y
apt-get install -y python3 nginx sqlite3 curl rsync ufw certbot python3-certbot-nginx

echo "📁 [2/6] Preparando diretórios da aplicação e banco de dados persistente..."
mkdir -p "$APP_DIR" "$DATA_DIR" "$BACKUP_DIR"

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
rsync -a --exclude '.git' --exclude 'database/*.db' "$SRC_DIR/" "$APP_DIR/"

# Se já existir um banco inicial e o diretório persistente estiver vazio, copia o seed
if [ ! -f "$DATA_DIR/saas_contabil.db" ] && [ -f "$SRC_DIR/database/saas_contabil.db" ]; then
  cp "$SRC_DIR/database/saas_contabil.db" "$DATA_DIR/saas_contabil.db"
fi

if [ ! -f "$APP_DIR/.env" ]; then
  RAND_SECRET="$(head -c 32 /dev/urandom | sha256sum | cut -d' ' -f1)"
  cat > "$APP_DIR/.env" <<EOF
PORT=${SERVICE_PORT}
SAAS_DB_PATH=${DATA_DIR}/saas_contabil.db
SAAS_JWT_SECRET=${RAND_SECRET}
APP_DOMAIN=${DOMAIN}
EOF
fi

chown -R www-data:www-data "$APP_DIR" "$DATA_DIR" "$BACKUP_DIR"
chmod 600 "$APP_DIR/.env"

echo "⚙️ [3/6] Configurando serviço Systemd (saas-contabil.service)..."
cp "$APP_DIR/deploy/hostinger/saas-contabil.service" /etc/systemd/system/saas-contabil.service
systemctl daemon-reload
systemctl enable saas-contabil
systemctl restart saas-contabil

echo "🌐 [4/6] Configurando Proxy Reverso Nginx na porta 80..."
cat > /etc/nginx/sites-available/saas-contabil <<EOF
server {
    listen 80;
    server_name ${DOMAIN};

    client_max_body_size 20M;

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/javascript application/javascript application/json image/svg+xml;

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    location / {
        proxy_pass http://127.0.0.1:${SERVICE_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }
}
EOF

ln -sf /etc/nginx/sites-available/saas-contabil /etc/nginx/sites-enabled/saas-contabil
if [ "$DOMAIN" = "_" ] && [ -f /etc/nginx/sites-enabled/default ]; then
  rm -f /etc/nginx/sites-enabled/default
fi

nginx -t
systemctl reload nginx

echo "🛡️ [5/6] Configurando Firewall UFW e Rotina de Backup Diário do SQLite..."
ufw allow OpenSSH >/dev/null 2>&1 || true
ufw allow 'Nginx Full' >/dev/null 2>&1 || true

cat > /etc/cron.daily/saas-contabil-backup <<EOF
#!/usr/bin/env bash
STAMP=\$(date +%Y%m%d_%H%M%S)
if [ -f "${DATA_DIR}/saas_contabil.db" ]; then
  sqlite3 "${DATA_DIR}/saas_contabil.db" ".backup '${BACKUP_DIR}/saas_contabil_\${STAMP}.db'"
  find "${BACKUP_DIR}" -name "saas_contabil_*.db" -mtime +14 -delete
fi
EOF
chmod +x /etc/cron.daily/saas-contabil-backup

if [ "$DOMAIN" != "_" ] && [ -n "$SSL_EMAIL" ]; then
  echo "🔒 [6/6] Emitindo Certificado SSL Gratuito (Let's Encrypt HTTPS) para ${DOMAIN}..."
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$SSL_EMAIL" --redirect || true
else
  echo "ℹ️ [6/6] SSL opcional: para ativar HTTPS depois com domínio próprio, execute:"
  echo "   sudo certbot --nginx -d seu-dominio.com.br"
fi

VPS_IP="$(hostname -I | awk '{print $1}')"
echo "======================================================================="
echo " ✅ INSTALAÇÃO CONCLUÍDA COM SUCESSO NA HOSTINGER VPS!"
echo "-----------------------------------------------------------------------"
echo " 🔗 Acesso por IP:      http://${VPS_IP}"
if [ "$DOMAIN" != "_" ]; then
  echo " 🔗 Acesso por Domínio: https://${DOMAIN}"
fi
echo " 🩺 Healthcheck API:    http://127.0.0.1:${SERVICE_PORT}/api/health"
echo " 💾 Banco de Dados:     ${DATA_DIR}/saas_contabil.db"
echo " 📦 Backups Diários:    ${BACKUP_DIR}/"
echo " 🛠️ Comandos úteis:"
echo "    sudo systemctl status saas-contabil"
echo "    sudo journalctl -u saas-contabil -f"
echo "======================================================================="
