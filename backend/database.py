"""
Camada de Banco de Dados Multi-Tenant (SQLite3 + Conector Supabase PostgreSQL)
Garante isolamento estrito por tenant_id, controle de acesso RBAC, versionamento e auditoria LGPD.
"""

import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
import urllib.request
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from backend.pricing_engine import (
    DEFAULT_ACCESSORIES,
    DEFAULT_ACTIVITIES,
    DEFAULT_AVULSOS,
    DEFAULT_COMPLEXITY_LEVELS,
    DEFAULT_DEPARTMENTS,
    DEFAULT_INVOICE_BRACKETS,
    DEFAULT_REGIMES,
    DEFAULT_REVENUE_BRACKETS,
    calculate_honorarios,
)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_DIR = os.path.join(BASE_DIR, "database")
DB_PATH = os.environ.get("SAAS_DB_PATH", os.path.join(DB_DIR, "saas_contabil.db"))
MIGRATION_SQLITE_PATH = os.path.join(DB_DIR, "migrations", "001_initial_schema_sqlite.sql")
SECRET_KEY = os.environ.get("SAAS_JWT_SECRET", "saas-contabil-multi-tenant-secret-key-2026")


def get_connection(db_path: Optional[str] = None) -> sqlite3.Connection:
    target_path = db_path or DB_PATH
    os.makedirs(os.path.dirname(target_path), exist_ok=True)
    conn = sqlite3.connect(target_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")
    return conn


def hash_password(password: str, salt: Optional[str] = None) -> str:
    salt_val = salt or secrets.token_hex(8)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt_val.encode("utf-8"), 100_000)
    return f"{salt_val}${dk.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    if "$" not in stored_hash:
        return False
    salt_val, _ = stored_hash.split("$", 1)
    return hmac.compare_digest(hash_password(password, salt_val), stored_hash)


