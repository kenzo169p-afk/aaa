-- ============================================================================
-- MIGRATION 001: SCHEMA MULTI-TENANT SAAS CONTÁBIL (SQLite 3)
-- Plataforma de Precificação, Propostas Comerciais e CRM Contábil
-- ============================================================================

PRAGMA foreign_keys = ON;

-- 1. ESCRITÓRIOS CONTÁBEIS (TENANTS)
CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    trade_name TEXT,
    cnpj TEXT,
    crc_registration TEXT,
    email TEXT,
    phone TEXT,
    whatsapp TEXT,
    city TEXT,
    state TEXT,
    address TEXT,
    website TEXT,
    logo_url TEXT,
    primary_color TEXT DEFAULT '#C9A227',
    secondary_color TEXT DEFAULT '#0E1626',
    accent_color TEXT DEFAULT '#EAE3CF',
    commercial_signature TEXT,
    smtp_config_json TEXT DEFAULT '{}',
    integrations_json TEXT DEFAULT '{}',
    default_messages_json TEXT DEFAULT '{}',
    custom_diagnostic_questions_json TEXT DEFAULT '[]',
    lgpd_policy_version TEXT DEFAULT '1.0',
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 2. USUÁRIOS E PERMISSÕES (RBAC)
-- Roles: 'admin_plataforma', 'admin_escritorio', 'gestor_comercial', 'vendedor'
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin_plataforma', 'admin_escritorio', 'gestor_comercial', 'vendedor')),
    phone TEXT,
    max_discount_pct REAL DEFAULT 10.0,
    lgpd_consent_at TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(tenant_id, email),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- 3. PARÂMETROS DE PRECIFICAÇÃO VERSIONADOS POR ESCRITÓRIO
