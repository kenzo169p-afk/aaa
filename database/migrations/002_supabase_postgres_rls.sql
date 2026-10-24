-- ============================================================================
-- MIGRATION 002: SCHEMA SUPABASE (PostgreSQL + Row Level Security RLS)
-- Plataforma SaaS Multi-Tenant de Precificação, Propostas e CRM Contábil
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Helper function para extrair o tenant_id do JWT autenticado no Supabase
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id',
    current_setting('app.current_tenant_id', true)
  );
$$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    current_setting('request.jwt.claims', true)::jsonb ->> 'role',
    current_setting('app.current_user_role', true)
  );
$$;

-- 1. ESCRITÓRIOS CONTÁBEIS (TENANTS)
CREATE TABLE IF NOT EXISTS public.tenants (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
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
    smtp_config_json JSONB DEFAULT '{}'::jsonb,
    integrations_json JSONB DEFAULT '{}'::jsonb,
    default_messages_json JSONB DEFAULT '{}'::jsonb,
    custom_diagnostic_questions_json JSONB DEFAULT '[]'::jsonb,
    lgpd_policy_version TEXT DEFAULT '1.0',
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. USUÁRIOS E PERMISSÕES (RBAC)
CREATE TABLE IF NOT EXISTS public.users (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin_plataforma', 'admin_escritorio', 'gestor_comercial', 'vendedor')),
    phone TEXT,
    max_discount_pct NUMERIC(5,2) DEFAULT 10.0,
    lgpd_consent_at TIMESTAMPTZ,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, email)
);