def create_auth_token(user: Dict[str, Any]) -> str:
    payload = {
        "sub": user["id"],
        "tenant_id": user["tenant_id"],
        "email": user["email"],
        "name": user["name"],
        "role": user["role"],
        "max_discount_pct": float(user.get("max_discount_pct", 10.0)),
        "exp": int(time.time()) + 86400 * 7,
    }
    raw_json = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    b64_payload = base64.urlsafe_b64encode(raw_json).decode("utf-8").rstrip("=")
    sig = hmac.new(SECRET_KEY.encode("utf-8"), b64_payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{b64_payload}.{sig}"


def verify_auth_token(token: str) -> Optional[Dict[str, Any]]:
    if not token or "." not in token:
        return None
    try:
        b64_payload, sig = token.split(".", 1)
        expected_sig = hmac.new(SECRET_KEY.encode("utf-8"), b64_payload.encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected_sig):
            return None
        padding = "=" * (-len(b64_payload) % 4)
        payload = json.loads(base64.urlsafe_b64decode(b64_payload + padding).decode("utf-8"))
        if payload.get("exp", 0) < int(time.time()):
            return None
        return payload
    except Exception:
        return None


def log_audit(
    conn: sqlite3.Connection,
    tenant_id: str,
    user_id: Optional[str],
    action: str,
    entity_type: str,
    entity_id: Optional[str] = None,
    details: Optional[Dict[str, Any]] = None,
    ip_address: str = "127.0.0.1",
) -> None:
    audit_id = f"aud_{secrets.token_hex(8)}"
    conn.execute(
        """
        INSERT INTO audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, details_json, ip_address)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            audit_id,
            tenant_id,
            user_id,
            action,
            entity_type,
            entity_id,
            json.dumps(details or {}, ensure_ascii=False),
            ip_address,
        ),
    )


def init_db(db_path: Optional[str] = None) -> None:
    conn = get_connection(db_path)
    try:
        with open(MIGRATION_SQLITE_PATH, "r", encoding="utf-8") as f:
            schema_sql = f.read()
        conn.executescript(schema_sql)
        conn.commit()

        cur = conn.execute("SELECT COUNT(*) AS c FROM tenants")
        if cur.fetchone()["c"] == 0:
            _seed_initial_tenants(conn)
            conn.commit()
    finally:
        conn.close()


def seed_tenant_defaults(
    conn: sqlite3.Connection,
    tenant_id: str,
    tenant_name: str,
    trade_name: str,
    cnpj: str,
    crc: str,
    email: str,
    phone: str,
    city: str,
    state: str,
    primary_color: str = "#C9A227",
    fixed_cost: float = 28000.0,
    productive_hours: float = 320.0,
    target_margin: float = 30.0,
) -> Dict[str, Any]:
    """
    Cria a estrutura completa de um escritório contábil (tenant):
    - Parâmetros v1
    - Etapas do Pipeline (1 a 8)
    - Motivos de Perda
    - Planos e Serviços iniciais
    - Modelo de Proposta Padrão
    """
    default_messages = {
        "whatsapp_proposal": "Olá {cliente}! Segue o link seguro da proposta de assessoria contábil elaborada para a *{empresa}*: {link}",
        "email_subject": "Proposta de Assessoria Contábil #{numero} — {escritorio}",
        "email_body": "Prezado(a) {cliente},\n\nApresentamos nossa proposta técnica e comercial de serviços contábeis para a empresa {empresa}.\n\nAcesse o link seguro para visualizar o escopo detalhado e registrar o aceite comercial:\n{link}\n\nAtenciosamente,\n{escritorio}",
    }
    custom_questions = [
        {"id": "sistema_erp", "pergunta": "Utiliza ERP / Sistema de Gestão Financeira atualmente?", "tipo": "texto"},
        {"id": "certificado_digital", "pergunta": "Possui Certificado Digital e-CNPJ A1 ativo?", "tipo": "sim_nao"},
        {"id": "regime_caixa_competencia", "pergunta": "Possui conciliação bancária em dia?", "tipo": "sim_nao"},
    ]

    conn.execute(
        """
        INSERT INTO tenants (
            id, name, trade_name, cnpj, crc_registration, email, phone, whatsapp,
            city, state, address, website, primary_color, secondary_color, accent_color,
            commercial_signature, default_messages_json, custom_diagnostic_questions_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '#0E1626', '#EAE3CF', ?, ?, ?)
        """,
        (
            tenant_id,
            tenant_name,
            trade_name,
            cnpj,
            crc,
            email,
            phone,
            phone,
            city,
            state,
            f"Av. Empresarial, 1000 - {city}/{state}",
            f"https://www.{tenant_id.replace('_', '')}.cnt.br",
            primary_color,
            f"{trade_name} · Registro {crc} · {email} · {phone}",
            json.dumps(default_messages, ensure_ascii=False),
            json.dumps(custom_questions, ensure_ascii=False),
        ),
    )

    # Versão 1 dos Parâmetros
    param_id = f"pv_{tenant_id}_v1"
    conn.execute(
        """
        INSERT INTO parameter_versions (
            id, tenant_id, version_number, version_label, is_active,
            fixed_cost_monthly, variable_cost_pct, productive_hours_monthly,
            target_margin_pct, markup_factor, minimum_fee_floor,
            max_discount_seller_pct, max_discount_manager_pct, default_setup_fee,
            hours_per_employee, hours_per_partner, hours_per_branch,
            department_costs_json, regimes_json, activities_json,
            invoice_brackets_json, revenue_brackets_json, accessories_json,
            complexity_levels_json, created_by
        ) VALUES (?, ?, 1, 'v1.0 — Parâmetros Base NBC PG 01', 1, ?, 0.0, ?, ?, ?, 350.0, 8.0, 15.0, 450.0, 0.45, 0.35, 1.50, ?, ?, ?, ?, ?, ?, ?, 'sistema')
        """,
        (
            param_id,
            tenant_id,
            fixed_cost,
            productive_hours,
            target_margin,
            round(1.0 + target_margin / 100.0, 4),
            json.dumps(DEFAULT_DEPARTMENTS, ensure_ascii=False),
            json.dumps(DEFAULT_REGIMES, ensure_ascii=False),
            json.dumps(DEFAULT_ACTIVITIES, ensure_ascii=False),
            json.dumps(DEFAULT_INVOICE_BRACKETS, ensure_ascii=False),
            json.dumps(DEFAULT_REVENUE_BRACKETS, ensure_ascii=False),
            json.dumps(DEFAULT_ACCESSORIES, ensure_ascii=False),
            json.dumps(DEFAULT_COMPLEXITY_LEVELS, ensure_ascii=False),
        ),
    )

    # Planos, Serviços Recorrentes, Avulsos e Implantação
    default_plans = [
        ("plano", "PLN-ESS", "Plano Contábil Essencial", "Escrituração contábil, fiscal e folha de pagamento digital conforme regime.", "Contábil", 0.0, 0.0, 1.0, ["Escrituração Contábil e Fiscal", "Apuração de Impostos", "Folha e eSocial", "Atendimento via Portal/WhatsApp"]),
        ("plano", "PLN-CONS", "Plano Consultivo Estratégico", "Inclui reuniões trimestrais de análise de balancete, DRE gerencial e planejamento preventivo.", "Contábil", 2.0, 0.0, 1.15, ["Tudo do Plano Essencial", "DRE Gerencial Mensal", "Reunião Trimestral de Resultados", "Análise Preventiva de Tributos"]),
        ("plano", "PLN-BPO", "Plano Full Contábil + BPO Financeiro", "Terceirização completa do contas a pagar/receber, conciliação diária e contabilidade consultiva.", "Societário", 5.0, 0.0, 1.35, ["Contabilidade Consultiva", "Conciliação Bancária Diária", "Agendamento Bancário de Contas", "Fluxo de Caixa Mensal"]),
        ("servico_recorrente", "SRV-BPO-PARC", "BPO Financeiro (Conciliação Semanal)", "Gestão operacional de fluxo de caixa e conciliação bancária semanal.", "Societário", 3.0, 0.0, 1.0, []),
        ("servico_recorrente", "SRV-BI", "Dashboard BI Contábil & Indicadores", "Painel mensal de indicadores financeiros e tributários.", "Contábil", 1.2, 0.0, 1.0, []),
        ("implantacao", "IMP-MIG", "Taxa de Implantação e Migração Contábil", "Onboarding técnico, conferência de saldos anteriores e parametrização fiscal.", "Contábil", 4.0, 450.0, 1.0, []),
    ]
    for item_type, code, name, desc, dept, est_h, base_p, mult, feats in default_plans:
        conn.execute(
            """
            INSERT INTO plans_services (
                id, tenant_id, item_type, code, name, description, department,
                estimated_hours, base_price, multiplier, included_features_json, is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            """,
            (
                f"ps_{tenant_id}_{code.lower().replace('-', '_')}",
                tenant_id,
                item_type,
                code,
                name,
                desc,
                dept,
                est_h,
                base_p,
                mult,
                json.dumps(feats, ensure_ascii=False),
            ),
        )

    for av in DEFAULT_AVULSOS:
        conn.execute(
            """
            INSERT INTO plans_services (
                id, tenant_id, item_type, code, name, description, department,
                estimated_hours, base_price, multiplier, included_features_json, is_active
            ) VALUES (?, ?, 'servico_avulso', ?, ?, 'Serviço pontual / cobrança única conforme Res. CFC 1.590/2020', 'Societário', 0.0, ?, 1.0, '[]', 1)
            """,
            (
                av["id"] if tenant_id == "tenant_alpha" else f"{av['id']}_{tenant_id}",
                tenant_id,
                av["id"].upper(),
                av["rotulo"],
                av["valor"],
            ),
        )

    # 8 Etapas Obrigatórias do Pipeline Kanban
    stages_spec = [
        ("novo_lead", "1. Novo Lead", 1, "#64748B", 10, 0, 0),
        ("primeiro_contato", "2. Primeiro Contato", 2, "#3B82F6", 20, 0, 0),
        ("diagnostico", "3. Diagnóstico Comercial", 3, "#8B5CF6", 35, 0, 0),
        ("precificacao", "4. Precificação", 4, "#C9A227", 50, 0, 0),
        ("proposta_enviada", "5. Proposta Enviada", 5, "#F59E0B", 65, 0, 0),
        ("negociacao", "6. Negociação", 6, "#EC4899", 80, 0, 0),
        ("ganho", "7. Ganho", 7, "#4FB477", 100, 1, 0),
        ("perdido", "8. Perdido", 8, "#E5544B", 0, 0, 1),
    ]
    stage_ids = {}
    for slug, sname, order, color, prob, is_won, is_lost in stages_spec:
        sid = f"stg_{tenant_id}_{slug}"
        stage_ids[slug] = sid
        conn.execute(
            """
            INSERT INTO pipeline_stages (id, tenant_id, slug, name, stage_order, color, win_probability, is_won, is_lost)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (sid, tenant_id, slug, sname, order, color, prob, is_won, is_lost),
        )

    # Motivos de Perda
    reasons = [
        ("Preço", "Cliente considerou o honorário acima do orçamento atual."),
        ("Concorrência", "Fechou com outro escritório contábil ou contabilidade online."),
        ("Falta de interesse", "Desistiu da abertura ou da troca de contador no momento."),
        ("Momento inadequado", "Adiamento do projeto ou restrição contratual de aviso prévio."),
        ("Sem retorno", "Lead parou de responder após tentativas de follow-up."),
        ("Serviço não atendido", "Demanda fora do escopo de atuação do escritório."),
        ("Outros", "Outros motivos comerciais específicos."),
    ]
    loss_ids = {}
    for idx, (rname, rdesc) in enumerate(reasons, 1):
        lid = f"loss_{tenant_id}_{idx}"
        loss_ids[rname] = lid
        conn.execute(
            "INSERT INTO loss_reasons (id, tenant_id, name, description, is_active) VALUES (?, ?, ?, ?, 1)",
            (lid, tenant_id, rname, rdesc),
        )

    # Modelo de Proposta Padrão
    tpl_id = f"tpl_{tenant_id}_default"
    conn.execute(
        """
        INSERT INTO proposal_templates (
            id, tenant_id, name, is_default, cover_title, office_presentation,
            differentials_text, scope_template, investment_notes, next_steps_text,
            payment_terms_default, validity_days_default
        ) VALUES (?, ?, 'Modelo Consultivo Padrão (NBC PG 01 / CFC 1.590)', 1, ?, ?, ?, ?, ?, ?, 'Boleto bancário ou PIX até o dia 10 de cada mês subsequente.', 10)
        """,
        (
            tpl_id,
            tenant_id,
            "Proposta Técnica e Comercial de Assessoria Contábil",
            f"O {trade_name} atua com foco em segurança tributária, conformidade contábil e inteligência financeira para apoiar o crescimento sustentável da sua empresa.",
            "• Atendimento consultivo por especialistas dedicados por departamento (Contábil, Fiscal e Pessoal)\n• Dimensionamento técnico justo fundamentado na NBC PG 01 e Resolução CFC 1.590/2020\n• Processos 100% digitais com integração de documentos e relatórios gerenciais",
            "Prestação de serviços de escrituração contábil regular, apuração fiscal, entrega de obrigações acessórias e processamento de folha de pagamento conforme perfil operacional diagnosticado.",
            "Os honorários mensais remuneram a responsabilidade técnica, a alocação de horas especializadas e os sistemas tecnológicos disponibilizados pelo escritório.",
            "1. Registro do Aceite Comercial nesta proposta\n2. Coleta documental e assinatura eletrônica do Contrato de Prestação de Serviços (Res. CFC 1.590/2020)\n3. Reunião de Onboarding e transição assistida junto à contabilidade anterior",
        ),
    )

    return {
        "param_id": param_id,
        "stage_ids": stage_ids,
        "loss_ids": loss_ids,
        "template_id": tpl_id,
    }


def _seed_initial_tenants(conn: sqlite3.Connection) -> None:
    """
    Popula dois escritórios contábeis reais e independentes para demonstrar e testar
    o isolamento Multi-Tenant, perfis de acesso e fluxo completo CRM -> Calculadora -> Proposta.
    """
    # TENANT 1: Alpha Contabilidade Consultiva
    alpha_meta = seed_tenant_defaults(
        conn,
        tenant_id="tenant_alpha",
        tenant_name="Alpha Contabilidade e Gestão Empresarial Ltda.",
        trade_name="Alpha Contabilidade Consultiva",
        cnpj="12.345.678/0001-90",
        crc="CRC-SP 2SP038491/O-2",
        email="comercial@alphacontabil.cnt.br",
        phone="(11) 3456-7890",
        city="São Paulo",
        state="SP",
        primary_color="#C9A227",
        fixed_cost=28000.0,
        productive_hours=320.0,
        target_margin=30.0,
    )

    # Usuários do Tenant Alpha (todos os 4 níveis de permissão)
    alpha_users = [
        ("usr_alpha_super", "tenant_alpha", "Carlos Eduardo (Admin Plataforma)", "super@plataforma.saas.br", "admin123", "admin_plataforma", 30.0),
        ("usr_alpha_admin", "tenant_alpha", "Dra. Helena Martins (Sócia-Diretora)", "helena@alphacontabil.cnt.br", "admin123", "admin_escritorio", 25.0),
        ("usr_alpha_gestor", "tenant_alpha", "Roberto Nogueira (Gestor Comercial)", "roberto@alphacontabil.cnt.br", "admin123", "gestor_comercial", 15.0),
        ("usr_alpha_vend", "tenant_alpha", "Mariana Costa (Consultora Comercial)", "mariana@alphacontabil.cnt.br", "admin123", "vendedor", 8.0),
    ]
    for uid, tid, uname, uemail, upass, urole, max_disc in alpha_users:
        conn.execute(
            """
            INSERT INTO users (id, tenant_id, name, email, password_hash, role, max_discount_pct, lgpd_consent_at, active)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), 1)
            """,
            (uid, tid, uname, uemail, hash_password(upass), urole, max_disc),
        )

    # Clientes e Oportunidades do Tenant Alpha
    st = alpha_meta["stage_ids"]
    alpha_opps = [
        {
            "id": "opp_alpha_1",
            "stage_id": st["diagnostico"],
            "owner": "usr_alpha_vend",
            "contact": "Rafael Albuquerque",
            "company": "TechNova Soluções em Software Ltda.",
            "cnpj": "34.512.890/0001-15",
            "email": "rafael@technova.io",
            "whatsapp": "(11) 98765-4321",
            "city": "São Paulo",
            "state": "SP",
            "origin": "Google Ads",
            "hiring_type": "Troca de contador",
            "interest": "Contabilidade Consultiva + Fator R",
            "revenue": 120000.0,
            "regime": "simples",
            "activity": "servicos",
            "employees": 6,
            "partners": 2,
            "branches": 0,
            "vol_idx": 1,
            "accountant": "Contabilidade Tradicional ABC",
            "close_date": (datetime.now() + timedelta(days=7)).strftime("%Y-%m-%d"),
            "potential": 949.81,
            "next_action": "Apresentar estudo de horas técnicas e gerar proposta",
            "next_date": (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d"),
            "status": "aberta",
            "loss_reason": None,
        },
        {
            "id": "opp_alpha_2",
            "stage_id": st["proposta_enviada"],
            "owner": "usr_alpha_vend",
            "contact": "Fernanda Vasconcelos",
            "company": "Vértice Distribuidora Hospitalar Ltda.",
            "cnpj": "45.889.102/0001-44",
            "email": "fernanda@verticehosp.com.br",
            "whatsapp": "(11) 99123-4567",
            "city": "Campinas",
            "state": "SP",
            "origin": "Indicação de Cliente",
            "hiring_type": "Troca de contador",
            "interest": "Lucro Presumido + ICMS-ST",
            "revenue": 420000.0,
            "regime": "presumido",
            "activity": "comercio",
            "employees": 12,
            "partners": 2,
            "branches": 1,
            "vol_idx": 3,
            "accountant": "Escritório Central",
            "close_date": (datetime.now() + timedelta(days=5)).strftime("%Y-%m-%d"),
            "potential": 2991.63,
            "next_action": "Follow-up sobre proposta enviada #PROP-2026-001",
            "next_date": datetime.now().strftime("%Y-%m-%d"),
            "status": "aberta",
            "loss_reason": None,
        },
        {
            "id": "opp_alpha_3",
            "stage_id": st["ganho"],
            "owner": "usr_alpha_gestor",
            "contact": "Dr. Marcelo Sampaio",
            "company": "Clínica Médica Integrada Sampaio S/S",
            "cnpj": "19.220.410/0001-88",
            "email": "marcelo@clinicasampaio.med.br",
            "whatsapp": "(11) 97654-3210",
            "city": "São Paulo",
            "state": "SP",
            "origin": "Indicação",
            "hiring_type": "Troca de contador",
            "interest": "Contabilidade Especializada Saúde + Equiparação Hospitalar",
            "revenue": 250000.0,
            "regime": "presumido",
            "activity": "servicos",
            "employees": 8,
            "partners": 3,
            "branches": 0,
            "vol_idx": 2,
            "accountant": "Assessoria MedCont",
            "close_date": (datetime.now() - timedelta(days=2)).strftime("%Y-%m-%d"),
            "potential": 2021.91,
            "next_action": "Iniciar onboarding societário e fiscal",
            "next_date": (datetime.now() + timedelta(days=2)).strftime("%Y-%m-%d"),
            "status": "ganha",
            "loss_reason": None,
        },
        {
            "id": "opp_alpha_4",
            "stage_id": st["novo_lead"],
            "owner": "usr_alpha_vend",
            "contact": "Lucas Mendonça",
            "company": "Mendonça & Filhos Gastronomia Ltda.",
            "cnpj": "51.009.312/0001-02",
            "email": "lucas@mendoncagastro.com.br",
            "whatsapp": "(11) 96543-2198",
            "city": "Santos",
            "state": "SP",
            "origin": "Instagram / Meta Ads",
            "hiring_type": "Abertura de empresa",
            "interest": "Abertura + Assessoria Mensal Simples Nacional",
            "revenue": 65000.0,
            "regime": "simples",
            "activity": "comercio",
            "employees": 5,
            "partners": 2,
            "branches": 0,
            "vol_idx": 2,
            "accountant": "Não possui (Abertura)",
            "close_date": (datetime.now() + timedelta(days=12)).strftime("%Y-%m-%d"),
            "potential": 1131.81,
            "next_action": "Ligar para qualificação inicial e agendar diagnóstico",
            "next_date": datetime.now().strftime("%Y-%m-%d"),
            "status": "aberta",
            "loss_reason": None,
        },
        {
            "id": "opp_alpha_5",
            "stage_id": st["perdido"],
            "owner": "usr_alpha_vend",
            "contact": "Patrícia Gomes",
            "company": "Gomes Representações Comerciais ME",
            "cnpj": "28.910.111/0001-50",
            "email": "patricia@gomesrep.com.br",
            "whatsapp": "(11) 95432-1098",
            "city": "Guarulhos",
            "state": "SP",
            "origin": "Prospecção Ativa",
            "hiring_type": "Troca de contador",
            "interest": "Contabilidade Mensal",
            "revenue": 35000.0,
            "regime": "simples",
            "activity": "servicos",
            "employees": 0,
            "partners": 1,
            "branches": 0,
            "vol_idx": 0,
            "accountant": "Contabilidade Online",
            "close_date": (datetime.now() - timedelta(days=5)).strftime("%Y-%m-%d"),
            "potential": 398.13,
            "next_action": "Reabordar em 6 meses",
            "next_date": (datetime.now() + timedelta(days=180)).strftime("%Y-%m-%d"),
            "status": "perdida",
            "loss_reason": alpha_meta["loss_ids"]["Preço"],
        },
    ]

    for op in alpha_opps:
        cid = f"cli_{op['id']}"
        conn.execute(
            """
            INSERT INTO clients (
                id, tenant_id, contact_name, company_name, cpf_cnpj, email, whatsapp,
                city, state, tax_regime, economic_activity, monthly_revenue,
                employees_count, partners_count, branches_count, current_accountant
            ) VALUES (?, 'tenant_alpha', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                cid,
                op["contact"],
                op["company"],
                op["cnpj"],
                op["email"],
                op["whatsapp"],
                op["city"],
                op["state"],
                op["regime"],
                op["activity"],
                op["revenue"],
                op["employees"],
                op["partners"],
                op["branches"],
                op["accountant"],
            ),
        )

        won_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S") if op["status"] == "ganha" else None
        lost_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S") if op["status"] == "perdida" else None
        conn.execute(
            """
            INSERT INTO opportunities (
                id, tenant_id, client_id, stage_id, owner_user_id, contact_name, company_name,
                cpf_cnpj, email, whatsapp, city, state, lead_origin, hiring_type,
                service_interest, estimated_revenue, current_tax_regime, economic_activity,
                employees_count, partners_count, branches_count, invoice_volume_index,
                current_accountant, expected_close_date, potential_monthly_value,
                next_action, next_action_date, status, loss_reason_id, won_at, lost_at,
                created_at
            ) VALUES (?, 'tenant_alpha', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-6 days'))
            """,
            (
                op["id"],
                cid,
                op["stage_id"],
                op["owner"],
                op["contact"],
                op["company"],
                op["cnpj"],
                op["email"],
                op["whatsapp"],
                op["city"],
                op["state"],
                op["origin"],
                op["hiring_type"],
                op["interest"],
                op["revenue"],
                op["regime"],
                op["activity"],
                op["employees"],
                op["partners"],
                op["branches"],
                op["vol_idx"],
                op["accountant"],
                op["close_date"],
                op["potential"],
                op["next_action"],
                op["next_date"],
                op["status"],
                op["loss_reason"],
                won_at,
                lost_at,
            ),
        )

    # Diagnóstico comercial preenchido para opp_alpha_1 e opp_alpha_2
    conn.execute(
        """
        INSERT INTO commercial_diagnostics (
            id, tenant_id, opportunity_id, client_need, current_situation,
            tax_regime, economic_activity, monthly_revenue, invoice_volume_index,
            employees_count, partners_count, branches_count,
            specific_obligations_json, desired_services_json,
            accountant_pains, urgency_level, operational_complexity, custom_answers_json, created_by
        ) VALUES (
            'diag_alpha_1', 'tenant_alpha', 'opp_alpha_1',
            'Reduzir carga tributária no Simples Nacional via monitoramento mensal do Fator R e melhorar relatórios contábeis.',
            'Empresa em crescimento acelerado, emitindo ~60 NF-e/mês de licenciamento e desenvolvimento.',
            'simples', 'servicos', 120000.0, 1, 6, 2, 0,
            '{"dctfweb": true}', '{"planejamento": {"valor": 2500}}',
            'Falta de retorno consultivo e atraso na entrega de balancetes para bancos.',
            'Alta', 'padrao', '{"sistema_erp": "ContaAzul", "certificado_digital": "Sim"}', 'usr_alpha_vend'
        )
        """
    )

    # Simulação e Proposta Enviada para opp_alpha_2 (Vértice Distribuidora)
    calc_op2 = calculate_honorarios(
        {
            "custoFixo": 28000,
            "horasProdutivas": 320,
            "margem": 30,
            "regime": "presumido",
            "atividade": "comercio",
            "faturamento": 420000,
            "funcionarios": 12,
            "socios": 2,
            "filiais": 1,
            "volume": 3,
            "obrigacoes": {"efdcontrib": True, "icmsst": True, "dctfweb": True},
        }
    )
    conn.execute(
        """
        INSERT INTO simulations (
            id, tenant_id, parameter_version_id, opportunity_id, client_id, title,
            client_name, company_name, cpf_cnpj, tax_regime, economic_activity,
            monthly_revenue, employees_count, partners_count, branches_count,
            invoice_volume_index, operational_complexity, selected_obligations_json,
            selected_one_off_services_json, setup_fee, discount_pct, intended_price,
            cost_per_hour, technical_hour_rate, total_hours, floor_cost,
            recommended_fee, final_monthly_fee, total_one_off_fee, viability_status,
            calculation_breakdown_json, created_by
        ) VALUES (
            'sim_alpha_2', 'tenant_alpha', ?, 'opp_alpha_2', 'cli_opp_alpha_2',
            'Estudo Técnico — Vértice Distribuidora Hospitalar',
            'Fernanda Vasconcelos', 'Vértice Distribuidora Hospitalar Ltda.', '45.889.102/0001-44',
            'presumido', 'comercio', 420000.0, 12, 2, 1, 3, 'padrao',
            '{"efdcontrib": true, "icmsst": true, "dctfweb": true}', '{}',
            450.0, 0.0, 0.0, ?, ?, ?, ?, ?, ?, 0.0, 'ok', ?, 'usr_alpha_vend'
        )
        """,
        (
            alpha_meta["param_id"],
            calc_op2["custoHora"],
            calc_op2["horaTecnica"],
            calc_op2["horasTotais"],
            calc_op2["piso"],
            calc_op2["sugerido"],
            calc_op2["honorarioFinal"],
            json.dumps(calc_op2["breakdown"], ensure_ascii=False),
        ),
    )

    # Proposta 1 (Enviada - opp_alpha_2) e Proposta 2 (Aceita - opp_alpha_3)
    conn.execute(
        """
        INSERT INTO proposals (
            id, tenant_id, proposal_number, public_token, opportunity_id, client_id,
            simulation_id, template_id, seller_user_id, current_version,
            client_name, company_name, cpf_cnpj, contact_email, contact_whatsapp,
            plan_name, services_summary_json, one_off_services_json,
            monthly_fee_base, discount_pct, discount_amount, monthly_fee_final,
            setup_fee, one_off_total, payment_conditions, valid_until,
            cover_title, office_presentation, differentials_text, technical_scope_text,
            next_steps_text, status, sent_at
        ) VALUES (
            'prop_alpha_1', 'tenant_alpha', 'PROP-2026-001', 'tok_alpha_vertice_2026',
            'opp_alpha_2', 'cli_opp_alpha_2', 'sim_alpha_2', ?, 'usr_alpha_vend', 1,
            'Fernanda Vasconcelos', 'Vértice Distribuidora Hospitalar Ltda.', '45.889.102/0001-44',
            'fernanda@verticehosp.com.br', '(11) 99123-4567',
            'Plano Consultivo Estratégico', ?, '[]',
            ?, 0.0, 0.0, ?, 450.0, 0.0,
            'Boleto ou PIX todo dia 10 do mês subsequente.', ?,
            'Proposta de Assessoria Contábil e Fiscal — Vértice Distribuidora',
            'A Alpha Contabilidade Consultiva é especialista em empresas comerciais no Lucro Presumido com operações de ICMS-ST.',
            '• Apuração rigorosa de ICMS-ST e DIFAL\n• Entrega auditada de EFD-Contribuições e DCTFWeb\n• Balancetes mensais comentados',
            'Escopo técnico dimensionado em ' || ? || ' horas técnicas mensais conforme NBC PG 01 e Resolução CFC 1.590/2020.',
            '1. Aceite comercial no link exclusivo\n2. Assinatura do Contrato de Prestação de Serviços\n3. Migração assistida junto ao escritório anterior',
            'Enviada', datetime('now', '-2 days')
        )
        """,
        (
            alpha_meta["template_id"],
            json.dumps(calc_op2["breakdown"], ensure_ascii=False),
            calc_op2["sugerido"],
            calc_op2["honorarioFinal"],
            (datetime.now() + timedelta(days=10)).strftime("%Y-%m-%d"),
            calc_op2["horasTotais"],
        ),
    )

    conn.execute(
        """
        INSERT INTO proposal_versions (
            id, tenant_id, proposal_id, version_number, monthly_fee_base,
            discount_pct, monthly_fee_final, setup_fee, one_off_total, snapshot_json, created_by
        ) VALUES ('pv_prop_alpha_1_v1', 'tenant_alpha', 'prop_alpha_1', 1, ?, 0.0, ?, 450.0, 0.0, ?, 'usr_alpha_vend')
        """,
        (calc_op2["sugerido"], calc_op2["honorarioFinal"], json.dumps(calc_op2, ensure_ascii=False)),
    )

    conn.execute(
        """
        INSERT INTO proposal_events (id, tenant_id, proposal_id, event_type, channel, recipient, metadata_json)
        VALUES ('pev_alpha_1', 'tenant_alpha', 'prop_alpha_1', 'enviada_email', 'E-mail Transacional', 'fernanda@verticehosp.com.br', '{"status": "delivered"}')
        """
    )

    # Proposta 2 (Aceita - Clínica Médica Integrada Sampaio)
    conn.execute(
        """
        INSERT INTO proposals (
            id, tenant_id, proposal_number, public_token, opportunity_id, client_id,
            simulation_id, template_id, seller_user_id, current_version,
            client_name, company_name, cpf_cnpj, contact_email, contact_whatsapp,
            plan_name, services_summary_json, one_off_services_json,
            monthly_fee_base, discount_pct, discount_amount, monthly_fee_final,
            setup_fee, one_off_total, payment_conditions, valid_until,
            cover_title, office_presentation, differentials_text, technical_scope_text,
            next_steps_text, status, sent_at, viewed_at, accepted_at,
            accepted_by_name, accepted_by_document, accepted_by_role, accepted_by_email,
            accepted_ip, accepted_version
        ) VALUES (
            'prop_alpha_2', 'tenant_alpha', 'PROP-2026-002', 'tok_alpha_sampaio_2026',
            'opp_alpha_3', 'cli_opp_alpha_3', NULL, ?, 'usr_alpha_gestor', 1,
            'Dr. Marcelo Sampaio', 'Clínica Médica Integrada Sampaio S/S', '19.220.410/0001-88',
            'marcelo@clinicasampaio.med.br', '(11) 97654-3210',
            'Plano Consultivo Estratégico', '[{"nome": "Lucro Presumido (Serviços)", "horas": 6.83, "valor": 776.91}, {"nome": "Folha / DP (8 colab.)", "horas": 3.6, "valor": 409.50}, {"nome": "Volume fiscal e DMED", "horas": 7.35, "valor": 835.50}]',
            '[{"id": "planejamento", "rotulo": "Planejamento tributário", "valor": 2500.0}]',
            2021.91, 0.0, 0.0, 2021.91, 450.0, 2500.0,
            'Boleto bancário todo dia 10.', ?,
            'Proposta de Contabilidade Médica e Planejamento Tributário',
            'Especialistas na área médica e clínicas de saúde.',
            '• Controle de DMED e Carnê-Leão/Livro Caixa\n• Estudo de Equiparação Hospitalar',
            'Assessoria contábil, fiscal e trabalhista completa conforme Res. CFC 1.590/2020.',
            '1. Aceite Comercial\n2. Contrato Digital\n3. Onboarding',
            'Aceita', datetime('now', '-4 days'), datetime('now', '-3 days'), datetime('now', '-2 days'),
            'Dr. Marcelo Sampaio', '214.890.318-44', 'Sócio-Diretor Clínico', 'marcelo@clinicasampaio.med.br',
            '189.45.112.90', 1
        )
        """,
        (alpha_meta["template_id"], (datetime.now() + timedelta(days=15)).strftime("%Y-%m-%d")),
    )

    conn.execute(
        """
        INSERT INTO proposal_versions (
            id, tenant_id, proposal_id, version_number, monthly_fee_base,
            discount_pct, monthly_fee_final, setup_fee, one_off_total, snapshot_json, created_by
        ) VALUES ('pv_prop_alpha_2_v1', 'tenant_alpha', 'prop_alpha_2', 1, 2021.91, 0.0, 2021.91, 450.0, 2500.0, '{"status": "Aceita"}', 'usr_alpha_gestor')
        """
    )

    # Atividades e Follow-ups no CRM do Tenant Alpha
    activities = [
        ("act_alpha_1", "tenant_alpha", "opp_alpha_1", "usr_alpha_vend", "reuniao", "Apresentar simulação de honorários e Fator R", "Reunião online pelo Google Meet com sócio Rafael.", (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d"), 0),
        ("act_alpha_2", "tenant_alpha", "opp_alpha_2", "usr_alpha_vend", "whatsapp", "Cobrar retorno da proposta #PROP-2026-001", "Confirmar se a diretoria avaliou o escopo de ICMS-ST.", (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d"), 0),
        ("act_alpha_3", "tenant_alpha", "opp_alpha_4", "usr_alpha_vend", "ligacao", "Primeiro contato de qualificação (Abertura)", "Levantar CNAEs pretendidos e quadro societário.", datetime.now().strftime("%Y-%m-%d"), 0),
        ("act_alpha_4", "tenant_alpha", "opp_alpha_3", "usr_alpha_gestor", "tarefa", "Enviar minuta de contrato conforme Res. CFC 1.590/2020", "Proposta comercial já aceita pelo Dr. Marcelo.", datetime.now().strftime("%Y-%m-%d"), 1),
    ]
    for aid, tid, oid, uid, atype, title, desc, due, comp in activities:
        conn.execute(
            """
            INSERT INTO crm_activities (id, tenant_id, opportunity_id, assigned_user_id, activity_type, title, description, due_date, completed, completed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END)
            """,
            (aid, tid, oid, uid, atype, title, desc, due, comp, comp),
        )

    # =========================================================================
    # TENANT 2: Beta Gestão Contábil (Isolamento Multi-Tenant)
    # =========================================================================
    beta_meta = seed_tenant_defaults(
        conn,
        tenant_id="tenant_beta",
        tenant_name="Beta Assessoria Contábil e Tributária S/S",
        trade_name="Beta Gestão Contábil",
        cnpj="98.765.432/0001-10",
        crc="CRC-PR 1PR049210/O-5",
        email="contato@betacontabil.cnt.br",
        phone="(41) 3222-9000",
        city="Curitiba",
        state="PR",
        primary_color="#38BDF8",
        fixed_cost=19200.0,
        productive_hours=240.0,
        target_margin=35.0,
    )

    conn.execute(
        """
        INSERT INTO users (id, tenant_id, name, email, password_hash, role, max_discount_pct, lgpd_consent_at, active)
        VALUES ('usr_beta_admin', 'tenant_beta', 'Dr. Gustavo Almeida (Diretor Beta)', 'gustavo@betacontabil.cnt.br', ?, 'admin_escritorio', 20.0, datetime('now'), 1)
        """,
        (hash_password("admin123"),),
    )

    conn.execute(
        """
        INSERT INTO opportunities (
            id, tenant_id, stage_id, owner_user_id, contact_name, company_name,
            cpf_cnpj, email, whatsapp, city, state, lead_origin, hiring_type,
            service_interest, estimated_revenue, current_tax_regime, economic_activity,
            employees_count, partners_count, branches_count, invoice_volume_index,
            current_accountant, expected_close_date, potential_monthly_value,
            next_action, next_action_date, status
        ) VALUES (
            'opp_beta_1', 'tenant_beta', ?, 'usr_beta_admin',
            'Eduardo Araucária', 'Indústria Metalúrgica SulParaná Ltda.', '77.123.456/0001-80',
            'eduardo@sulparana.ind.br', '(41) 99888-7766', 'Curitiba', 'PR',
            'Evento Empresarial', 'Troca de contador', 'Lucro Real Industrial',
            850000.0, 'real', 'industria', 28, 2, 1, 3, 'Contabilidade Local',
            ?, 4560.00, 'Realizar diagnóstico industrial no local', ?, 'aberta'
        )
        """,
        (
            beta_meta["stage_ids"]["primeiro_contato"],
            (datetime.now() + timedelta(days=14)).strftime("%Y-%m-%d"),
            (datetime.now() + timedelta(days=2)).strftime("%Y-%m-%d"),
        ),
    )
