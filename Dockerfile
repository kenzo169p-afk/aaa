# =============================================================================
# Dockerfile Oficial — Plataforma SaaS de Precificação, Propostas e CRM Contábil
# Otimizado para Hostinger VPS (Docker Compose, EasyPanel, Coolify, Portainer)
# =============================================================================
FROM python:3.12-slim

LABEL maintainer="SaaS Contábil Multi-Tenant"
LABEL description="Plataforma SaaS de Precificação (NBC PG 01), Propostas Comerciais e CRM Contábil"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8090 \
    SAAS_DB_PATH=/app/database/saas_contabil.db

WORKDIR /app

# Instala utilitários básicos (curl para healthcheck e sqlite3 para backup)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    sqlite3 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copia todo o projeto para o container
COPY . /app

# Garante diretório persistente do banco de dados SQLite Multi-Tenant
RUN mkdir -p /app/database /app/backups

EXPOSE 8090

# Healthcheck automático para Docker / EasyPanel / Coolify na Hostinger VPS
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://127.0.0.1:${PORT}/api/health || exit 1

CMD ["python", "backend/server.py"]