-- 3. PARÂMETROS VERSIONADOS POR ESCRITÓRIO
CREATE TABLE IF NOT EXISTS public.parameter_versions (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    version_label TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    fixed_cost_monthly NUMERIC(12,2) NOT NULL DEFAULT 28000.0,
    variable_cost_pct NUMERIC(5,2) NOT NULL DEFAULT 0.0,
    productive_hours_monthly NUMERIC(8,2) NOT NULL DEFAULT 320.0,
    target_margin_pct NUMERIC(6,2) NOT NULL DEFAULT 30.0,
    markup_factor NUMERIC(6,4) NOT NULL DEFAULT 1.30,
    minimum_fee_floor NUMERIC(12,2) NOT NULL DEFAULT 350.0,
    max_discount_seller_pct NUMERIC(5,2) NOT NULL DEFAULT 8.0,
    max_discount_manager_pct NUMERIC(5,2) NOT NULL DEFAULT 15.0,
    default_setup_fee NUMERIC(12,2) NOT NULL DEFAULT 0.0,
    hours_per_employee NUMERIC(6,2) NOT NULL DEFAULT 0.45,
    hours_per_partner NUMERIC(6,2) NOT NULL DEFAULT 0.35,
    hours_per_branch NUMERIC(6,2) NOT NULL DEFAULT 1.50,
    department_costs_json JSONB NOT NULL,
    regimes_json JSONB NOT NULL,
    activities_json JSONB NOT NULL,
    invoice_brackets_json JSONB NOT NULL,
    revenue_brackets_json JSONB NOT NULL,
    accessories_json JSONB NOT NULL,
    complexity_levels_json JSONB NOT NULL,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. PLANOS E SERVIÇOS
CREATE TABLE IF NOT EXISTS public.plans_services (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL CHECK (item_type IN ('plano', 'servico_recorrente', 'servico_avulso', 'implantacao')),
    code TEXT,
    name TEXT NOT NULL,
    description TEXT,
    department TEXT DEFAULT 'Contábil',
    estimated_hours NUMERIC(8,2) DEFAULT 0.0,
    base_price NUMERIC(12,2) DEFAULT 0.0,
    multiplier NUMERIC(6,3) DEFAULT 1.0,
    included_features_json JSONB DEFAULT '[]'::jsonb,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. CLIENTES E CONTATOS
CREATE TABLE IF NOT EXISTS public.clients (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
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
    monthly_revenue NUMERIC(14,2) DEFAULT 0.0,
    employees_count INTEGER DEFAULT 0,
    partners_count INTEGER DEFAULT 1,
    branches_count INTEGER DEFAULT 0,
    current_accountant TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. ETAPAS DO PIPELINE
CREATE TABLE IF NOT EXISTS public.pipeline_stages (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    stage_order INTEGER NOT NULL,
    color TEXT DEFAULT '#C9A227',
    win_probability INTEGER DEFAULT 10,
    is_won BOOLEAN DEFAULT FALSE,
    is_lost BOOLEAN DEFAULT FALSE
);

-- 7. MOTIVOS DE PERDA
CREATE TABLE IF NOT EXISTS public.loss_reasons (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE
);

-- 8. OPORTUNIDADES E LEADS (CRM)
CREATE TABLE IF NOT EXISTS public.opportunities (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    client_id TEXT REFERENCES public.clients(id) ON DELETE SET NULL,
    stage_id TEXT NOT NULL REFERENCES public.pipeline_stages(id),
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
    estimated_revenue NUMERIC(14,2) DEFAULT 50000.0,
    current_tax_regime TEXT DEFAULT 'simples',
    economic_activity TEXT DEFAULT 'servicos',
    employees_count INTEGER DEFAULT 2,
    partners_count INTEGER DEFAULT 1,
    branches_count INTEGER DEFAULT 0,
    invoice_volume_index INTEGER DEFAULT 1,
    current_accountant TEXT,
    expected_close_date TEXT,
    potential_monthly_value NUMERIC(12,2) DEFAULT 0.0,
    next_action TEXT,
    next_action_date TEXT,
    status TEXT DEFAULT 'aberta' CHECK (status IN ('aberta', 'ganha', 'perdida')),
    loss_reason_id TEXT,
    loss_notes TEXT,
    won_at TIMESTAMPTZ,
    lost_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. HISTÓRICO DE MOVIMENTAÇÕES DO PIPELINE
CREATE TABLE IF NOT EXISTS public.opportunity_stage_history (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    opportunity_id TEXT NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
    from_stage_id TEXT,
    to_stage_id TEXT NOT NULL,
    changed_by_user_id TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. DIAGNÓSTICO COMERCIAL CONTÁBIL
CREATE TABLE IF NOT EXISTS public.commercial_diagnostics (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    opportunity_id TEXT NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
    client_need TEXT,
    current_situation TEXT,
    tax_regime TEXT NOT NULL DEFAULT 'simples',
    economic_activity TEXT NOT NULL DEFAULT 'servicos',
    monthly_revenue NUMERIC(14,2) NOT NULL DEFAULT 50000.0,
    invoice_volume_index INTEGER NOT NULL DEFAULT 1,
    employees_count INTEGER NOT NULL DEFAULT 2,
    partners_count INTEGER NOT NULL DEFAULT 1,
    branches_count INTEGER NOT NULL DEFAULT 0,
    specific_obligations_json JSONB DEFAULT '{}'::jsonb,
    desired_services_json JSONB DEFAULT '{}'::jsonb,
    accountant_pains TEXT,
    urgency_level TEXT DEFAULT 'Média',
    operational_complexity TEXT DEFAULT 'padrao',
    custom_answers_json JSONB DEFAULT '{}'::jsonb,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. ATIVIDADES E FOLLOW-UPS
CREATE TABLE IF NOT EXISTS public.crm_activities (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    opportunity_id TEXT NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
    assigned_user_id TEXT,
    activity_type TEXT NOT NULL CHECK (activity_type IN ('tarefa', 'ligacao', 'reuniao', 'whatsapp', 'email', 'observacao', 'lembrete')),
    title TEXT NOT NULL,
    description TEXT,
    due_date TEXT,
    completed BOOLEAN DEFAULT FALSE,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. SIMULAÇÕES DA CALCULADORA
CREATE TABLE IF NOT EXISTS public.simulations (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    parameter_version_id TEXT NOT NULL REFERENCES public.parameter_versions(id),
    opportunity_id TEXT,
    client_id TEXT,
    title TEXT NOT NULL,
    client_name TEXT,
    company_name TEXT,
    cpf_cnpj TEXT,
    tax_regime TEXT NOT NULL,
    economic_activity TEXT NOT NULL,
    monthly_revenue NUMERIC(14,2) NOT NULL DEFAULT 0.0,
    employees_count INTEGER NOT NULL DEFAULT 0,
    partners_count INTEGER NOT NULL DEFAULT 1,
    branches_count INTEGER NOT NULL DEFAULT 0,
    invoice_volume_index INTEGER NOT NULL DEFAULT 0,
    operational_complexity TEXT NOT NULL DEFAULT 'padrao',
    selected_plan_id TEXT,
    selected_obligations_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    selected_one_off_services_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    selected_recurring_services_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    setup_fee NUMERIC(12,2) NOT NULL DEFAULT 0.0,
    discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0.0,
    intended_price NUMERIC(12,2) NOT NULL DEFAULT 0.0,
    cost_per_hour NUMERIC(12,2) NOT NULL,
    technical_hour_rate NUMERIC(12,2) NOT NULL,
    total_hours NUMERIC(8,2) NOT NULL,
    floor_cost NUMERIC(12,2) NOT NULL,
    recommended_fee NUMERIC(12,2) NOT NULL,
    final_monthly_fee NUMERIC(12,2) NOT NULL,
    total_one_off_fee NUMERIC(12,2) NOT NULL DEFAULT 0.0,
    viability_status TEXT,
    calculation_breakdown_json JSONB NOT NULL,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 13. MODELOS DE PROPOSTA
CREATE TABLE IF NOT EXISTS public.proposal_templates (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_default BOOLEAN DEFAULT FALSE,
    cover_title TEXT NOT NULL,
    office_presentation TEXT NOT NULL,
    differentials_text TEXT NOT NULL,
    scope_template TEXT NOT NULL,
    investment_notes TEXT NOT NULL,
    next_steps_text TEXT NOT NULL,
    payment_terms_default TEXT NOT NULL,
    validity_days_default INTEGER DEFAULT 10,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 14. PROPOSTAS COMERCIAIS
CREATE TABLE IF NOT EXISTS public.proposals (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
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
    services_summary_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    one_off_services_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    monthly_fee_base NUMERIC(12,2) NOT NULL,
    discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0.0,
    discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0.0,
    monthly_fee_final NUMERIC(12,2) NOT NULL,
    setup_fee NUMERIC(12,2) NOT NULL DEFAULT 0.0,
    one_off_total NUMERIC(12,2) NOT NULL DEFAULT 0.0,
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
    sent_at TIMESTAMPTZ,
    viewed_at TIMESTAMPTZ,
    accepted_at TIMESTAMPTZ,
    accepted_by_name TEXT,
    accepted_by_document TEXT,
    accepted_by_role TEXT,
    accepted_by_email TEXT,
    accepted_ip TEXT,
    accepted_version INTEGER,
    accepted_terms_snapshot TEXT,
    rejected_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 15. VERSÕES DE PROPOSTAS
CREATE TABLE IF NOT EXISTS public.proposal_versions (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    proposal_id TEXT NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    monthly_fee_base NUMERIC(12,2) NOT NULL,
    discount_pct NUMERIC(5,2) NOT NULL,
    monthly_fee_final NUMERIC(12,2) NOT NULL,
    setup_fee NUMERIC(12,2) NOT NULL,
    one_off_total NUMERIC(12,2) NOT NULL,
    snapshot_json JSONB NOT NULL,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 16. EVENTOS DE PROPOSTA
CREATE TABLE IF NOT EXISTS public.proposal_events (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    proposal_id TEXT NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    channel TEXT,
    recipient TEXT,
    metadata_json JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 17. LOGS DE AUDITORIA E LGPD
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    tenant_id TEXT NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_id TEXT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    details_json JSONB DEFAULT '{}'::jsonb,
    ip_address TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- POLÍTICAS DE ROW-LEVEL SECURITY (RLS) PARA ISOLAMENTO MULTI-TENANT SUPABASE
-- ============================================================================
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parameter_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loss_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opportunity_stage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commercial_diagnostics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.simulations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposal_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposal_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposal_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_tenants ON public.tenants
    USING (id = public.current_tenant_id() OR public.current_user_role() = 'admin_plataforma');

CREATE POLICY tenant_isolation_users ON public.users
    USING (tenant_id = public.current_tenant_id() OR public.current_user_role() = 'admin_plataforma');

CREATE POLICY tenant_isolation_params ON public.parameter_versions
    USING (tenant_id = public.current_tenant_id() OR public.current_user_role() = 'admin_plataforma');

CREATE POLICY tenant_isolation_plans ON public.plans_services
    USING (tenant_id = public.current_tenant_id() OR public.current_user_role() = 'admin_plataforma');

CREATE POLICY tenant_isolation_clients ON public.clients
    USING (tenant_id = public.current_tenant_id() OR public.current_user_role() = 'admin_plataforma');

CREATE POLICY tenant_isolation_stages ON public.pipeline_stages
    USING (tenant_id = public.current_tenant_id() OR public.current_user_role() = 'admin_plataforma');

CREATE POLICY tenant_isolation_loss ON public.loss_reasons
    USING (tenant_id = public.current_tenant_id() OR public.current_user_role() = 'admin_plataforma');

CREATE POLICY tenant_isolation_opps ON public.opportunities
    USING (tenant_id = public.current_tenant_id() OR public.current_user_role() = 'admin_plataforma');

CREATE POLICY tenant_isolation_opp_hist ON public.opportunity_stage_history
    USING (tenant_id = public.current_tenant_id() OR public.current_user_role() = 'admin_plataforma');

CREATE POLICY tenant_isolation_diag ON public.commercial_diagnostics
    USING (tenant_id = public.current_tenant_id() OR public.current_user_role() = 'admin_plataforma');

CREATE POLICY tenant_isolation_activities ON public.crm_activities
    USING (tenant_id = public.current_tenant_id() OR public.current_user_role() = 'admin_plataforma');

CREATE POLICY tenant_isolation_sims ON public.simulations
    USING (tenant_id = public.current_tenant_id() OR public.current_user_role() = 'admin_plataforma');

CREATE POLICY tenant_isolation_templates ON public.proposal_templates
    USING (tenant_id = public.current_tenant_id() OR public.current_user_role() = 'admin_plataforma');

CREATE POLICY tenant_isolation_proposals ON public.proposals
    USING (tenant_id = public.current_tenant_id() OR public.current_user_role() = 'admin_plataforma');

CREATE POLICY tenant_isolation_prop_versions ON public.proposal_versions
    USING (tenant_id = public.current_tenant_id() OR public.current_user_role() = 'admin_plataforma');

CREATE POLICY tenant_isolation_prop_events ON public.proposal_events
    USING (tenant_id = public.current_tenant_id() OR public.current_user_role() = 'admin_plataforma');

CREATE POLICY tenant_isolation_audit ON public.audit_logs
    USING (tenant_id = public.current_tenant_id() OR public.current_user_role() = 'admin_plataforma');