CREATE TABLE IF NOT EXISTS parameter_versions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    version_label TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    fixed_cost_monthly REAL NOT NULL DEFAULT 28000.0,
    variable_cost_pct REAL NOT NULL DEFAULT 0.0,
    productive_hours_monthly REAL NOT NULL DEFAULT 320.0,
    target_margin_pct REAL NOT NULL DEFAULT 30.0,
    markup_factor REAL NOT NULL DEFAULT 1.30,
    minimum_fee_floor REAL NOT NULL DEFAULT 350.0,
    max_discount_seller_pct REAL NOT NULL DEFAULT 8.0,
    max_discount_manager_pct REAL NOT NULL DEFAULT 15.0,
    default_setup_fee REAL NOT NULL DEFAULT 0.0,
    hours_per_employee REAL NOT NULL DEFAULT 0.45,
    hours_per_partner REAL NOT NULL DEFAULT 0.35,
    hours_per_branch REAL NOT NULL DEFAULT 1.50,
    department_costs_json TEXT NOT NULL,
    regimes_json TEXT NOT NULL,
    activities_json TEXT NOT NULL,
    invoice_brackets_json TEXT NOT NULL,
    revenue_brackets_json TEXT NOT NULL,
    accessories_json TEXT NOT NULL,
    complexity_levels_json TEXT NOT NULL,
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- 4. PLANOS, PACOTES E SERVIÇOS (RECORRENTES, ADICIONAIS, AVULSOS, IMPLANTAÇÃO)
-- Permite cadastrar serviços e planos sem nomes ou preços fixos pré-impostos
CREATE TABLE IF NOT EXISTS plans_services (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    item_type TEXT NOT NULL CHECK (item_type IN ('plano', 'servico_recorrente', 'servico_avulso', 'implantacao')),
    code TEXT,
    name TEXT NOT NULL,
    description TEXT,
    department TEXT DEFAULT 'Contábil',
    estimated_hours REAL DEFAULT 0.0,
    base_price REAL DEFAULT 0.0,
    multiplier REAL DEFAULT 1.0,
    included_features_json TEXT DEFAULT '[]',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- 5. CLIENTES E CONTATOS
CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    contact_name TEXT NOT NULL,
    company_name TEXT,
    cpf_cnpj TEXT,
    email TEXT,
    whatsapp TEXT,
    phone TEXT,
    city TEXT,
    state TEXT,
    tax_regime TEXT DEFAULT 'simples',
    economic_activity TEXT DEFAULT 'servicos',
    monthly_revenue REAL DEFAULT 0.0,
    employees_count INTEGER DEFAULT 0,
    partners_count INTEGER DEFAULT 1,
    branches_count INTEGER DEFAULT 0,
    current_accountant TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- 6. ETAPAS DO PIPELINE KANBAN
CREATE TABLE IF NOT EXISTS pipeline_stages (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    stage_order INTEGER NOT NULL,
    color TEXT DEFAULT '#C9A227',
    win_probability INTEGER DEFAULT 10,
    is_won INTEGER DEFAULT 0,
    is_lost INTEGER DEFAULT 0,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- 7. MOTIVOS DE PERDA COMERCIAL
CREATE TABLE IF NOT EXISTS loss_reasons (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    is_active INTEGER DEFAULT 1,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- 8. LEADS E OPORTUNIDADES (CRM DE VENDAS CONTÁBIL)
CREATE TABLE IF NOT EXISTS opportunities (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    client_id TEXT,
    stage_id TEXT NOT NULL,
    owner_user_id TEXT,
    contact_name TEXT NOT NULL,
    company_name TEXT NOT NULL,
    cpf_cnpj TEXT,
    email TEXT,
    whatsapp TEXT,
    city TEXT,
    state TEXT,
    lead_origin TEXT DEFAULT 'Indicação',
    hiring_type TEXT DEFAULT 'Troca de contador',
    service_interest TEXT DEFAULT 'Contabilidade Completa',
    estimated_revenue REAL DEFAULT 50000.0,
    current_tax_regime TEXT DEFAULT 'simples',
    economic_activity TEXT DEFAULT 'servicos',
    employees_count INTEGER DEFAULT 2,
    partners_count INTEGER DEFAULT 1,
    branches_count INTEGER DEFAULT 0,
    invoice_volume_index INTEGER DEFAULT 1,
    current_accountant TEXT,
    expected_close_date TEXT,
    potential_monthly_value REAL DEFAULT 0.0,
    next_action TEXT,
    next_action_date TEXT,
    status TEXT DEFAULT 'aberta' CHECK (status IN ('aberta', 'ganha', 'perdida')),
    loss_reason_id TEXT,
    loss_notes TEXT,
    won_at TEXT,
    lost_at TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
    FOREIGN KEY (stage_id) REFERENCES pipeline_stages(id)
);

-- 9. HISTÓRICO DE MOVIMENTAÇÃO DO PIPELINE
CREATE TABLE IF NOT EXISTS opportunity_stage_history (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    opportunity_id TEXT NOT NULL,
    from_stage_id TEXT,
    to_stage_id TEXT NOT NULL,
    changed_by_user_id TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE
);

-- 10. DIAGNÓSTICO COMERCIAL CONTÁBIL
CREATE TABLE IF NOT EXISTS commercial_diagnostics (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    opportunity_id TEXT NOT NULL,
    client_need TEXT,
    current_situation TEXT,
    tax_regime TEXT NOT NULL DEFAULT 'simples',
    economic_activity TEXT NOT NULL DEFAULT 'servicos',
    monthly_revenue REAL NOT NULL DEFAULT 50000.0,
    invoice_volume_index INTEGER NOT NULL DEFAULT 1,
    employees_count INTEGER NOT NULL DEFAULT 2,
    partners_count INTEGER NOT NULL DEFAULT 1,
    branches_count INTEGER NOT NULL DEFAULT 0,
    specific_obligations_json TEXT DEFAULT '{}',
    desired_services_json TEXT DEFAULT '{}',
    accountant_pains TEXT,
    urgency_level TEXT DEFAULT 'Média',
    operational_complexity TEXT DEFAULT 'padrao',
    custom_answers_json TEXT DEFAULT '{}',
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE
);

-- 11. ATIVIDADES E FOLLOW-UPS DO CRM
CREATE TABLE IF NOT EXISTS crm_activities (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    opportunity_id TEXT NOT NULL,
    assigned_user_id TEXT,
    activity_type TEXT NOT NULL CHECK (activity_type IN ('tarefa', 'ligacao', 'reuniao', 'whatsapp', 'email', 'observacao', 'lembrete')),
    title TEXT NOT NULL,
    description TEXT,
    due_date TEXT,
    completed INTEGER DEFAULT 0,
    completed_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE
);

-- 12. SIMULAÇÕES DA CALCULADORA DE HONORÁRIOS
CREATE TABLE IF NOT EXISTS simulations (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    parameter_version_id TEXT NOT NULL,
    opportunity_id TEXT,
    client_id TEXT,
    title TEXT NOT NULL,
    client_name TEXT,
    company_name TEXT,
    cpf_cnpj TEXT,
    tax_regime TEXT NOT NULL,
    economic_activity TEXT NOT NULL,
    monthly_revenue REAL NOT NULL DEFAULT 0.0,
    employees_count INTEGER NOT NULL DEFAULT 0,
    partners_count INTEGER NOT NULL DEFAULT 1,
    branches_count INTEGER NOT NULL DEFAULT 0,
    invoice_volume_index INTEGER NOT NULL DEFAULT 0,
    operational_complexity TEXT NOT NULL DEFAULT 'padrao',
    selected_plan_id TEXT,
    selected_obligations_json TEXT NOT NULL DEFAULT '{}',
    selected_one_off_services_json TEXT NOT NULL DEFAULT '{}',
    selected_recurring_services_json TEXT NOT NULL DEFAULT '[]',
    setup_fee REAL NOT NULL DEFAULT 0.0,
    discount_pct REAL NOT NULL DEFAULT 0.0,
    intended_price REAL NOT NULL DEFAULT 0.0,
    cost_per_hour REAL NOT NULL,
    technical_hour_rate REAL NOT NULL,
    total_hours REAL NOT NULL,
    floor_cost REAL NOT NULL,
    recommended_fee REAL NOT NULL,
    final_monthly_fee REAL NOT NULL,
    total_one_off_fee REAL NOT NULL DEFAULT 0.0,
    viability_status TEXT,
    calculation_breakdown_json TEXT NOT NULL,
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (parameter_version_id) REFERENCES parameter_versions(id)
);

-- 13. MODELOS PERSONALIZADOS DE PROPOSTA
CREATE TABLE IF NOT EXISTS proposal_templates (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    is_default INTEGER DEFAULT 0,
    cover_title TEXT NOT NULL,
    office_presentation TEXT NOT NULL,
    differentials_text TEXT NOT NULL,
    scope_template TEXT NOT NULL,
    investment_notes TEXT NOT NULL,
    next_steps_text TEXT NOT NULL,
    payment_terms_default TEXT NOT NULL,
    validity_days_default INTEGER DEFAULT 10,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- 14. PROPOSTAS COMERCIAIS
-- Status: Rascunho, Enviada, Visualizada, Em negociação, Aceita, Recusada, Expirada, Cancelada
CREATE TABLE IF NOT EXISTS proposals (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    proposal_number TEXT NOT NULL,
    public_token TEXT NOT NULL UNIQUE,
    opportunity_id TEXT,
    client_id TEXT,
    simulation_id TEXT,
    template_id TEXT,
    seller_user_id TEXT,
    current_version INTEGER NOT NULL DEFAULT 1,
    client_name TEXT NOT NULL,
    company_name TEXT NOT NULL,
    cpf_cnpj TEXT,
    contact_email TEXT,
    contact_whatsapp TEXT,
    plan_name TEXT,
    services_summary_json TEXT NOT NULL DEFAULT '[]',
    one_off_services_json TEXT NOT NULL DEFAULT '[]',
    monthly_fee_base REAL NOT NULL,
    discount_pct REAL NOT NULL DEFAULT 0.0,
    discount_amount REAL NOT NULL DEFAULT 0.0,
    monthly_fee_final REAL NOT NULL,
    setup_fee REAL NOT NULL DEFAULT 0.0,
    one_off_total REAL NOT NULL DEFAULT 0.0,
    payment_conditions TEXT NOT NULL,
    valid_until TEXT NOT NULL,
    cover_title TEXT,
    office_presentation TEXT,
    differentials_text TEXT,
    technical_scope_text TEXT,
    next_steps_text TEXT,
    custom_notes TEXT,
    status TEXT NOT NULL DEFAULT 'Rascunho' CHECK (
        status IN ('Rascunho', 'Enviada', 'Visualizada', 'Em negociação', 'Aceita', 'Recusada', 'Expirada', 'Cancelada')
    ),
    sent_at TEXT,
    viewed_at TEXT,
    accepted_at TEXT,
    accepted_by_name TEXT,
    accepted_by_document TEXT,
    accepted_by_role TEXT,
    accepted_by_email TEXT,
    accepted_ip TEXT,
    accepted_version INTEGER,
    accepted_terms_snapshot TEXT,
    rejected_reason TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- 15. VERSÕES HISTÓRICAS DAS PROPOSTAS
CREATE TABLE IF NOT EXISTS proposal_versions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    proposal_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    monthly_fee_base REAL NOT NULL,
    discount_pct REAL NOT NULL,
    monthly_fee_final REAL NOT NULL,
    setup_fee REAL NOT NULL,
    one_off_total REAL NOT NULL,
    snapshot_json TEXT NOT NULL,
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE
);

-- 16. EVENTOS DE ENVIO, VISUALIZAÇÃO E ACEITE DE PROPOSTA
CREATE TABLE IF NOT EXISTS proposal_events (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    proposal_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (
        event_type IN ('criada', 'nova_versao', 'enviada_email', 'enviada_whatsapp', 'pdf_gerado', 'visualizada', 'em_negociacao', 'aceita', 'recusada', 'falha_envio', 'status_alterado')
    ),
    channel TEXT,
    recipient TEXT,
    metadata_json TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE
);

-- 17. LOGS DE AUDITORIA E LGPD
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    user_id TEXT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    details_json TEXT DEFAULT '{}',
    ip_address TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- ÍNDICES PARA ISOLAMENTO MULTI-TENANT E PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_params_tenant ON parameter_versions(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_opps_tenant_stage ON opportunities(tenant_id, stage_id, status);
CREATE INDEX IF NOT EXISTS idx_sims_tenant ON simulations(tenant_id, opportunity_id);
CREATE INDEX IF NOT EXISTS idx_proposals_tenant ON proposals(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_proposals_token ON proposals(public_token);
CREATE INDEX IF NOT EXISTS idx_activities_tenant ON crm_activities(tenant_id, opportunity_id, completed);
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_logs(tenant_id, created_at);
