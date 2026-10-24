# Guia Completo de Deploy — Hostinger VPS (KVM 1, 2, 4 ou 8)

Este sistema SaaS Multi-Tenant de Precificação, Propostas e CRM Contábil foi **100% adaptado** para rodar na **Hostinger VPS** (Ubuntu 22.04 / 24.04 LTS ou Debian 12) com alta performance, banco de dados persistente, suporte a Proxy Reverso Nginx, HTTPS (Let's Encrypt) e containers Docker.

---

## O que foi adaptado no sistema para a Hostinger VPS?

1. **Detecção Automática de Ambiente (`server_api` vs `browser_pages`) em [`app.js`](../../app.js):**
   - Quando hospedado na **Hostinger VPS** (via domínio próprio, subdomínio ou IP da VPS nas portas `80`, `443`, `8080` ou `8090`), o front-end conecta-se automaticamente à API Backend Python/SQLite/PostgreSQL (`/api/*`), persistindo todos os dados no servidor e gerando links públicos reais (`/p/{token}`).
   - Quando hospedado no **GitHub Pages** (`*.github.io`), continua funcionando em modo `browser_pages` (0ms de latência com `localStorage`).
2. **Suporte a Proxy Reverso Nginx / Cloudflare em [`backend/server.py`](../../backend/server.py):**
   - Leitura real do IP do cliente via cabeçalhos `X-Forwarded-For` e `X-Real-IP` no aceite jurídico de propostas (`/p/{token}`) e nas trilhas de auditoria LGPD (`audit_logs`).
   - Endpoints de monitoramento `/api/health` e `/healthz` para verificação automática de saúde pelo Docker, Nginx, EasyPanel ou Coolify.
   - Servidor estático unificado que entrega `index.html`, `styles.css` e `app.js` diretamente com cabeçalhos de segurança (`X-Content-Type-Options: nosniff`).
3. **Kit de Infraestrutura Pronto para Produção:**
   - [`Dockerfile`](../../Dockerfile) e [`docker-compose.yml`](../../docker-compose.yml) (com volume persistente para o banco de dados SQLite).
   - [`deploy/hostinger/install_hostinger_vps.sh`](./install_hostinger_vps.sh) (instalador automatizado de 1 comando para Ubuntu/Debian).
   - [`deploy/hostinger/nginx.conf`](./nginx.conf) (configuração de Proxy Reverso + Gzip + cache de estáticos).
   - [`deploy/hostinger/saas-contabil.service`](./saas-contabil.service) (serviço `systemd` com auto-restart no boot da VPS).

---

## Opção 1: Instalação Automatizada via SSH (Recomendado — 1 Comando)

Ideal para **Hostinger VPS com Ubuntu 22.04 ou 24.04 LTS** limpa. Configura Python 3, Systemd (inicialização automática), Nginx (porta 80) e Firewall.

### Passo a Passo:
1. Acesse o painel **hPanel da Hostinger** -> **VPS** -> copie o **IP da sua VPS** e a senha `root`.
2. Conecte via terminal SSH (PowerShell no Windows ou Terminal no Mac/Linux):
   ```bash
   ssh root@SEU_IP_DA_VPS
   ```
3. Clone o seu repositório GitHub na pasta `/var/www/saas-contabil` e execute o instalador:
   ```bash
   git clone https://github.com/kenzo169p-afk/aaa.git /var/www/saas-contabil
   cd /var/www/saas-contabil
   chmod +x deploy/hostinger/install_hostinger_vps.sh
   ```
4. Execute o script informando seu domínio (ou deixe sem domínio para usar o IP da VPS):
   - **Com domínio apontado para o IP da VPS (gera SSL HTTPS grátis automático):**
     ```bash
     ./deploy/hostinger/install_hostinger_vps.sh app.seudominio.com.br seuemail@seudominio.com.br
     ```
   - **Apenas pelo IP da VPS (sem domínio):**
     ```bash
     ./deploy/hostinger/install_hostinger_vps.sh
     ```

### Comandos úteis após a instalação (Systemd):
- Ver status do sistema: `systemctl status saas-contabil`
- Ver logs em tempo real: `journalctl -u saas-contabil -f`
- Reiniciar o sistema após atualizar código (`git pull`): `systemctl restart saas-contabil`

---

## Opção 2: Deploy com Docker & Docker Compose na Hostinger VPS

Se você escolheu o template **Ubuntu com Docker** na Hostinger VPS:

1. Conecte via SSH na sua VPS:
   ```bash
   ssh root@SEU_IP_DA_VPS
   ```
2. Clone o repositório e suba o container:
   ```bash
   git clone https://github.com/kenzo169p-afk/aaa.git /var/www/saas-contabil
   cd /var/www/saas-contabil
   cp .env.example .env
   docker compose up -d --build
   ```
3. O sistema estará rodando na porta `8080` (`http://SEU_IP_DA_VPS:8080`) com banco de dados salvo no volume persistente `./database/data`.

---

## Opção 3: Deploy via EasyPanel ou Coolify na Hostinger VPS

A Hostinger oferece os templates **VPS com EasyPanel** ou **VPS com Coolify** no hPanel:

1. No painel do **EasyPanel** / **Coolify**, crie um novo serviço a partir do repositório GitHub:
   - **Repositório:** `https://github.com/kenzo169p-afk/aaa`
   - **Build Pack:** `Dockerfile` (localizado na raiz `/Dockerfile`)
   - **Porta Interna do Container:** `8080`
   - **Healthcheck Path:** `/api/health`
2. Configure um **Volume Persistente (Mount/Storage)** para não perder o banco ao atualizar:
   - **Caminho no Container:** `/app/database/data`
3. Adicione o seu domínio no menu **Domains** do EasyPanel/Coolify e ative o **HTTPS (Let's Encrypt)**.
