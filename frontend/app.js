/**
 * Plataforma SaaS de Precificação, Propostas Comerciais e CRM Contábil
 * Versão Híbrida Estável: Roda no GitHub Pages (100% Browser Engine) e em Servidor Backend (Python/C#/SQLite/Supabase/PHP)
 * Com Adaptação Dinâmica de Tela (Ultrawide, Desktop, Notebook, Tablet e Smartphone)
 */

const HELP_TEXTS = {
  custoFixo: "Some TODOS os custos fixos do escritório no mês, independentemente de quantos clientes você atende: salários e encargos da equipe, pró-labore dos sócios, aluguel, energia, internet, telefonia, softwares, contador responsável técnico, material e depreciação.",
  horasProdutivas: "Horas efetivamente PRODUTIVAS (faturáveis) que a equipe entrega por mês. Ex.: 2 pessoas x ~160h = 320h. Desconte férias, feriados, reuniões internas e ociosidade.",
  margem: "Percentual de lucro que você quer obter ACIMA do custo da hora. Remunera o risco do negócio, a responsabilidade técnica e o reinvestimento no escritório.",
  regime: "Regime de apuração do cliente — o maior fator de tempo e complexidade (MEI, Simples Nacional, Lucro Presumido ou Lucro Real).",
  atividade: "Natureza econômica predominante do cliente (Comércio, Serviços ou Indústria).",
  faturamento: "Receita bruta média mensal do cliente para dimensionar movimento, exposição a risco e volume esperado de operações.",
  funcionarios: "Número de empregados com vínculo (CLT) do cliente (folha, eSocial, FGTS, guias, férias, 13º, rescisões e DCTFWeb).",
  socios: "Número de sócios da empresa do cliente (controle de pró-labore, retenção de INSS e distribuição de lucros).",
  filiais: "Quantidade de estabelecimentos ALÉM da matriz (filiais) e/ou inscrições estaduais adicionais.",
  volume: "Faixa aproximada de notas fiscais (entradas + saídas) e lançamentos que o cliente movimenta por mês.",
  obrigacoes: "Declarações/obrigações que este cliente exige além do padrão do regime (EFD-Contribuições, EFD-Reinf, ECD, ECF, DCTFWeb, ICMS-ST, Comex).",
  avulsos: "Serviços de cobrança ÚNICA (não recorrentes), faturados à parte da mensalidade conforme Res. CFC 1.590/2020.",
  precoPretendido: "Valor mensal que você pretende cobrar para checagem automática contra o piso de custo (prevenção de aviltamento NBC PG 01, art. 8)."
};

const STATE = {
  activeNav: "calculadora",
  uiTheme: localStorage.getItem("saas_contabil_ui_theme") || "clean", // 'clean' (Azul, Branco e Cinza) | 'dark'
  paramSubTab: "todos", // 'todos' | 'operacional' | 'margem' | 'departamentos' | 'planos' | 'versoes'
  paramDirty: false,
  calcStep: "todos", // 'todos' | 'dados' | 'servicos' | 'custos' | 'resultado'
  propostasViewMode: "ambos", // 'ambos' | 'tabela' | 'cards'
  propostasFilter: {
    q: "",
    status: "",
    cols: { doc: true, contato: true, mensal: true, implantacao: true, validade: true, versao: true }
  },
  crmSubTab: "kanban",
  crmViewMode: "kanban", // 'kanban' | 'lista'
  crmFilter: { q: "", stage: "", seller: "", regime: "" },
  drawerOppId: "",
  sidebarCollapsed: window.innerWidth < 1150,
  userToggledSidebar: false,
  runtimeMode: "detecting", // 'server_api' | 'browser_pages'
  screenProfile: { label: "Desktop", width: window.innerWidth, height: window.innerHeight },
  publicProposalToken: new URLSearchParams(window.location.search).get("proposta") || "",
  token: localStorage.getItem("saas_contabil_token") || "",
  tenantId: localStorage.getItem("saas_contabil_tenant") || "tenant_alpha",
  currentUser: null,
  tenant: null,
  tenants: [],
  switchableAccounts: [],
  parameters: null,
  simulations: [],
  proposals: [],
  templates: [],
  crm: {
    stages: [],
    opportunities: [],
    lossReasons: [],
    activities: [],
    sellers: []
  },
  dashboard: null,
  dashboardFilters: { days: "90", seller: "", origin: "" },
  settingsData: null,
  selectedDiagnosticOppId: "",
  currentDiagnostic: null,

  calc: {
    id: null,
    opportunityId: "",
    clientId: "",
    title: "Simulação de Honorários",
    clientName: "",
    companyName: "",
    cpfCnpj: "",
    contactEmail: "",
    contactWhatsapp: "",
    custoFixo: 28000,
    horasProdutivas: 320,
    margem: 30,
    regime: "simples",
    atividade: "servicos",
    faturamento: 50000,
    funcionarios: 2,
    socios: 1,
    filiais: 0,
    volume: 1,
    complexidade: "padrao",
    selectedPlanId: "",
    servicosRecorrentesIds: [],
    obrigacoes: {},
    avulsos: {},
    taxaImplantacao: 450,
    descontoPct: 0,
    precoPretendido: 0
  },
  calcResult: null
};

const fmtBRL0 = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const fmtBRL2 = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showToast(msg, isError = false) {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();
  const el = document.createElement("div");
  el.className = "toast";
  if (isError) el.style.borderColor = "#DC2626";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3600);
}

/**
 * Detector Dinâmico da Tela e Dispositivo onde o programa está sendo rodado
 */
function detectScreenProfile() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  let label = "🖥️ Desktop";
  if (w >= 1650) label = "🖥️ Ultrawide";
  else if (w >= 1200) label = "💻 Desktop";
  else if (w >= 960) label = "💻 Notebook";
  else if (w >= 769) label = "📱 Tablet";
  else label = "📱 Mobile";

  STATE.screenProfile = { label: `${label} (${w}×${h})`, width: w, height: h };

  if (!STATE.userToggledSidebar) {
    const shouldCollapse = w < 1160 && w > 768;
    if (STATE.sidebarCollapsed !== shouldCollapse) {
      STATE.sidebarCollapsed = shouldCollapse;
    }
  }
}

window.addEventListener("resize", () => {
  const prevCollapsed = STATE.sidebarCollapsed;
  detectScreenProfile();
  const badge = document.getElementById("live-screen-badge");
  if (badge) badge.textContent = STATE.screenProfile.label;
  if (prevCollapsed !== STATE.sidebarCollapsed) {
    const shell = document.querySelector(".saas-shell");
    if (shell) shell.classList.toggle("collapsed", STATE.sidebarCollapsed);
  }
});

/**
 * Roteador Híbrido Multi-Ambiente (Hostinger VPS + GitHub Pages + Local):
 * - Em Hostinger VPS (HTTP/HTTPS portas 80, 443, 8080, 8090 ou domínio próprio): conecta automaticamente à API Backend Python/SQLite/PostgreSQL.
 * - No GitHub Pages (*.github.io) ou arquivo local (file://): roda 100% em memória (0ms) via Browser Engine.
 */
async function apiFetch(path, options = {}) {
  const isStaticOnlyHost =
    window.location.hostname.endsWith("github.io") ||
    window.location.protocol === "file:";

  const useLocalEngineDirectly =
    isStaticOnlyHost || STATE.runtimeMode === "browser_pages";

  if (!useLocalEngineDirectly) {
    try {
      const headers = {
        "Content-Type": "application/json",
        "X-Tenant-ID": STATE.tenantId,
        ...(options.headers || {})
      };
      if (STATE.token) {
        headers["Authorization"] = `Bearer ${STATE.token}`;
      }
      const controller = new AbortController();
      const timeoutMs = STATE.runtimeMode === "server_api" ? 4000 : 900;
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const resp = await fetch(path, { ...options, headers, signal: controller.signal });
      clearTimeout(timeoutId);
      const contentType = resp.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || `Erro HTTP ${resp.status}`);
        STATE.runtimeMode = "server_api";
        return data;
      }
    } catch (err) {
      if (STATE.runtimeMode === "server_api" && err.message && !err.message.includes("Failed to fetch") && err.name !== "AbortError") {
        throw err;
      }
      STATE.runtimeMode = "browser_pages";
    }
  }

  STATE.runtimeMode = "browser_pages";
  return await handleBrowserApiRequest(path, options, STATE.tenantId);
}

function applyTenantTheme(tenant) {
  if (STATE.uiTheme === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  if (!tenant) return;
  const rawColor = (tenant.primary_color || "").toUpperCase();
  const isDefaultLegacyGold = !rawColor || rawColor === "#C9A227" || rawColor === "#E5A93C";
  const defaultPaletteColor = STATE.uiTheme === "dark" ? "#3B82F6" : "#1D4ED8";
  const primary = isDefaultLegacyGold ? defaultPaletteColor : tenant.primary_color;
  document.documentElement.style.setProperty("--gold", primary);
  document.documentElement.style.setProperty("--gold-soft", primary);
}

function toggleUiTheme() {
  STATE.uiTheme = STATE.uiTheme === "dark" ? "clean" : "dark";
  localStorage.setItem("saas_contabil_ui_theme", STATE.uiTheme);
  applyTenantTheme(STATE.tenant);
  renderApp(true);
  showToast(STATE.uiTheme === "clean" ? "Tema Clean (Azul, Branco e Cinza) ativado!" : "Tema Executivo Escuro ativado!");
}

/* =========================================================================
   INICIALIZAÇÃO E CARREGAMENTO DE DADOS
   ========================================================================= */
async function bootstrapApp() {
  detectScreenProfile();

  if (STATE.publicProposalToken) {
    renderPublicProposalStandaloneView(STATE.publicProposalToken);
    return;
  }

  try {
    const boot = await apiFetch("/api/bootstrap");
    STATE.currentUser = boot.currentUser;
    STATE.tenant = boot.tenant;
    STATE.tenants = boot.tenants || [];
    STATE.switchableAccounts = boot.switchableAccounts || [];
    STATE.tenantId = boot.tenant.id;
    applyTenantTheme(STATE.tenant);

    await Promise.all([
      loadParameters(),
      loadSimulations(),
      loadProposals(),
      loadCRMPipeline()
    ]);

    if (STATE.parameters && STATE.parameters.activeVersion) {
      const pv = STATE.parameters.activeVersion;
      STATE.calc.custoFixo = pv.fixed_cost_monthly;
      STATE.calc.horasProdutivas = pv.productive_hours_monthly;
      STATE.calc.margem = pv.target_margin_pct;
      STATE.calc.taxaImplantacao = pv.default_setup_fee;
    }

    runCalculationSync();
    renderApp(true);
  } catch (err) {
    showToast("Erro ao inicializar plataforma: " + err.message, true);
  }
}

async function loadParameters() {
  const res = await apiFetch("/api/parameters");
  STATE.parameters = res;
}

async function loadSimulations() {
  const res = await apiFetch("/api/simulations");
  STATE.simulations = res.simulations || [];
}

async function loadProposals() {
  const res = await apiFetch("/api/proposals");
  STATE.proposals = res.proposals || [];
  STATE.templates = res.templates || [];
}

async function loadCRMPipeline() {
  const res = await apiFetch("/api/crm/pipeline");
  STATE.crm.stages = res.stages || [];
  STATE.crm.opportunities = res.opportunities || [];
  STATE.crm.lossReasons = res.lossReasons || [];
  STATE.crm.activities = res.activities || [];
  STATE.crm.sellers = res.sellers || [];
  if (!STATE.selectedDiagnosticOppId && STATE.crm.opportunities.length > 0) {
    STATE.selectedDiagnosticOppId = STATE.crm.opportunities[0].id;
  }
}

async function loadCRMDashboard() {
  const q = new URLSearchParams(STATE.dashboardFilters).toString();
  const res = await apiFetch(`/api/crm/dashboard?${q}`);
  STATE.dashboard = res;
}

async function loadSettings() {
  const res = await apiFetch("/api/settings");
  STATE.settingsData = res;
}

/**
 * Cálculo Síncrono Instantâneo (< 0.05ms em RAM) — Zero travamento de interface
 */
function runCalculationSync() {
  if (typeof calculateHonorariosBrowser === "function") {
    const pv = STATE.parameters?.activeVersion || null;
    const ps = STATE.parameters?.plansServices || [];
    const maxDisc = STATE.currentUser?.max_discount_pct ?? 15;
    STATE.calcResult = calculateHonorariosBrowser(STATE.calc, pv, ps, maxDisc);
    return STATE.calcResult;
  }
  return STATE.calcResult;
}

async function runCalculation(verifyWithCSharp = false) {
  if (!verifyWithCSharp && typeof calculateHonorariosBrowser === "function") {
    return runCalculationSync();
  }
  const res = await apiFetch("/api/calculator/calculate", {
    method: "POST",
    body: JSON.stringify({ ...STATE.calc, verifyWithCSharp })
  });
  STATE.calcResult = res.result;
  return res.result;
}

/* =========================================================================
   NAVEGAÇÃO E SHELL PRINCIPAL (MENU LATERAL ESQUERDO + BARRA MOBILE)
   ========================================================================= */
async function navigateTo(navKey, subTab = null) {
  STATE.activeNav = navKey;
  if (subTab) STATE.crmSubTab = subTab;
  if (navKey === "crm" && STATE.crmSubTab === "indicadores") {
    await loadCRMDashboard();
  }
  if (navKey === "crm" && STATE.crmSubTab === "diagnostico" && STATE.selectedDiagnosticOppId) {
    await fetchOpportunityDiagnostic(STATE.selectedDiagnosticOppId);
  }
  if (navKey === "configuracoes") {
    await loadSettings();
  }
  renderApp();
  window.scrollTo({ top: 0, behavior: "instant" });
}

function toggleSidebar() {
  STATE.userToggledSidebar = true;
  STATE.sidebarCollapsed = !STATE.sidebarCollapsed;
  const shell = document.getElementById("saas-shell-root");
  const btn = document.getElementById("sidebar-toggle-btn");
  if (shell) {
    shell.classList.toggle("collapsed", STATE.sidebarCollapsed);
    if (btn) btn.textContent = STATE.sidebarCollapsed ? "»" : "«";
    return;
  }
  renderApp(true);
}

async function switchUserAccount(userId) {
  try {
    const res = await apiFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ user_id: userId })
    });
    STATE.token = res.token;
    STATE.tenantId = res.user.tenant_id;
    localStorage.setItem("saas_contabil_token", STATE.token);
    localStorage.setItem("saas_contabil_tenant", STATE.tenantId);
    showToast(`Sessão alterada para: ${res.user.name} (${res.user.role})`);
    await bootstrapApp();
  } catch (err) {
    showToast(err.message, true);
  }
}

function getPageHeaderMeta() {
  const map = {
    parametros: {
      breadcrumb: "Parâmetros de Precificação",
      title: "Parâmetros de Precificação",
      sub: "Central de custos, hora técnica, departamentos, regimes, planos e versionamento por escritório",
      quickLabel: "+ Novo Serviço/Plano",
      quickAction: "novo_servico"
    },
    calculadora: {
      breadcrumb: "Calculadora de Honorários",
      title: "Calculadora de Honorários Contábeis",
      sub: "Motor de cálculo conforme NBC PG 01 e Res. CFC 1.590/2020 integrado ao CRM e Propostas",
      quickLabel: "🚀 Gerar Proposta",
      quickAction: "gerar_proposta"
    },
    propostas: {
      breadcrumb: "Propostas Comerciais",
      title: "Propostas Comerciais",
      sub: "Editor personalizado, identidade visual, envio por E-mail/WhatsApp, PDF, link seguro e aceite comercial",
      quickLabel: "+ Nova Proposta",
      quickAction: "nova_proposta"
    },
    crm: {
      breadcrumb: "CRM de Vendas Contábil",
      title: "CRM de Vendas — Especializado em Contabilidade",
      sub: "Pipeline Kanban & Lista, Diagnóstico Contábil, Atividades/Follow-ups e Indicadores Comerciais (MRR)",
      quickLabel: "+ Novo Lead",
      quickAction: "novo_lead"
    },
    configuracoes: {
      breadcrumb: "Configurações & Multi-Tenant",
      title: "Configurações do Escritório & Multi-Tenant",
      sub: "Identidade visual, usuários e permissões (RBAC), modelos, integrações Supabase/Webhook e auditoria LGPD",
      quickLabel: "+ Novo Escritório",
      quickAction: "novo_tenant"
    }
  };
  return map[STATE.activeNav] || map.calculadora;
}

function triggerHeaderQuickAction(actionKey) {
  if (actionKey === "novo_servico") openNewPlanServiceModal();
  else if (actionKey === "gerar_proposta") convertSimulationToProposal();
  else if (actionKey === "nova_proposta") navigateTo("calculadora");
  else if (actionKey === "novo_lead") openNewLeadModal();
  else if (actionKey === "novo_tenant") openNewTenantModal();
}

function handleGlobalSearchInput(val) {
  const box = document.getElementById("global-search-dropdown");
  if (!box) return;
  const q = (val || "").trim().toLowerCase();
  if (!q) {
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }

  const results = [];
  STATE.crm.opportunities.forEach((op) => {
    if (
      (op.company_name || "").toLowerCase().includes(q) ||
      (op.contact_name || "").toLowerCase().includes(q) ||
      (op.cpf_cnpj || "").toLowerCase().includes(q)
    ) {
      results.push({
        badge: "CRM Lead",
        title: `${op.company_name} (${op.contact_name})`,
        sub: `${fmtBRL0(op.potential_monthly_value)}/mês · ${op.current_tax_regime || "simples"}`,
        onclick: `closeGlobalSearch();navigateTo('crm','kanban');setTimeout(()=>openLeadDrawer('${op.id}'),60)`
      });
    }
  });

  STATE.proposals.forEach((p) => {
    if (
      (p.company_name || "").toLowerCase().includes(q) ||
      (p.client_name || "").toLowerCase().includes(q) ||
      (p.proposal_number || "").toLowerCase().includes(q)
    ) {
      results.push({
        badge: `Proposta ${p.status}`,
        title: `${p.proposal_number} — ${p.company_name}`,
        sub: `${fmtBRL2(p.monthly_fee_final)}/mês · v${p.current_version}`,
        onclick: `closeGlobalSearch();navigateTo('propostas')`
      });
    }
  });

  const modules = [
    { key: "parametros", label: "Parâmetros (Custos, Margem, Markup, Regimes, Planos)" },
    { key: "calculadora", label: "Calculadora de Honorários (NBC PG 01)" },
    { key: "propostas", label: "Propostas Comerciais (PDF, Link, Aceite)" },
    { key: "crm", label: "CRM de Vendas (Kanban, Lista, Diagnóstico, MRR)" },
    { key: "configuracoes", label: "Configurações do Escritório & Usuários" }
  ];
  modules.forEach((m) => {
    if (m.label.toLowerCase().includes(q)) {
      results.push({
        badge: "Módulo",
        title: m.label,
        sub: "Ir para módulo do sistema",
        onclick: `closeGlobalSearch();navigateTo('${m.key}')`
      });
    }
  });

  if (results.length === 0) {
    box.innerHTML = `<div style="padding:12px;font-size:12.5px;color:var(--muted)">Nenhum cliente, lead ou proposta encontrado para "${escapeHtml(val)}".</div>`;
  } else {
    box.innerHTML = results
      .slice(0, 8)
      .map(
        (r) => `
        <div onclick="${r.onclick}" style="padding:9px 12px;border-bottom:1px solid var(--line);cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:10px" onmouseover="this.style.background='var(--gold-bg)'" onmouseout="this.style.background='transparent'">
          <div>
            <strong style="font-size:13px;display:block;color:var(--cream)">${escapeHtml(r.title)}</strong>
            <span style="font-size:11.5px;color:var(--muted)">${escapeHtml(r.sub)}</span>
          </div>
          <span class="tag tag-gold">${escapeHtml(r.badge)}</span>
        </div>
      `
      )
      .join("");
  }
  box.style.display = "block";
}

function closeGlobalSearch() {
  const box = document.getElementById("global-search-dropdown");
  const inp = document.getElementById("global-search-input");
  if (box) box.style.display = "none";
  if (inp) inp.value = "";
}

function getRootContainer() {
  let el = document.getElementById("root") || document.getElementById("app");
  if (!el) {
    el = document.createElement("div");
    el.id = "root";
    document.body.prepend(el);
  }
  return el;
}

function renderApp(forceFullShell = false) {
  const root = getRootContainer();
  if (!STATE.tenant) {
    root.innerHTML = `<div style="padding:40px;text-align:center">Carregando plataforma SaaS Contábil...</div>`;
    return;
  }

  const meta = getPageHeaderMeta();
  const openOppsCount = STATE.crm.opportunities.filter((o) => o.status === "aberta").length;
  const propsCount = STATE.proposals.length;
  const paramVer = STATE.parameters?.activeVersion?.version_number || 1;

  let mainContentHtml = "";
  if (STATE.activeNav === "parametros") mainContentHtml = renderParametrosView();
  else if (STATE.activeNav === "calculadora") mainContentHtml = renderCalculadoraView();
  else if (STATE.activeNav === "propostas") mainContentHtml = renderPropostasView();
  else if (STATE.activeNav === "crm") mainContentHtml = renderCRMView();
  else if (STATE.activeNav === "configuracoes") mainContentHtml = renderConfiguracoesView();

  const existingMain = document.getElementById("page-main-content");
  const sameContext =
    !forceFullShell &&
    existingMain &&
    root.dataset.tenantId === String(STATE.tenant.id) &&
    root.dataset.userId === String(STATE.currentUser?.user_id || "");

  if (sameContext) {
    existingMain.innerHTML = mainContentHtml;
    const bcEl = document.getElementById("topbar-breadcrumb-current");
    const titleEl = document.getElementById("topbar-page-title");
    const subEl = document.getElementById("topbar-page-sub");
    const qaBtn = document.getElementById("topbar-quick-action-btn");
    if (bcEl) bcEl.textContent = meta.breadcrumb;
    if (titleEl) titleEl.textContent = meta.title;
    if (subEl) subEl.textContent = meta.sub;
    if (qaBtn) {
      qaBtn.textContent = meta.quickLabel;
      qaBtn.setAttribute("onclick", `triggerHeaderQuickAction('${meta.quickAction}')`);
    }

    const bVer = document.getElementById("badge-param-ver");
    const bProps = document.getElementById("badge-props-count");
    const bCrm = document.getElementById("badge-crm-count");
    if (bVer) bVer.textContent = `v${paramVer}`;
    if (bProps) bProps.textContent = String(propsCount);
    if (bCrm) bCrm.textContent = String(openOppsCount);

    document.querySelectorAll("[data-nav-key]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-nav-key") === STATE.activeNav);
    });
    return;
  }

  root.dataset.tenantId = String(STATE.tenant.id);
  root.dataset.userId = String(STATE.currentUser?.user_id || "");

  const initials = (STATE.tenant.trade_name || STATE.tenant.name || "EC")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  root.innerHTML = `
    <div id="saas-shell-root" class="saas-shell ${STATE.sidebarCollapsed ? "collapsed" : ""}">
      <!-- MENU LATERAL ESQUERDO FIXO E RECOLHÍVEL NA ORDEM EXATA SOLICITADA -->
      <aside class="sidebar">
        <div class="sidebar-brand">
          <div class="brand-left">
            <div class="brand-logo">${escapeHtml(initials)}</div>
            <div class="brand-texts">
              <span class="brand-title">${escapeHtml(STATE.tenant.trade_name || STATE.tenant.name)}</span>
              <span class="brand-sub">${escapeHtml(STATE.tenant.crc_registration || "SaaS Contábil")}</span>
            </div>
          </div>
          <button id="sidebar-toggle-btn" class="sidebar-toggle" onclick="toggleSidebar()" title="Recolher / Expandir menu">
            ${STATE.sidebarCollapsed ? "»" : "«"}
          </button>
        </div>

        <nav class="sidebar-nav" aria-label="Menu Principal">
          <button data-nav-key="parametros" class="nav-item ${STATE.activeNav === "parametros" ? "active" : ""}" onclick="navigateTo('parametros')">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>
            <span class="nav-label">Parâmetros</span>
            <span id="badge-param-ver" class="nav-badge">v${paramVer}</span>
          </button>

          <button data-nav-key="calculadora" class="nav-item ${STATE.activeNav === "calculadora" ? "active" : ""}" onclick="navigateTo('calculadora')">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="16" y1="14" x2="16" y2="18"/><path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M12 14h.01"/><path d="M8 14h.01"/><path d="M12 18h.01"/><path d="M8 18h.01"/></svg>
            <span class="nav-label">Calculadora</span>
          </button>

          <button data-nav-key="propostas" class="nav-item ${STATE.activeNav === "propostas" ? "active" : ""}" onclick="navigateTo('propostas')">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            <span class="nav-label">Propostas</span>
            <span id="badge-props-count" class="nav-badge">${propsCount}</span>
          </button>

          <button data-nav-key="crm" class="nav-item ${STATE.activeNav === "crm" ? "active" : ""}" onclick="navigateTo('crm')">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 7h3v10H7z"/><path d="M14 7h3v6h-3z"/></svg>
            <span class="nav-label">CRM de Vendas</span>
            <span id="badge-crm-count" class="nav-badge">${openOppsCount}</span>
          </button>
        </nav>

        <!-- NA PARTE INFERIOR: CONFIGURAÇÕES -->
        <div class="sidebar-footer">
          <button data-nav-key="configuracoes" class="nav-item ${STATE.activeNav === "configuracoes" ? "active" : ""}" onclick="navigateTo('configuracoes')">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            <span class="nav-label">Configurações</span>
          </button>
        </div>
      </aside>

      <!-- CONTEÚDO PRINCIPAL -->
      <div class="main-area">
        <header class="topbar">
          <div class="topbar-left">
            <div>
              <div style="font-size:11.5px;color:var(--muted);margin-bottom:2px;display:flex;align-items:center;gap:6px">
                <span>${escapeHtml(STATE.tenant.trade_name || STATE.tenant.name)}</span>
                <span>›</span>
                <strong id="topbar-breadcrumb-current" style="color:var(--gold)">${escapeHtml(meta.breadcrumb)}</strong>
              </div>
              <h1 id="topbar-page-title" class="page-title">${escapeHtml(meta.title)}</h1>
              <p id="topbar-page-sub" class="page-subtitle">${escapeHtml(meta.sub)}</p>
            </div>
          </div>

          <!-- BUSCA RÁPIDA GLOBAL (PLANO UX SEÇÃO 3) -->
          <div class="topbar-search-wrap" style="position:relative">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--muted);flex-shrink:0"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              id="global-search-input"
              type="text"
              placeholder="Buscar cliente, lead, proposta ou tela..."
              oninput="handleGlobalSearchInput(this.value)"
              onblur="setTimeout(closeGlobalSearch, 220)"
            />
            <div id="global-search-dropdown" style="display:none;position:absolute;top:calc(100% + 6px);left:0;right:0;background:var(--navy-2);border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow);z-index:250;max-height:320px;overflow-y:auto"></div>
          </div>

          <div class="topbar-right">
            <button id="topbar-quick-action-btn" class="btn-primary" style="padding:7px 12px;font-size:12px" onclick="triggerHeaderQuickAction('${meta.quickAction}')">
              ${escapeHtml(meta.quickLabel)}
            </button>
            <button class="btn-secondary" style="padding:7px 11px;font-size:12px" onclick="toggleUiTheme()" title="Alternar entre Paleta Clean (Azul, Branco e Cinza) e Tema Escuro">
              ${STATE.uiTheme === "dark" ? "☀️ Clean Azul/Branco" : "🌙 Escuro"}
            </button>
            <span class="screen-badge" id="live-screen-badge" title="Adaptação automática ao tamanho de tela do dispositivo">
              ${escapeHtml(STATE.screenProfile.label)}
            </span>
            <div class="context-pill" title="Alternar Escritório (Multi-Tenant) ou Perfil de Acesso (RBAC)">
              <span style="color:var(--muted)">Escritório:</span>
              <select onchange="switchUserAccount(this.value)">
                ${STATE.switchableAccounts
                  .map(
                    (acc) => `
                  <option value="${acc.id}" ${acc.id === STATE.currentUser?.user_id ? "selected" : ""}>
                    [${escapeHtml(acc.tenant_name)}] ${escapeHtml(acc.name)} (${escapeHtml(acc.role)})
                  </option>
                `
                  )
                  .join("")}
              </select>
            </div>
            <span class="role-badge">Alçada: ${STATE.currentUser?.max_discount_pct || 10}%</span>
            <a class="btn-secondary" href="./Calculadora_de_Honorarios.xlsx" download="Calculadora_de_Honorarios.xlsx">
              📊 Planilha Excel
            </a>
          </div>
        </header>

        <main id="page-main-content" class="page-container">
          ${mainContentHtml}
        </main>
      </div>

      <!-- NAVEGAÇÃO INFERIOR ADAPTATIVA PARA TELAS MOBILE / TOUCH -->
      <nav class="mobile-bottom-nav" aria-label="Menu Mobile">
        <button data-nav-key="parametros" class="mobile-nav-btn ${STATE.activeNav === "parametros" ? "active" : ""}" onclick="navigateTo('parametros')">
          <span>⚙️</span><span>Parâmetros</span>
        </button>
        <button data-nav-key="calculadora" class="mobile-nav-btn ${STATE.activeNav === "calculadora" ? "active" : ""}" onclick="navigateTo('calculadora')">
          <span>🧮</span><span>Calculadora</span>
        </button>
        <button data-nav-key="propostas" class="mobile-nav-btn ${STATE.activeNav === "propostas" ? "active" : ""}" onclick="navigateTo('propostas')">
          <span>📄</span><span>Propostas (${propsCount})</span>
        </button>
        <button data-nav-key="crm" class="mobile-nav-btn ${STATE.activeNav === "crm" ? "active" : ""}" onclick="navigateTo('crm')">
          <span>📊</span><span>CRM (${openOppsCount})</span>
        </button>
        <button data-nav-key="configuracoes" class="mobile-nav-btn ${STATE.activeNav === "configuracoes" ? "active" : ""}" onclick="navigateTo('configuracoes')">
          <span>🔧</span><span>Config.</span>
        </button>
      </nav>
    </div>
    <div id="modal-container"></div>
    <div id="drawer-container"></div>
  `;
}

/* =========================================================================
   1. MÓDULO DE PARÂMETROS (CENTRALIZAÇÃO E VERSIONAMENTO POR ESCRITÓRIO)
      SEÇÃO 5.1 DO PLANO UX/UI: ABAS INTERNAS, EXPLICAÇÃO MARGEM VS MARKUP,
      INDICADOR DE ALTERAÇÕES NÃO SALVAS E AÇÃO PREVISÍVEL DE SALVAR/CANCELAR
   ========================================================================= */
function setParamSubTab(tabKey) {
  STATE.paramSubTab = tabKey;
  renderApp();
}

function markParamDirty() {
  STATE.paramDirty = true;
  const bar = document.getElementById("param-sticky-save-bar");
  const badge = document.getElementById("param-dirty-badge");
  if (bar) bar.style.borderColor = "var(--warn)";
  if (badge) {
    badge.textContent = "⚠️ Alterações não salvas nos parâmetros";
    badge.className = "tag tag-warn";
  }
  updateParamMargemMarkupPreview();
}

function discardParameterChanges() {
  STATE.paramDirty = false;
  renderApp();
  showToast("Alterações descartadas. Valores da versão ativa restaurados.");
}

function updateParamMargemMarkupPreview() {
  const fc = parseFloat(document.getElementById("prm_fixed_cost")?.value) || 28000;
  const ph = parseFloat(document.getElementById("prm_prod_hours")?.value) || 320;
  const mg = parseFloat(document.getElementById("prm_margin")?.value) || 30;
  const custoH = ph > 0 ? fc / ph : 0;
  const precoMarkup = custoH * (1 + mg / 100);
  const precoMargemReal = mg < 100 ? custoH / (1 - mg / 100) : precoMarkup;
  const el = document.getElementById("param-margem-markup-live");
  if (el) {
    el.innerHTML = `
      • <strong>Custo Hora Puro:</strong> ${fmtBRL2(custoH)}/h &nbsp;|&nbsp;
      • <strong>Hora Técnica por Markup (+${mg}% sobre o custo — fórmula NBC PG 01 ativa):</strong> <strong class="gold">${fmtBRL2(precoMarkup)}/h</strong> &nbsp;|&nbsp;
      • <strong>Referência por Margem Líquida (${mg}% sobre o preço de venda):</strong> ${fmtBRL2(precoMargemReal)}/h
    `;
  }
}

function renderParametrosView() {
  const pv = STATE.parameters?.activeVersion || {};
  const versions = STATE.parameters?.versions || [];
  const plansServices = STATE.parameters?.plansServices || [];
  const depts = pv.department_costs || [];
  const regimes = pv.regimes || {};
  const tab = STATE.paramSubTab || "todos";

  const custoHora = pv.productive_hours_monthly > 0 ? pv.fixed_cost_monthly / pv.productive_hours_monthly : 0;
  const margPct = pv.target_margin_pct || 30;
  const horaTecnica = custoHora * (1 + margPct / 100);
  const horaMargemSobreVenda = margPct < 100 ? custoHora / (1 - margPct / 100) : horaTecnica;

  const showOperacional = tab === "todos" || tab === "operacional" || tab === "margem";
  const showDepts = tab === "todos" || tab === "departamentos";
  const showPlanos = tab === "todos" || tab === "planos";
  const showVersoes = tab === "todos" || tab === "versoes";

  return `
    <div class="kpi-grid">
      <div class="kpi-card">
        <span>Versão Ativa de Parâmetros</span>
        <strong class="gold">v${pv.version_number || 1}.0</strong>
        <em>${escapeHtml(pv.version_label || "Parâmetros Ativos")}</em>
      </div>
      <div class="kpi-card">
        <span>Custo Fixo Mensal do Escritório</span>
        <strong>${fmtBRL0(pv.fixed_cost_monthly)}</strong>
        <em>${pv.productive_hours_monthly || 320}h produtivas/mês</em>
      </div>
      <div class="kpi-card">
        <span>Custo Real / Hora Produtiva</span>
        <strong>${fmtBRL2(custoHora)}</strong>
        <em>Piso ético operacional (NBC PG 01)</em>
      </div>
      <div class="kpi-card">
        <span>Hora Técnica Aplicada (${margPct}%)</span>
        <strong class="gold">${fmtBRL2(horaTecnica)}</strong>
        <em>Base para cálculo de honorários</em>
      </div>
    </div>

    <!-- SUB-ABAS INTERNAS DE PARÂMETROS (SEÇÃO 3 & 5.1 DO PLANO UX/UI) -->
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px">
      <div class="crm-tabs" style="margin-bottom:0;border-bottom:0">
        <button class="crm-tab ${tab === "todos" ? "active" : ""}" onclick="setParamSubTab('todos')">📋 Visão Completa</button>
        <button class="crm-tab ${tab === "operacional" ? "active" : ""}" onclick="setParamSubTab('operacional')">⚙️ 1. Custos & Hora Técnica</button>
        <button class="crm-tab ${tab === "margem" ? "active" : ""}" onclick="setParamSubTab('margem')">📈 2. Margem vs. Markup & Alçadas</button>
        <button class="crm-tab ${tab === "departamentos" ? "active" : ""}" onclick="setParamSubTab('departamentos')">🏢 3. Departamentos & Regimes</button>
        <button class="crm-tab ${tab === "planos" ? "active" : ""}" onclick="setParamSubTab('planos')">📦 4. Planos & Serviços (${plansServices.length})</button>
        <button class="crm-tab ${tab === "versoes" ? "active" : ""}" onclick="setParamSubTab('versoes')">🕒 5. Versões (v${pv.version_number || 1})</button>
      </div>
      <div>
        <span id="param-dirty-badge" class="tag ${STATE.paramDirty ? "tag-warn" : "tag-ok"}">
          ${STATE.paramDirty ? "⚠️ Alterações não salvas nos parâmetros" : "✓ Parâmetros sincronizados (v" + (pv.version_number || 1) + ")"}
        </span>
      </div>
    </div>

    <!-- EXPLICAÇÃO CONTEXTUAL MARGEM VS. MARKUP (EXIGÊNCIA EXPLÍCITA SEÇÃO 3 & 5.1) -->
    <div class="card" style="margin-bottom:18px;border-left:4px solid var(--gold)">
      <div class="card-body" style="padding:14px 18px;gap:6px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <strong style="font-size:13.5px;color:var(--gold)">💡 Ajuda Contextual: Entenda Margem vs. Markup na Precificação Contábil</strong>
          <span class="tag tag-gold">Fórmula Original NBC PG 01 Preservada</span>
        </div>
        <p style="font-size:12.5px;color:var(--muted)">
          • <strong>Markup sobre o Custo (padrão da calculadora):</strong> aplica o percentual diretamente sobre o custo da hora técnica (<code>Hora Técnica = Custo Hora × (1 + Percentual/100)</code>).<br/>
          • <strong>Margem sobre a Receita:</strong> representa quanto sobra do preço final após descontar o custo (<code>Preço = Custo Hora ÷ (1 - Margem/100)</code>).
        </p>
        <div id="param-margem-markup-live" style="font-size:12.5px;background:var(--navy-3);padding:8px 12px;border-radius:8px;border:1px solid var(--line)">
          • <strong>Custo Hora Puro:</strong> ${fmtBRL2(custoHora)}/h &nbsp;|&nbsp;
          • <strong>Hora Técnica por Markup (+${margPct}% sobre o custo — fórmula NBC PG 01 ativa):</strong> <strong class="gold">${fmtBRL2(horaTecnica)}/h</strong> &nbsp;|&nbsp;
          • <strong>Referência por Margem Líquida (${margPct}% sobre o preço de venda):</strong> ${fmtBRL2(horaMargemSobreVenda)}/h
        </div>
      </div>
    </div>

    <div class="${showOperacional && (showDepts || showVersoes) ? "dois" : ""}" style="align-items:start;margin-bottom:20px">
      ${
        showOperacional
          ? `
      <div class="card">
        <div class="card-head">
          <div class="card-titles">
            <span class="card-title">Regras Gerais de Custos, Hora Técnica, Margem/Markup e Alçadas</span>
            <span class="card-sub">Ao salvar, uma nova versão imutável é criada para preservar o histórico das simulações anteriores</span>
          </div>
        </div>
        <div class="card-body">
          <div class="dois">
            <div class="campo">
              <label class="campo-label">Custo Fixo Mensal (R$)</label>
              <input type="number" id="prm_fixed_cost" value="${pv.fixed_cost_monthly || 28000}" oninput="markParamDirty()" />
            </div>
            <div class="campo">
              <label class="campo-label">Custos Variáveis / Impostos sobre Nota (%)</label>
              <input type="number" step="0.5" id="prm_var_cost" value="${pv.variable_cost_pct || 0}" oninput="markParamDirty()" />
            </div>
          </div>

          <div class="tres">
            <div class="campo">
              <label class="campo-label">Horas Produtivas / Mês</label>
              <input type="number" id="prm_prod_hours" value="${pv.productive_hours_monthly || 320}" oninput="markParamDirty()" />
            </div>
            <div class="campo">
              <label class="campo-label">Margem / Markup Alvo (%)</label>
              <input type="number" id="prm_margin" value="${pv.target_margin_pct || 30}" oninput="markParamDirty()" />
            </div>
            <div class="campo">
              <label class="campo-label">Preço Mínimo do Escritório (R$)</label>
              <input type="number" id="prm_min_floor" value="${pv.minimum_fee_floor || 350}" oninput="markParamDirty()" />
            </div>
          </div>

          <div class="tres">
            <div class="campo">
              <label class="campo-label">Horas / Funcionário (DP)</label>
              <input type="number" step="0.05" id="prm_h_emp" value="${pv.hours_per_employee || 0.45}" oninput="markParamDirty()" />
            </div>
            <div class="campo">
              <label class="campo-label">Horas / Sócio (Pró-labore)</label>
              <input type="number" step="0.05" id="prm_h_part" value="${pv.hours_per_partner || 0.35}" oninput="markParamDirty()" />
            </div>
            <div class="campo">
              <label class="campo-label">Horas / Filial ou IE</label>
              <input type="number" step="0.1" id="prm_h_branch" value="${pv.hours_per_branch || 1.5}" oninput="markParamDirty()" />
            </div>
          </div>

          <div class="tres">
            <div class="campo">
              <label class="campo-label">Desc. Máx. Vendedor (%)</label>
              <input type="number" id="prm_disc_seller" value="${pv.max_discount_seller_pct || 8}" oninput="markParamDirty()" />
            </div>
            <div class="campo">
              <label class="campo-label">Desc. Máx. Gestor (%)</label>
              <input type="number" id="prm_disc_mgr" value="${pv.max_discount_manager_pct || 15}" oninput="markParamDirty()" />
            </div>
            <div class="campo">
              <label class="campo-label">Taxa Implantação Padrão (R$)</label>
              <input type="number" id="prm_setup_fee" value="${pv.default_setup_fee || 450}" oninput="markParamDirty()" />
            </div>
          </div>

          <div class="campo">
            <label class="campo-label">Rótulo da Nova Versão de Parâmetros</label>
            <input type="text" id="prm_version_label" placeholder="Ex.: Revisão de Custos e Hora Técnica 2026" oninput="markParamDirty()" />
          </div>

          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn-primary" onclick="saveNewParameterVersion()">
              💾 Publicar Nova Versão de Parâmetros (Preservar Histórico)
            </button>
            <button class="btn-secondary" onclick="discardParameterChanges()">
              ↺ Cancelar / Restaurar Valores Ativos
            </button>
          </div>
        </div>
      </div>
      `
          : ""
      }

      ${
        showDepts || showVersoes
          ? `
      <div class="col-inputs">
        ${
          showDepts
            ? `
        <div class="card">
          <div class="card-head">
            <div class="card-titles">
              <span class="card-title">Custos por Departamento e Regimes Tributários</span>
              <span class="card-sub">Tempos estimados por regime, faixas de notas e obrigações acessórias</span>
            </div>
          </div>
          <div class="card-body">
            <h4 style="font-size:12.5px;color:var(--gold)">Custos por Departamento</h4>
            <div class="table-responsive">
              <table class="data-table">
                <thead><tr><th>Departamento</th><th>Peso (%)</th><th>Custo Mensal</th><th>Horas/Mês</th></tr></thead>
                <tbody>
                  ${depts
                    .map(
                      (d) => `
                    <tr>
                      <td>${escapeHtml(d.nome)}</td>
                      <td>${d.pesoCustoPct}%</td>
                      <td>${fmtBRL0(d.custoMensal)}</td>
                      <td>${d.horasMes}h</td>
                    </tr>
                  `
                    )
                    .join("")}
                </tbody>
              </table>
            </div>

            <h4 style="font-size:12.5px;color:var(--gold);margin-top:8px">Regimes Tributários Atendidos & Horas Base</h4>
            <div class="table-responsive">
              <table class="data-table">
                <thead><tr><th>Regime</th><th>Horas Base</th><th>Ref. Mercado Mín.</th><th>Ref. Mercado Máx.</th></tr></thead>
                <tbody>
                  ${Object.entries(regimes)
                    .map(
                      ([k, r]) => `
                    <tr>
                      <td><strong>${escapeHtml(r.rotulo)}</strong></td>
                      <td><input type="number" step="0.1" class="reg-hours-input" data-key="${k}" value="${r.horas}" style="width:80px;padding:5px" oninput="markParamDirty()" /> h</td>
                      <td>${fmtBRL0(r.refMin)}</td>
                      <td>${fmtBRL0(r.refMax)}</td>
                    </tr>
                  `
                    )
                    .join("")}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        `
            : ""
        }

        ${
          showVersoes
            ? `
        <div class="card">
          <div class="card-head">
            <div class="card-titles">
              <span class="card-title">Histórico de Versões de Parâmetros</span>
              <span class="card-sub">Garante auditoria e integridade histórica das simulações emitidas</span>
            </div>
          </div>
          <div class="card-body">
            <div class="table-responsive">
              <table class="data-table">
                <thead><tr><th>Versão</th><th>Descrição</th><th>Custo Fixo</th><th>Margem</th><th>Status</th></tr></thead>
                <tbody>
                  ${versions
                    .map(
                      (v) => `
                    <tr>
                      <td><strong>v${v.version_number}</strong></td>
                      <td>${escapeHtml(v.version_label)}</td>
                      <td>${fmtBRL0(v.fixed_cost_monthly)}</td>
                      <td>${v.target_margin_pct}%</td>
                      <td>${v.is_active ? '<span class="tag tag-gold">Ativa</span>' : '<span class="tag">Histórica</span>'}</td>
                    </tr>
                  `
                    )
                    .join("")}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        `
            : ""
        }
      </div>
      `
          : ""
      }
    </div>

    ${
      showPlanos
        ? `
    <div class="card" style="margin-bottom:20px">
      <div class="card-head" style="justify-content:space-between;flex-wrap:wrap">
        <div class="card-titles">
          <span class="card-title">Planos, Pacotes e Serviços Personalizados do Escritório</span>
          <span class="card-sub">Cadastre planos, serviços recorrentes, avulsos e implantação (permite itens sem nomes ou preços fixos pré-definidos)</span>
        </div>
        <button class="btn-primary" onclick="openNewPlanServiceModal()">+ Novo Plano ou Serviço</button>
      </div>
      <div class="card-body">
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Código</th>
                <th>Nome / Descrição</th>
                <th>Departamento</th>
                <th>Horas Estimadas</th>
                <th>Valor Base (Opcional)</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              ${plansServices
                .map(
                  (ps) => `
                <tr>
                  <td><span class="tag ${ps.item_type === "plano" ? "tag-gold" : ""}">${escapeHtml(ps.item_type)}</span></td>
                  <td>${escapeHtml(ps.code || "-")}</td>
                  <td>
                    <strong>${escapeHtml(ps.name)}</strong>
                    <div style="font-size:11.5px;color:var(--muted)">${escapeHtml(ps.description || "")}</div>
                  </td>
                  <td>${escapeHtml(ps.department || "Contábil")}</td>
                  <td>${Number(ps.estimated_hours || 0).toFixed(1)} h</td>
                  <td>${Number(ps.base_price || 0) > 0 ? fmtBRL2(ps.base_price) : "Calculado por Hora Técnica"}</td>
                  <td>
                    <button class="btn-danger" onclick="deletePlanService('${ps.id}')">Remover</button>
                  </td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    `
        : ""
    }

    <!-- BARRA PREVISÍVEL DE SALVAR E CANCELAR (SEÇÃO 5.1 DO PLANO UX/UI) -->
    <div id="param-sticky-save-bar" class="sticky-action-bar">
      <div style="font-size:12.5px;color:var(--muted)">
        <strong>Controle de Versionamento:</strong> Salvar cria a versão <strong>v${(pv.version_number || 1) + 1}</strong> sem alterar propostas ou simulações antigas.
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn-secondary" onclick="discardParameterChanges()">↺ Cancelar Alterações</button>
        <button class="btn-primary" onclick="saveNewParameterVersion()">💾 Salvar Parâmetros (Publicar v${(pv.version_number || 1) + 1})</button>
      </div>
    </div>
  `;
}

async function saveNewParameterVersion() {
  const pv = STATE.parameters?.activeVersion || {};
  const regimes = JSON.parse(JSON.stringify(pv.regimes || {}));
  document.querySelectorAll(".reg-hours-input").forEach((inp) => {
    const k = inp.getAttribute("data-key");
    if (regimes[k]) regimes[k].horas = parseFloat(inp.value) || regimes[k].horas;
  });

  const payload = {
    fixed_cost_monthly: parseFloat(document.getElementById("prm_fixed_cost")?.value) || pv.fixed_cost_monthly || 28000,
    variable_cost_pct: parseFloat(document.getElementById("prm_var_cost")?.value) || pv.variable_cost_pct || 0,
    productive_hours_monthly: parseFloat(document.getElementById("prm_prod_hours")?.value) || pv.productive_hours_monthly || 320,
    target_margin_pct: parseFloat(document.getElementById("prm_margin")?.value) || pv.target_margin_pct || 30,
    minimum_fee_floor: parseFloat(document.getElementById("prm_min_floor")?.value) || pv.minimum_fee_floor || 350,
    hours_per_employee: parseFloat(document.getElementById("prm_h_emp")?.value) || pv.hours_per_employee || 0.45,
    hours_per_partner: parseFloat(document.getElementById("prm_h_part")?.value) || pv.hours_per_partner || 0.35,
    hours_per_branch: parseFloat(document.getElementById("prm_h_branch")?.value) || pv.hours_per_branch || 1.5,
    max_discount_seller_pct: parseFloat(document.getElementById("prm_disc_seller")?.value) || pv.max_discount_seller_pct || 8,
    max_discount_manager_pct: parseFloat(document.getElementById("prm_disc_mgr")?.value) || pv.max_discount_manager_pct || 15,
    default_setup_fee: parseFloat(document.getElementById("prm_setup_fee")?.value) || pv.default_setup_fee || 450,
    version_label: document.getElementById("prm_version_label")?.value || "",
    department_costs: pv.department_costs,
    regimes,
    activities: pv.activities,
    invoice_brackets: pv.invoice_brackets,
    revenue_brackets: pv.revenue_brackets,
    accessories: pv.accessories,
    complexity_levels: pv.complexity_levels
  };

  try {
    const res = await apiFetch("/api/parameters/versions", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    STATE.paramDirty = false;
    await loadParameters();
    STATE.calc.custoFixo = payload.fixed_cost_monthly;
    STATE.calc.horasProdutivas = payload.productive_hours_monthly;
    STATE.calc.margem = payload.target_margin_pct;
    await runCalculation();
    showToast(`Nova versão publicada: ${res.version_label}`);
    renderApp();
  } catch (err) {
    showToast(err.message, true);
  }
}

function openNewPlanServiceModal() {
  const modal = document.getElementById("modal-container");
  modal.innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this)this.remove()">
      <div class="modal-box">
        <div class="modal-head">
          <h3>Cadastrar Plano, Pacote ou Serviço Personalizado</h3>
          <button class="btn-xs" onclick="document.getElementById('modal-container').innerHTML=''">✕</button>
        </div>
        <p style="font-size:12.5px;color:var(--muted)">
          Você pode cadastrar planos ou serviços por horas técnicas estimadas ou preço base opcional (sem obrigar nomes ou preços fixos).
        </p>
        <div class="dois">
          <div class="campo">
            <label class="campo-label">Tipo de Item</label>
            <select id="mdl_ps_type">
              <option value="plano">Plano / Pacote Mensal</option>
              <option value="servico_recorrente">Serviço Adicional Recorrente</option>
              <option value="servico_avulso">Serviço Avulso / Pontual</option>
              <option value="implantacao">Taxa de Implantação / Onboarding</option>
            </select>
          </div>
          <div class="campo">
            <label class="campo-label">Departamento Responsável</label>
            <select id="mdl_ps_dept">
              <option value="Contábil">Departamento Contábil</option>
              <option value="Fiscal">Departamento Fiscal / Tributário</option>
              <option value="Pessoal">Departamento Pessoal (DP)</option>
              <option value="Societário">Societário / BPO Financeiro</option>
            </select>
          </div>
        </div>
        <div class="dois">
          <div class="campo">
            <label class="campo-label">Nome do Serviço ou Plano (Opcional — livre)</label>
            <input type="text" id="mdl_ps_name" placeholder="Ex.: Consultoria Tributária Mensal ou Plano Custom" />
          </div>
          <div class="campo">
            <label class="campo-label">Código Interno (Opcional)</label>
            <input type="text" id="mdl_ps_code" placeholder="Ex.: SRV-CUSTOM" />
          </div>
        </div>
        <div class="dois">
          <div class="campo">
            <label class="campo-label">Horas Técnicas Estimadas / Mês</label>
            <input type="number" step="0.5" id="mdl_ps_hours" value="1.5" />
          </div>
          <div class="campo">
            <label class="campo-label">Preço Fixo / Adicional em R$ (0 = usar Hora Técnica)</label>
            <input type="number" step="10" id="mdl_ps_price" value="0" />
          </div>
        </div>
        <div class="campo">
          <label class="campo-label">Descrição do Escopo</label>
          <textarea id="mdl_ps_desc" placeholder="Descreva os entregáveis deste plano ou serviço..."></textarea>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:10px">
          <button class="btn-secondary" onclick="document.getElementById('modal-container').innerHTML=''">Cancelar</button>
          <button class="btn-primary" onclick="submitNewPlanService()">Salvar Item</button>
        </div>
      </div>
    </div>
  `;
}

async function submitNewPlanService() {
  try {
    await apiFetch("/api/plans-services", {
      method: "POST",
      body: JSON.stringify({
        item_type: document.getElementById("mdl_ps_type").value,
        department: document.getElementById("mdl_ps_dept").value,
        name: document.getElementById("mdl_ps_name").value,
        code: document.getElementById("mdl_ps_code").value,
        estimated_hours: parseFloat(document.getElementById("mdl_ps_hours").value) || 0,
        base_price: parseFloat(document.getElementById("mdl_ps_price").value) || 0,
        description: document.getElementById("mdl_ps_desc").value
      })
    });
    document.getElementById("modal-container").innerHTML = "";
    await loadParameters();
    showToast("Plano/serviço cadastrado com sucesso!");
    renderApp();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function deletePlanService(id) {
  await apiFetch(`/api/plans-services/${id}`, { method: "DELETE" });
  await loadParameters();
  showToast("Item removido.");
  renderApp();
}

/* =========================================================================
   2. MÓDULO CALCULADORA (PRESERVANDO INTEGRALMENTE AS FÓRMULAS ORIGINAIS)
   ========================================================================= */
function getCalcSafeResult() {
  return (
    STATE.calcResult ||
    runCalculationSync() || {
      custoHora: 87.5,
      horaTecnica: 113.75,
      horasTotais: 5.9,
      piso: 516.25,
      sugerido: 671.12,
      honorarioFinal: 671.12,
      descontoPct: 0,
      valorDesconto: 0,
      descontoAutorizado: true,
      descontoMaximoPermitidoPct: 15,
      refMin: 350,
      refMax: 900,
      breakdown: [],
      avulsosSel: [],
      totalAvulsos: 0,
      taxaImplantacao: 450,
      status: null,
      statusTexto: "",
      regimeRotulo: "Simples Nacional",
      atividadeRotulo: "Serviços",
      volumeRotulo: "21 a 80 NF/mês"
    }
  );
}

function renderCalcSummaryTopHtml(c, X) {
  const maxBarVal = Math.max(1, ...(X.breakdown || []).map((b) => b.valor));
  return `
    <div class="result-head">
      <div class="result-badge-row">
        <span class="result-kicker">⚡ HONORÁRIO MENSAL RECOMENDADO</span>
        <span class="result-hours-pill">${Number(X.horasTotais).toFixed(1)} h/mês</span>
      </div>
      <strong class="valor-grande">${fmtBRL0(X.honorarioFinal)}</strong>
      <span class="result-subline">
        Receita anual: <strong>${fmtBRL0(X.honorarioFinal * 12)}/ano</strong> · Hora técnica: <strong>${fmtBRL2(X.horaTecnica)}</strong>
      </span>
    </div>

    <div class="faixas">
      <div class="faixa">
        <span>Piso de custo</span>
        <strong>${fmtBRL0(X.piso)}</strong>
        <em>custo puro (NBC PG 01)</em>
      </div>
      <div class="faixa faixa-mid">
        <span>Recomendado</span>
        <strong class="gold">${fmtBRL0(X.sugerido)}</strong>
        <em>custo + margem ${c.margem}%</em>
      </div>
      <div class="faixa">
        <span>Ref. mercado*</span>
        <strong>${fmtBRL0(X.refMin)}–${fmtBRL0(X.refMax)}</strong>
        <em>faixa referencial</em>
      </div>
    </div>

    <div class="bars-list">
      ${(X.breakdown || [])
        .map((b) => {
          const pct = Math.min(100, Math.round((b.valor / maxBarVal) * 100));
          return `
          <div class="bar-row" title="${escapeHtml(b.nome)}: ${b.horas}h = ${fmtBRL2(b.valor)}">
            <span class="bar-label">${escapeHtml(b.nome)}</span>
            <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
            <span class="bar-val">${fmtBRL0(b.valor)}</span>
          </div>
        `;
        })
        .join("")}
    </div>

    ${
      X.totalAvulsos > 0 || X.taxaImplantacao > 0
        ? `
      <div class="setup-fee-banner">
        <span>+ Implantação e Avulsos (cobrança única)</span>
        <strong class="gold">${fmtBRL0(X.totalAvulsos + X.taxaImplantacao)}</strong>
      </div>
    `
        : ""
    }
  `;
}

function renderCalcDiscFeedbackHtml(X) {
  return !X.descontoAutorizado
    ? `<span style="font-size:11px;color:var(--danger);font-weight:600">⚠️ Acima da sua alçada (${X.descontoMaximoPermitidoPct}%) ou abaixo do piso!</span>`
    : `<span style="font-size:10.5px;color:var(--muted)">Alçada máx. autorizada: ${X.descontoMaximoPermitidoPct}%</span>`;
}

function renderCalcStatusZoneHtml(X) {
  if (!X.status) return "";
  const statusColors = {
    aviltamento: "var(--danger)",
    abaixo: "#F59E0B",
    ok: "var(--ok)",
    acima: "var(--ok)"
  };
  const col = statusColors[X.status] || "var(--gold)";
  return `
    <div style="border:1px solid ${col};color:${col};border-radius:10px;padding:10px 12px;font-size:12px;background:rgba(255,255,255,0.02)">
      <strong>Diagnóstico de Viabilidade:</strong> ${escapeHtml(X.statusTexto)}
    </div>
  `;
}

function renderCalcElementsGridHtml(c, X) {
  return `
    <div class="kpi-card"><span>Regime / atividade</span><strong style="font-size:14px">${escapeHtml(X.regimeRotulo)} · ${escapeHtml(X.atividadeRotulo)}</strong></div>
    <div class="kpi-card"><span>Faturamento mensal</span><strong style="font-size:14px">${fmtBRL0(c.faturamento)}</strong></div>
    <div class="kpi-card"><span>Funcionários / sócios</span><strong style="font-size:14px">${c.funcionarios} / ${c.socios}</strong></div>
    <div class="kpi-card"><span>Volume fiscal</span><strong style="font-size:14px">${escapeHtml(X.volumeRotulo)}</strong></div>
    <div class="kpi-card"><span>Horas técnicas/mês</span><strong style="font-size:14px">${Number(X.horasTotais).toFixed(1)} h</strong></div>
    <div class="kpi-card"><span>Hora técnica aplicada</span><strong style="font-size:14px">${fmtBRL2(X.horaTecnica)}</strong></div>
    <div class="kpi-card"><span>Piso de Custo</span><strong style="font-size:14px">${fmtBRL2(X.piso)}</strong></div>
    <div class="kpi-card"><span>Honorário Final</span><strong class="gold" style="font-size:16px">${fmtBRL2(X.honorarioFinal)}</strong></div>
  `;
}

function setCalcStep(stepKey, scrollTargetId = "") {
  STATE.calcStep = stepKey;
  renderApp();
  if (scrollTargetId) {
    setTimeout(() => {
      const el = document.getElementById(scrollTargetId);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 30);
  }
}

function renderCalculadoraView() {
  const pv = STATE.parameters?.activeVersion || {};
  const regimes = pv.regimes || {
    mei: { rotulo: "MEI" },
    simples: { rotulo: "Simples Nacional" },
    presumido: { rotulo: "Lucro Presumido" },
    real: { rotulo: "Lucro Real" }
  };
  const activities = pv.activities || {
    comercio: { rotulo: "Comércio" },
    servicos: { rotulo: "Serviços" },
    industria: { rotulo: "Indústria" }
  };
  const brackets = pv.invoice_brackets || [
    { rotulo: "Até 20 NF/mês", horas: 0 },
    { rotulo: "21 a 80 NF/mês", horas: 1.5 },
    { rotulo: "81 a 200 NF/mês", horas: 4 },
    { rotulo: "201 a 500 NF/mês", horas: 8 },
    { rotulo: "Acima de 500/mês", horas: 14 }
  ];
  const accessories = pv.accessories || [];
  const complexityLevels = pv.complexity_levels || {
    padrao: { rotulo: "Padrão (1.0x)" },
    baixa: { rotulo: "Baixa (0.90x)" },
    media: { rotulo: "Média (1.10x)" },
    alta: { rotulo: "Alta (1.25x)" },
    especial: { rotulo: "Especial (1.50x)" }
  };

  const plans = (STATE.parameters?.plansServices || []).filter((p) => p.item_type === "plano");
  const recServices = (STATE.parameters?.plansServices || []).filter((p) => p.item_type === "servico_recorrente");
  const avulsosList = (STATE.parameters?.plansServices || []).filter((p) => p.item_type === "servico_avulso");

  const c = STATE.calc;
  const X = getCalcSafeResult();
  const cs = STATE.calcStep || "todos";

  return `
    <!-- STEPPER PROGRESSIVO DA CALCULADORA (SEÇÃO 3 & 5.2 DO PLANO UX/UI) -->
    <div class="flow-stepper" role="tablist" aria-label="Etapas da Simulação de Honorários">
      <button type="button" class="flow-step ${cs === "todos" ? "active" : ""}" onclick="setCalcStep('todos')">
        <span class="step-num">★</span>
        <span>Visão Completa (Todos os Blocos)</span>
      </button>
      <button type="button" class="flow-step ${cs === "dados" ? "active" : c.companyName ? "done" : ""}" onclick="setCalcStep('dados', 'calc-sec-cliente')">
        <span class="step-num">1</span>
        <span>Dados do Cliente & Perfil</span>
      </button>
      <button type="button" class="flow-step ${cs === "servicos" ? "active" : ""}" onclick="setCalcStep('servicos', 'calc-sec-servicos')">
        <span class="step-num">2</span>
        <span>Serviços, Planos & Avulsos</span>
      </button>
      <button type="button" class="flow-step ${cs === "custos" ? "active" : ""}" onclick="setCalcStep('custos', 'calc-sec-custos')">
        <span class="step-num">3</span>
        <span>Custos & Ajustes do Escritório</span>
      </button>
      <button type="button" class="flow-step ${cs === "resultado" ? "active" : ""}" onclick="setCalcStep('resultado', 'calc-summary-top-zone')">
        <span class="step-num">4</span>
        <span>Resultado & Proposta (${fmtBRL0(X.honorarioFinal)})</span>
      </button>
    </div>

    <div class="card calc-toolbar-card" style="margin-bottom:18px">
      <div class="card-body" style="padding:14px 18px">
        <div class="tres" style="align-items:end">
          <div class="campo">
            <label class="campo-label">
              <span>🔗 Importar Lead / Oportunidade do CRM (Sem Redigitação)</span>
            </label>
            <div style="display:flex;gap:6px;align-items:center">
              <select style="flex:1" onchange="importOpportunityIntoCalculator(this.value)">
                <option value="">-- Selecionar oportunidade do CRM ou simular livremente --</option>
                ${STATE.crm.opportunities
                  .map(
                    (op) => `
                  <option value="${op.id}" ${c.opportunityId === op.id ? "selected" : ""}>
                    ${escapeHtml(op.company_name)} (${escapeHtml(op.contact_name)}) — ${fmtBRL0(op.estimated_revenue)}/mês
                  </option>
                `
                  )
                  .join("")}
              </select>
              ${
                c.opportunityId
                  ? `<button type="button" class="btn-danger" onclick="deleteOpportunityLead('${c.opportunityId}')" title="Retirar / Excluir este Lead do CRM">🗑️ Excluir Lead</button>`
                  : ""
              }
            </div>
          </div>

          <div class="campo">
            <label class="campo-label">Título da Simulação / Empresa</label>
            <input type="text" value="${escapeHtml(c.companyName || c.title)}" oninput="STATE.calc.companyName=this.value" placeholder="Nome da empresa ou simulação" />
          </div>

          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn-secondary" onclick="saveCurrentSimulation()">💾 Salvar Simulação</button>
            <button class="btn-secondary" onclick="resetCalcToDefaults()">↺ Limpar</button>
            <button class="btn-primary" onclick="convertSimulationToProposal()">🚀 GERAR PROPOSTA</button>
          </div>
        </div>
      </div>
    </div>

    <div class="grid-calc">
      <div class="col-inputs">
        <section id="calc-sec-custos" class="card" style="${cs !== "todos" && cs !== "custos" ? "display:none" : ""}">
          <div class="card-head">
            <span class="card-icon">⚙️</span>
            <div class="card-titles">
              <span class="card-title">1. Configuração do Escritório</span>
              <span class="card-sub">Define o custo real da hora técnica (Sincronizado com Parâmetros v${pv.version_number || 1})</span>
            </div>
          </div>
          <div class="card-body">
            <div class="campo">
              <span class="campo-label">
                <span class="campo-label-left">Custo fixo mensal <span class="help-tip" title="${escapeHtml(HELP_TEXTS.custoFixo)}">?</span></span>
                <span class="campo-hint">aluguel, folha interna, sistemas</span>
              </span>
              <div class="prefixo">
                <span>R$</span>
                <input id="inp-calc-custoFixo" type="number" value="${c.custoFixo}" oninput="updateCalcFieldLive('custoFixo', Number(this.value))" />
              </div>
            </div>

            <div class="dois">
              <div class="campo">
                <span class="campo-label">
                  <span class="campo-label-left">Horas produtivas/mês <span class="help-tip" title="${escapeHtml(HELP_TEXTS.horasProdutivas)}">?</span></span>
                </span>
                <div class="stepper">
                  <button type="button" onclick="stepCalcField('horasProdutivas', -10, 10)">−</button>
                  <input id="inp-calc-horasProdutivas" type="number" value="${c.horasProdutivas}" oninput="updateCalcFieldLive('horasProdutivas', Number(this.value))" />
                  <button type="button" onclick="stepCalcField('horasProdutivas', 10, 10)">+</button>
                </div>
              </div>

              <div class="campo">
                <span class="campo-label">
                  <span class="campo-label-left">Margem de lucro alvo (%) <span class="help-tip" title="${escapeHtml(HELP_TEXTS.margem)}">?</span></span>
                </span>
                <div class="stepper">
                  <button type="button" onclick="stepCalcField('margem', -5, 0)">−</button>
                  <input id="inp-calc-margem" type="number" value="${c.margem}" oninput="updateCalcFieldLive('margem', Number(this.value))" />
                  <button type="button" onclick="stepCalcField('margem', 5, 0)">+</button>
                </div>
              </div>
            </div>

            <div class="mini-stats">
              <div>
                <span>Custo / hora</span>
                <strong id="calc-mini-custo-hora">${fmtBRL2(X.custoHora)}</strong>
              </div>
              <div>
                <span>Hora técnica</span>
                <strong id="calc-mini-hora-tecnica" class="gold">${fmtBRL2(X.horaTecnica)}</strong>
              </div>
            </div>
          </div>
        </section>

        <section id="calc-sec-cliente" class="card" style="${cs !== "todos" && cs !== "dados" ? "display:none" : ""}">
          <div class="card-head">
            <span class="card-icon">🏢</span>
            <div class="card-titles">
              <span class="card-title">2. Perfil Tributário e Operacional do Cliente</span>
              <span class="card-sub">${c.companyName ? `Cliente ativo: ${escapeHtml(c.companyName)} (${escapeHtml(c.cpfCnpj || "Sem CNPJ")})` : "Dimensionamento de risco, porte e volume"}</span>
            </div>
          </div>
          <div class="card-body">
            <div class="campo">
              <span class="campo-label">
                <span class="campo-label-left">Regime tributário <span class="help-tip" title="${escapeHtml(HELP_TEXTS.regime)}">?</span></span>
              </span>
              <div class="chips">
                ${Object.entries(regimes)
                  .map(
                    ([k, r]) => `
                  <button type="button" class="chip ${c.regime === k ? "chip-on" : ""}" onclick="updateCalcField('regime', '${k}')">
                    ${escapeHtml(r.rotulo)}
                  </button>
                `
                  )
                  .join("")}
              </div>
            </div>

            <div class="campo">
              <span class="campo-label">
                <span class="campo-label-left">Atividade econômica <span class="help-tip" title="${escapeHtml(HELP_TEXTS.atividade)}">?</span></span>
              </span>
              <div class="chips">
                ${Object.entries(activities)
                  .map(
                    ([k, a]) => `
                  <button type="button" class="chip ${c.atividade === k ? "chip-on" : ""}" onclick="updateCalcField('atividade', '${k}')">
                    ${escapeHtml(a.rotulo)}
                  </button>
                `
                  )
                  .join("")}
              </div>
            </div>

            <div class="dois">
              <div class="campo">
                <span class="campo-label">
                  <span class="campo-label-left">Faturamento mensal médio <span class="help-tip" title="${escapeHtml(HELP_TEXTS.faturamento)}">?</span></span>
                  <span id="lbl-fat-val" class="campo-hint" style="color:var(--gold);font-style:normal;font-weight:700">${fmtBRL0(c.faturamento)}</span>
                </span>
                <div class="prefixo">
                  <span>R$</span>
                  <input id="inp-calc-faturamento" type="number" value="${c.faturamento}" oninput="updateCalcFieldLive('faturamento', Number(this.value))" />
                </div>
                <input
                  id="rng-calc-faturamento"
                  type="range"
                  class="calc-range-slider"
                  min="0"
                  max="1500000"
                  step="5000"
                  value="${Math.min(1500000, Number(c.faturamento) || 0)}"
                  oninput="updateCalcFieldLive('faturamento', Number(this.value), true)"
                />
              </div>

              <div class="campo">
                <span class="campo-label">
                  <span class="campo-label-left">Complexidade operacional</span>
                </span>
                <select onchange="updateCalcFieldLive('complexidade', this.value)">
                  ${Object.entries(complexityLevels)
                    .map(
                      ([k, cl]) => `
                    <option value="${k}" ${c.complexidade === k ? "selected" : ""}>${escapeHtml(cl.rotulo)}</option>
                  `
                    )
                    .join("")}
                </select>
              </div>
            </div>

            <div class="tres">
              <div class="campo">
                <span class="campo-label">
                  <span class="campo-label-left">Funcionários <span class="help-tip" title="${escapeHtml(HELP_TEXTS.funcionarios)}">?</span></span>
                </span>
                <div class="stepper">
                  <button type="button" onclick="stepCalcField('funcionarios', -1, 0)">−</button>
                  <input id="inp-calc-funcionarios" type="number" value="${c.funcionarios}" oninput="updateCalcFieldLive('funcionarios', Number(this.value))" />
                  <button type="button" onclick="stepCalcField('funcionarios', 1, 0)">+</button>
                </div>
              </div>

              <div class="campo">
                <span class="campo-label">
                  <span class="campo-label-left">Sócios <span class="help-tip" title="${escapeHtml(HELP_TEXTS.socios)}">?</span></span>
                </span>
                <div class="stepper">
                  <button type="button" onclick="stepCalcField('socios', -1, 0)">−</button>
                  <input id="inp-calc-socios" type="number" value="${c.socios}" oninput="updateCalcFieldLive('socios', Number(this.value))" />
                  <button type="button" onclick="stepCalcField('socios', 1, 0)">+</button>
                </div>
              </div>

              <div class="campo">
                <span class="campo-label">
                  <span class="campo-label-left">Filiais / IE <span class="help-tip" title="${escapeHtml(HELP_TEXTS.filiais)}">?</span></span>
                </span>
                <div class="stepper">
                  <button type="button" onclick="stepCalcField('filiais', -1, 0)">−</button>
                  <input id="inp-calc-filiais" type="number" value="${c.filiais}" oninput="updateCalcFieldLive('filiais', Number(this.value))" />
                  <button type="button" onclick="stepCalcField('filiais', 1, 0)">+</button>
                </div>
              </div>
            </div>

            <div class="campo">
              <span class="campo-label">
                <span class="campo-label-left">Volume de documentos fiscais <span class="help-tip" title="${escapeHtml(HELP_TEXTS.volume)}">?</span></span>
              </span>
              <select onchange="updateCalcFieldLive('volume', Number(this.value))">
                ${brackets
                  .map(
                    (b, idx) => `
                  <option value="${idx}" ${Number(c.volume) === idx ? "selected" : ""}>${escapeHtml(b.rotulo)} (+${b.horas}h)</option>
                `
                  )
                  .join("")}
              </select>
            </div>

            <div class="campo">
              <span class="campo-label">
                <span class="campo-label-left">Obrigações acessórias adicionais <span class="help-tip" title="${escapeHtml(HELP_TEXTS.obrigacoes)}">?</span></span>
              </span>
              <div class="checks">
                ${accessories
                  .map((ob) => {
                    const isOn = !!c.obrigacoes[ob.id];
                    return `
                    <button type="button" class="check ${isOn ? "check-on" : ""}" onclick="toggleCalcObrigacao('${ob.id}', this)">
                      <span class="box">${isOn ? "✓" : ""}</span>
                      <span style="flex:1">${escapeHtml(ob.rotulo)}</span>
                      <span style="font-size:11.5px;color:var(--muted)">+${ob.horas}h/mês</span>
                    </button>
                  `;
                  })
                  .join("")}
              </div>
            </div>
          </div>
        </section>

        <section id="calc-sec-servicos" class="card" style="${cs !== "todos" && cs !== "servicos" ? "display:none" : ""}">
          <div class="card-head">
            <span class="card-icon">📦</span>
            <div class="card-titles">
              <span class="card-title">3. Planos, Pacotes e Serviços Recorrentes do Escritório</span>
              <span class="card-sub">Selecione o pacote comercial e serviços mensais adicionais</span>
            </div>
          </div>
          <div class="card-body">
            <div class="campo">
              <label class="campo-label">Plano / Pacote Comercial</label>
              <select onchange="updateCalcFieldLive('selectedPlanId', this.value)">
                <option value="">Padrão Técnico (Cálculo Puro por Horas NBC PG 01)</option>
                ${plans
                  .map(
                    (p) => `
                  <option value="${p.id}" ${c.selectedPlanId === p.id ? "selected" : ""}>
                    ${escapeHtml(p.name)} (${p.estimated_hours > 0 ? `+${p.estimated_hours}h` : "Base"})
                  </option>
                `
                  )
                  .join("")}
              </select>
            </div>

            ${
              recServices.length > 0
                ? `
              <div class="campo">
                <label class="campo-label">Serviços Recorrentes Adicionais</label>
                <div class="checks">
                  ${recServices
                    .map((srv) => {
                      const on = c.servicosRecorrentesIds.includes(srv.id);
                      return `
                      <button type="button" class="check ${on ? "check-on" : ""}" onclick="toggleRecurringService('${srv.id}', this)">
                        <span class="box">${on ? "✓" : ""}</span>
                        <span style="flex:1">${escapeHtml(srv.name)}</span>
                        <span style="font-size:11.5px;color:var(--muted)">+${srv.estimated_hours}h</span>
                      </button>
                    `;
                    })
                    .join("")}
                </div>
              </div>
            `
                : ""
            }
          </div>
        </section>

        <section class="card" style="${cs !== "todos" && cs !== "servicos" ? "display:none" : ""}">
          <div class="card-head">
            <span class="card-icon">✨</span>
            <div class="card-titles">
              <span class="card-title">4. Serviços Avulsos e Implantação</span>
              <span class="card-sub">Cobrança única — valores editáveis conforme Res. CFC 1.590/2020</span>
            </div>
          </div>
          <div class="card-body">
            <div class="campo">
              <label class="campo-label">Taxa de Implantação / Migração Inicial (R$)</label>
              <div class="prefixo">
                <span>R$</span>
                <input id="inp-calc-taxaImplantacao" type="number" value="${c.taxaImplantacao}" oninput="updateCalcFieldLive('taxaImplantacao', Number(this.value))" />
              </div>
            </div>

            <div class="avulsos-list">
              ${avulsosList
                .map((av) => {
                  const key = av.id;
                  const selObj = c.avulsos[key];
                  const isOn = !!selObj;
                  const curVal = isOn ? selObj.valor ?? av.base_price : av.base_price;
                  return `
                  <div class="avulso ${isOn ? "avulso-on" : ""}">
                    <button type="button" class="avulso-toggle" onclick="toggleCalcAvulso('${key}', ${av.base_price})">
                      <span class="box">${isOn ? "✓" : ""}</span>
                      <span>${escapeHtml(av.name)}</span>
                    </button>
                    ${
                      isOn
                        ? `
                      <div class="prefixo" style="max-width:135px">
                        <span>R$</span>
                        <input type="number" value="${curVal}" oninput="updateCalcAvulsoVal('${key}', Number(this.value))" />
                      </div>
                    `
                        : ""
                    }
                  </div>
                `;
                })
                .join("")}
            </div>
          </div>
        </section>
      </div>

      <!-- COLUNA DIREITA: RESULTADO + BOTÃO GERAR PROPOSTA -->
      <div class="col-result">
        <div class="result-sticky">
          <div id="calc-summary-top-zone">
            ${renderCalcSummaryTopHtml(c, X)}
          </div>

          <div class="dois" style="border-top:1px solid var(--line);padding-top:12px">
            <div class="campo">
              <span class="campo-label">Desconto Comercial (%)</span>
              <input id="inp-calc-descontoPct" type="number" min="0" max="50" step="0.5" value="${c.descontoPct}" oninput="updateCalcFieldLive('descontoPct', Number(this.value))" />
              <div id="calc-disc-feedback">
                ${renderCalcDiscFeedbackHtml(X)}
              </div>
            </div>

            <div class="campo">
              <span class="campo-label">
                <span>Preço pretendido <span class="help-tip" title="${escapeHtml(HELP_TEXTS.precoPretendido)}">?</span></span>
              </span>
              <div class="prefixo">
                <span>R$</span>
                <input id="inp-calc-precoPretendido" type="number" value="${c.precoPretendido || ""}" placeholder="0" oninput="updateCalcFieldLive('precoPretendido', Number(this.value))" />
              </div>
            </div>
          </div>

          <div id="calc-status-zone">
            ${renderCalcStatusZoneHtml(X)}
          </div>

          <button type="button" class="btn-primary btn-cta-hero" onclick="convertSimulationToProposal()">
            📄 GERAR PROPOSTA
          </button>
        </div>
      </div>
    </div>

    <section class="card" style="margin-top:20px;padding:18px">
      <h2 style="font-size:16px;margin-bottom:6px">📋 Elementos da proposta (para o contrato — Res. CFC 1.590/2020)</h2>
      <p style="font-size:12.5px;color:var(--muted);margin-bottom:14px">
        A Res. CFC 1.590/2020 exige contrato escrito discriminando o valor de cada serviço. Os elementos abaixo justificam tecnicamente o honorário conforme a NBC PG 01.
      </p>
      <div id="calc-elements-grid" class="quatro">
        ${renderCalcElementsGridHtml(c, X)}
      </div>
    </section>

    <section class="card" style="margin-top:20px">
      <div class="card-head">
        <div class="card-titles">
          <span class="card-title">Simulações Salvas do Escritório (${STATE.simulations.length})</span>
          <span class="card-sub">Edite, duplique ou converta qualquer simulação salva em proposta comercial</span>
        </div>
      </div>
      <div class="card-body">
        ${
          STATE.simulations.length === 0
            ? `<p style="font-size:13px;color:var(--muted)">Nenhuma simulação salva ainda.</p>`
            : `
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Título / Empresa</th>
                  <th>Regime / Atividade</th>
                  <th>Horas/Mês</th>
                  <th>Piso Custo</th>
                  <th>Honorário Final</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                ${STATE.simulations
                  .map(
                    (s) => `
                  <tr>
                    <td>
                      <strong>${escapeHtml(s.title)}</strong>
                      <div style="font-size:11px;color:var(--muted)">${escapeHtml(s.company_name || s.client_name || "-")}</div>
                    </td>
                    <td>${escapeHtml(s.tax_regime.toUpperCase())} · ${escapeHtml(s.economic_activity)}</td>
                    <td>${Number(s.total_hours).toFixed(1)} h</td>
                    <td>${fmtBRL2(s.floor_cost)}</td>
                    <td><strong class="gold">${fmtBRL2(s.final_monthly_fee)}</strong></td>
                    <td style="display:flex;gap:6px">
                      <button class="btn-xs" onclick="loadSimulationIntoCalc('${s.id}')">✏️ Carregar/Editar</button>
                      <button class="btn-xs" onclick="duplicateSimulation('${s.id}')">📑 Duplicar</button>
                      <button class="btn-xs" onclick="deleteSimulation('${s.id}')">🗑️</button>
                    </td>
                  </tr>
                `
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        `
        }
      </div>
    </section>
  `;
}

function cHoras() {
  return Number(STATE.calc.horasProdutivas) || 320;
}

/**
 * Atualização cirúrgica de alta performance (< 0.1ms) nos painéis de resultado da calculadora
 * sem reconstruir os inputs onde o usuário está digitando ou arrastando!
 */
function refreshCalcLiveOutputs() {
  const X = runCalculationSync();
  const c = STATE.calc;

  const topZone = document.getElementById("calc-summary-top-zone");
  if (topZone) topZone.innerHTML = renderCalcSummaryTopHtml(c, X);

  const discFb = document.getElementById("calc-disc-feedback");
  if (discFb) discFb.innerHTML = renderCalcDiscFeedbackHtml(X);

  const statusZone = document.getElementById("calc-status-zone");
  if (statusZone) statusZone.innerHTML = renderCalcStatusZoneHtml(X);

  const elemGrid = document.getElementById("calc-elements-grid");
  if (elemGrid) elemGrid.innerHTML = renderCalcElementsGridHtml(c, X);

  const chEl = document.getElementById("calc-mini-custo-hora");
  if (chEl) chEl.textContent = fmtBRL2(X.custoHora);

  const htEl = document.getElementById("calc-mini-hora-tecnica");
  if (htEl) htEl.textContent = fmtBRL2(X.horaTecnica);

  const fatLbl = document.getElementById("lbl-fat-val");
  if (fatLbl) fatLbl.textContent = fmtBRL0(c.faturamento);
}

function updateCalcFieldLive(field, value, syncNumberInput = false) {
  STATE.calc[field] = value;
  if (field === "faturamento") {
    if (syncNumberInput) {
      const numInp = document.getElementById("inp-calc-faturamento");
      if (numInp) numInp.value = value;
    } else {
      const rngInp = document.getElementById("rng-calc-faturamento");
      if (rngInp) rngInp.value = Math.min(1500000, Number(value) || 0);
    }
  }
  refreshCalcLiveOutputs();
}

function stepCalcField(field, delta, minVal = 0) {
  const cur = Number(STATE.calc[field]) || 0;
  const next = Math.max(minVal, cur + delta);
  STATE.calc[field] = next;
  const inp = document.getElementById(`inp-calc-${field}`);
  if (inp) inp.value = next;
  refreshCalcLiveOutputs();
}

function updateCalcField(field, value) {
  STATE.calc[field] = value;
  runCalculationSync();
  renderApp();
}

function toggleCalcObrigacao(obId, btnEl = null) {
  STATE.calc.obrigacoes[obId] = !STATE.calc.obrigacoes[obId];
  if (btnEl) {
    const isOn = !!STATE.calc.obrigacoes[obId];
    btnEl.classList.toggle("check-on", isOn);
    const box = btnEl.querySelector(".box");
    if (box) box.textContent = isOn ? "✓" : "";
    refreshCalcLiveOutputs();
    return;
  }
  runCalculationSync();
  renderApp();
}

function toggleRecurringService(srvId, btnEl = null) {
  const idx = STATE.calc.servicosRecorrentesIds.indexOf(srvId);
  if (idx >= 0) STATE.calc.servicosRecorrentesIds.splice(idx, 1);
  else STATE.calc.servicosRecorrentesIds.push(srvId);
  if (btnEl) {
    const isOn = STATE.calc.servicosRecorrentesIds.includes(srvId);
    btnEl.classList.toggle("check-on", isOn);
    const box = btnEl.querySelector(".box");
    if (box) box.textContent = isOn ? "✓" : "";
    refreshCalcLiveOutputs();
    return;
  }
  runCalculationSync();
  renderApp();
}

function toggleCalcAvulso(avId, defaultVal) {
  if (STATE.calc.avulsos[avId]) {
    delete STATE.calc.avulsos[avId];
  } else {
    STATE.calc.avulsos[avId] = { valor: defaultVal };
  }
  runCalculationSync();
  renderApp();
}

function updateCalcAvulsoVal(avId, val) {
  STATE.calc.avulsos[avId] = { valor: val };
  refreshCalcLiveOutputs();
}

async function importOpportunityIntoCalculator(oppId) {
  if (!oppId) return;
  const opp = STATE.crm.opportunities.find((o) => o.id === oppId);
  if (!opp) return;

  STATE.calc.opportunityId = opp.id;
  STATE.calc.clientId = opp.client_id || "";
  STATE.calc.clientName = opp.contact_name;
  STATE.calc.companyName = opp.company_name;
  STATE.calc.cpfCnpj = opp.cpf_cnpj || "";
  STATE.calc.contactEmail = opp.email || "";
  STATE.calc.contactWhatsapp = opp.whatsapp || "";
  STATE.calc.title = `Estudo Técnico — ${opp.company_name}`;
  STATE.calc.regime = opp.current_tax_regime || "simples";
  STATE.calc.atividade = opp.economic_activity || "servicos";
  STATE.calc.faturamento = Number(opp.estimated_revenue || 50000);
  STATE.calc.funcionarios = Number(opp.employees_count ?? 2);
  STATE.calc.socios = Number(opp.partners_count ?? 1);
  STATE.calc.filiais = Number(opp.branches_count ?? 0);
  STATE.calc.volume = Number(opp.invoice_volume_index ?? 1);

  try {
    const diagRes = await apiFetch(`/api/crm/opportunities/${oppId}/diagnostic`);
    if (diagRes.diagnostic && diagRes.diagnostic.id) {
      const d = diagRes.diagnostic;
      STATE.calc.regime = d.tax_regime || STATE.calc.regime;
      STATE.calc.atividade = d.economic_activity || STATE.calc.atividade;
      STATE.calc.faturamento = Number(d.monthly_revenue || STATE.calc.faturamento);
      STATE.calc.volume = Number(d.invoice_volume_index ?? STATE.calc.volume);
      STATE.calc.funcionarios = Number(d.employees_count ?? STATE.calc.funcionarios);
      STATE.calc.socios = Number(d.partners_count ?? STATE.calc.socios);
      STATE.calc.filiais = Number(d.branches_count ?? STATE.calc.filiais);
      STATE.calc.complexidade = d.operational_complexity || "padrao";
      STATE.calc.obrigacoes = d.specific_obligations || {};
      STATE.calc.avulsos = d.desired_services || {};
    }
  } catch (_) {}

  await runCalculation();
  showToast(`Dados de "${opp.company_name}" importados sem redigitação!`);
  renderApp();
}

async function saveCurrentSimulation() {
  try {
    const res = await apiFetch("/api/simulations", {
      method: "POST",
      body: JSON.stringify(STATE.calc)
    });
    STATE.calc.id = res.simulationId;
    await Promise.all([loadSimulations(), loadCRMPipeline()]);
    showToast("Simulação salva e sincronizada com sucesso!");
    renderApp();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function loadSimulationIntoCalc(simId) {
  const s = STATE.simulations.find((item) => item.id === simId);
  if (!s) return;
  STATE.calc = {
    ...STATE.calc,
    id: s.id,
    opportunityId: s.opportunity_id || "",
    clientId: s.client_id || "",
    title: s.title,
    clientName: s.client_name || "",
    companyName: s.company_name || "",
    cpfCnpj: s.cpf_cnpj || "",
    regime: s.tax_regime,
    atividade: s.economic_activity,
    faturamento: s.monthly_revenue,
    funcionarios: s.employees_count,
    socios: s.partners_count,
    filiais: s.branches_count,
    volume: s.invoice_volume_index,
    complexidade: s.operational_complexity || "padrao",
    selectedPlanId: s.selected_plan_id || "",
    obrigacoes: s.selected_obligations || {},
    avulsos: s.selected_one_off_services || {},
    servicosRecorrentesIds: s.selected_recurring_services || [],
    taxaImplantacao: s.setup_fee,
    descontoPct: s.discount_pct,
    precoPretendido: s.intended_price
  };
  await runCalculation();
  showToast(`Simulação "${s.title}" carregada.`);
  renderApp();
}

async function duplicateSimulation(simId) {
  await apiFetch(`/api/simulations/${simId}/duplicate`, { method: "POST" });
  await loadSimulations();
  showToast("Simulação duplicada!");
  renderApp();
}

async function deleteSimulation(simId) {
  await apiFetch(`/api/simulations/${simId}`, { method: "DELETE" });
  await loadSimulations();
  showToast("Simulação excluída.");
  renderApp();
}

async function resetCalcToDefaults() {
  const pv = STATE.parameters?.activeVersion || {};
  STATE.calc = {
    id: null,
    opportunityId: "",
    clientId: "",
    title: "Nova Simulação",
    clientName: "",
    companyName: "",
    cpfCnpj: "",
    contactEmail: "",
    contactWhatsapp: "",
    custoFixo: pv.fixed_cost_monthly || 28000,
    horasProdutivas: pv.productive_hours_monthly || 320,
    margem: pv.target_margin_pct || 30,
    regime: "simples",
    atividade: "servicos",
    faturamento: 50000,
    funcionarios: 2,
    socios: 1,
    filiais: 0,
    volume: 1,
    complexidade: "padrao",
    selectedPlanId: "",
    servicosRecorrentesIds: [],
    obrigacoes: {},
    avulsos: {},
    taxaImplantacao: pv.default_setup_fee || 450,
    descontoPct: 0,
    precoPretendido: 0
  };
  await runCalculation();
  renderApp();
}

async function convertSimulationToProposal() {
  const X = await runCalculation();
  if (!X.descontoAutorizado) {
    showToast(`Desconto de ${STATE.calc.descontoPct}% excede sua alçada (${X.descontoMaximoPermitidoPct}%) ou fica abaixo do piso de custo!`, true);
    return;
  }

  const simRes = await apiFetch("/api/simulations", {
    method: "POST",
    body: JSON.stringify(STATE.calc)
  });

  const c = STATE.calc;
  const tpl = STATE.templates[0] || {};
  const modal = document.getElementById("modal-container");
  modal.innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this)this.remove()">
      <div class="modal-box">
        <div class="modal-head">
          <h3>🚀 Gerar Proposta Comercial Integrada</h3>
          <button class="btn-xs" onclick="document.getElementById('modal-container').innerHTML=''">✕</button>
        </div>
        <div class="dois">
          <div class="campo">
            <label class="campo-label">Empresa / Razão Social *</label>
            <input type="text" id="prp_company" value="${escapeHtml(c.companyName || "Empresa Cliente Ltda.")}" />
          </div>
          <div class="campo">
            <label class="campo-label">Responsável / Contato *</label>
            <input type="text" id="prp_client" value="${escapeHtml(c.clientName || "Sócio Administrador")}" />
          </div>
        </div>
        <div class="tres">
          <div class="campo">
            <label class="campo-label">CNPJ / CPF</label>
            <input type="text" id="prp_doc" value="${escapeHtml(c.cpfCnpj)}" placeholder="00.000.000/0001-00" />
          </div>
          <div class="campo">
            <label class="campo-label">E-mail para Envio</label>
            <input type="email" id="prp_email" value="${escapeHtml(c.contactEmail)}" placeholder="cliente@empresa.com.br" />
          </div>
          <div class="campo">
            <label class="campo-label">WhatsApp</label>
            <input type="text" id="prp_whats" value="${escapeHtml(c.contactWhatsapp)}" placeholder="(11) 99999-9999" />
          </div>
        </div>
        <div class="tres">
          <div class="campo">
            <label class="campo-label">Honorário Mensal Final</label>
            <input type="number" step="0.01" id="prp_monthly" value="${X.honorarioFinal}" />
          </div>
          <div class="campo">
            <label class="campo-label">Taxa de Implantação (R$)</label>
            <input type="number" step="0.01" id="prp_setup" value="${X.taxaImplantacao}" />
          </div>
          <div class="campo">
            <label class="campo-label">Total Serviços Avulsos (R$)</label>
            <input type="number" step="0.01" id="prp_oneoff" value="${X.totalAvulsos}" readonly />
          </div>
        </div>
        <div class="campo">
          <label class="campo-label">Título de Capa da Proposta</label>
          <input type="text" id="prp_cover" value="Proposta Técnica e Comercial — ${escapeHtml(c.companyName || "Assessoria Contábil")}" />
        </div>
        <div class="campo">
          <label class="campo-label">Escopo Técnico (Gerado automaticamente conforme Res. CFC 1.590/2020)</label>
          <textarea id="prp_scope">Prestação de serviços contábeis, fiscais e trabalhistas para empresa no regime ${X.regimeRotulo} (${X.atividadeRotulo}), dimensionada em ${X.horasTotais.toFixed(1)} horas técnicas mensais conforme NBC PG 01, contemplando movimentação de ${X.volumeRotulo}, ${c.funcionarios} funcionário(s) e ${c.socios} sócio(s).</textarea>
        </div>
        <div class="dois">
          <div class="campo">
            <label class="campo-label">Condições de Pagamento</label>
            <input type="text" id="prp_terms" value="${escapeHtml(tpl.payment_terms_default || "Boleto ou PIX até o dia 10 do mês subsequente.")}" />
          </div>
          <div class="campo">
            <label class="campo-label">Data de Validade</label>
            <input type="date" id="prp_valid" value="${new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10)}" />
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:10px">
          <button class="btn-secondary" onclick="document.getElementById('modal-container').innerHTML=''">Cancelar</button>
          <button class="btn-primary" onclick="submitNewProposal('${simRes.simulationId}')">✓ Criar Proposta Comercial</button>
        </div>
      </div>
    </div>
  `;
}

async function submitNewProposal(simulationId) {
  const X = STATE.calcResult;
  try {
    const res = await apiFetch("/api/proposals", {
      method: "POST",
      body: JSON.stringify({
        opportunity_id: STATE.calc.opportunityId || null,
        client_id: STATE.calc.clientId || null,
        simulation_id: simulationId,
        company_name: document.getElementById("prp_company").value,
        client_name: document.getElementById("prp_client").value,
        cpf_cnpj: document.getElementById("prp_doc").value,
        contact_email: document.getElementById("prp_email").value,
        contact_whatsapp: document.getElementById("prp_whats").value,
        plan_name: X.planName || `${X.regimeRotulo} (${X.atividadeRotulo})`,
        services_summary: X.breakdown,
        one_off_services: X.avulsosSel,
        monthly_fee_base: X.sugerido,
        discount_pct: STATE.calc.descontoPct,
        monthly_fee_final: parseFloat(document.getElementById("prp_monthly").value) || X.honorarioFinal,
        setup_fee: parseFloat(document.getElementById("prp_setup").value) || 0,
        one_off_total: X.totalAvulsos,
        cover_title: document.getElementById("prp_cover").value,
        technical_scope_text: document.getElementById("prp_scope").value,
        payment_conditions: document.getElementById("prp_terms").value,
        valid_until: document.getElementById("prp_valid").value
      })
    });
    document.getElementById("modal-container").innerHTML = "";
    await Promise.all([loadProposals(), loadCRMPipeline()]);
    showToast(`Proposta ${res.proposalNumber} gerada com sucesso!`);
    await navigateTo("propostas");
  } catch (err) {
    showToast(err.message, true);
  }
}

/* =========================================================================
   3. MÓDULO DE PROPOSTAS COMERCIAIS (EDITOR, ENVIOS, VERSÕES, LINKS E ACEITE)
   ========================================================================= */
function getPublicProposalLink(publicToken) {
  if (STATE.runtimeMode === "server_api") {
    const origin = window.location.origin && window.location.origin !== "null" ? window.location.origin : "";
    return `${origin}/p/${encodeURIComponent(publicToken)}`;
  }
  const baseUrl = window.location.href.split("?")[0].split("#")[0];
  return `${baseUrl}?proposta=${encodeURIComponent(publicToken)}`;
}

function updatePropostasFilter(key, val) {
  STATE.propostasFilter[key] = val;
  renderApp();
}

function togglePropostasCol(colKey) {
  STATE.propostasFilter.cols[colKey] = !STATE.propostasFilter.cols[colKey];
  renderApp();
}

function clearPropostasFilters() {
  STATE.propostasFilter.q = "";
  STATE.propostasFilter.status = "";
  STATE.propostasFilter.cols = { doc: true, contato: true, mensal: true, implantacao: true, validade: true, versao: true };
  renderApp();
  showToast("Filtros e colunas de propostas restaurados.");
}

function openProposalPreviewModal(propId) {
  const p = STATE.proposals.find((x) => x.id === propId);
  if (!p) return;
  const servicesRows = (p.services_summary || [])
    .map(
      (s) => `
      <tr>
        <td>${escapeHtml(s.nome)}</td>
        <td style="text-align:center">${Number(s.horas || 0).toFixed(1)} h/mês</td>
        <td style="text-align:right;font-weight:700">${fmtBRL2(s.valor)}</td>
      </tr>
    `
    )
    .join("");

  const modal = document.getElementById("modal-container");
  modal.innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this)this.remove()">
      <div class="modal-box" style="max-width:820px">
        <div class="modal-head">
          <h3>👁️ Pré-visualização da Proposta — ${escapeHtml(p.proposal_number)} (v${p.current_version})</h3>
          <div style="display:flex;gap:8px;align-items:center">
            <a class="btn-secondary" href="${getPublicProposalLink(p.public_token)}" target="_blank">🖨️ Abrir Página p/ Impressão PDF</a>
            <button class="btn-xs" onclick="document.getElementById('modal-container').innerHTML=''">✕</button>
          </div>
        </div>
        <div class="card" style="background:var(--navy-3)">
          <div class="card-body" style="padding:22px;gap:14px">
            <div style="border-bottom:1px solid var(--line);padding-bottom:12px;display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">
              <div>
                <span class="tag tag-gold">Status: ${escapeHtml(p.status)} · Versão v${p.current_version}</span>
                <h2 style="font-size:20px;margin-top:6px">${escapeHtml(p.cover_title)}</h2>
                <p style="font-size:12.5px;color:var(--muted)">Cliente: <strong>${escapeHtml(p.company_name)}</strong> (${escapeHtml(p.client_name)}) · CNPJ/CPF: ${escapeHtml(p.cpf_cnpj || "Em abertura")}</p>
              </div>
              <div style="text-align:right">
                <span style="font-size:11px;color:var(--muted);display:block">Investimento Mensal</span>
                <strong class="gold" style="font-size:22px">${fmtBRL2(p.monthly_fee_final)}/mês</strong>
                <span style="font-size:11px;color:var(--muted);display:block">Implantação: ${fmtBRL2(p.setup_fee)}</span>
              </div>
            </div>
            <div>
              <h4 style="color:var(--gold);font-size:13.5px;margin-bottom:4px">1. Apresentação & Diferenciais do Escritório</h4>
              <p style="font-size:12.5px;color:var(--cream);white-space:pre-line">${escapeHtml(p.office_presentation)}</p>
              <p style="font-size:12px;color:var(--muted);white-space:pre-line;margin-top:6px">${escapeHtml(p.differentials_text)}</p>
            </div>
            <div>
              <h4 style="color:var(--gold);font-size:13.5px;margin-bottom:6px">2. Escopo Técnico Discriminado (Res. CFC 1.590/2020)</h4>
              <p style="font-size:12.5px;margin-bottom:8px">${escapeHtml(p.technical_scope_text)}</p>
              <div class="table-responsive">
                <table class="data-table">
                  <thead><tr><th>Departamento / Serviço</th><th style="text-align:center">Horas/Mês</th><th style="text-align:right">Valor</th></tr></thead>
                  <tbody>${servicesRows}</tbody>
                </table>
              </div>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;border-top:1px solid var(--line);padding-top:10px;font-size:12.5px">
              <span><strong>Condições:</strong> ${escapeHtml(p.payment_conditions)} · <strong>Validade:</strong> ${escapeHtml(p.valid_until)}</span>
              <div style="display:flex;gap:8px">
                <button class="btn-secondary" onclick="document.getElementById('modal-container').innerHTML='';openEditProposalModal('${p.id}')">✏️ Editar Proposta</button>
                <button class="btn-primary" onclick="document.getElementById('modal-container').innerHTML=''">Fechar Pré-visualização</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderPropostasView() {
  const allProps = STATE.proposals || [];
  const f = STATE.propostasFilter;
  const cols = f.cols;
  const q = (f.q || "").trim().toLowerCase();

  const props = allProps.filter((p) => {
    if (f.status && p.status !== f.status) return false;
    if (q) {
      const hay = `${p.proposal_number} ${p.company_name} ${p.client_name} ${p.cpf_cnpj || ""} ${p.contact_email || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const statusBadgeColor = (st) => {
    if (st === "Aceita") return "tag-ok";
    if (st === "Recusada" || st === "Cancelada" || st === "Expirada") return "tag-warn";
    if (st === "Enviada" || st === "Visualizada" || st === "Em negociação") return "tag-gold";
    return "";
  };

  const vm = STATE.propostasViewMode || "ambos";

  return `
    <!-- BARRA DE FILTROS, BUSCA, COLUNAS CONFIGURÁVEIS E BOTÃO LIMPAR FILTROS (SEÇÃO 5.3 DO PLANO UX/UI) -->
    <div class="filter-bar">
      <div class="campo" style="min-width:220px;flex:1">
        <label class="campo-label">🔍 Buscar Proposta</label>
        <input
          type="text"
          value="${escapeHtml(f.q)}"
          placeholder="Empresa, contato, CNPJ ou nº da proposta..."
          oninput="updatePropostasFilter('q', this.value)"
        />
      </div>

      <div class="campo" style="min-width:170px">
        <label class="campo-label">Status Comercial</label>
        <select onchange="updatePropostasFilter('status', this.value)">
          <option value="">Todos os status (${allProps.length})</option>
          ${["Rascunho", "Enviada", "Visualizada", "Em negociação", "Aceita", "Recusada", "Expirada", "Cancelada"]
            .map((st) => `<option value="${st}" ${f.status === st ? "selected" : ""}>${st}</option>`)
            .join("")}
        </select>
      </div>

      <div class="campo" style="min-width:165px">
        <label class="campo-label">Modo de Exibição</label>
        <select onchange="STATE.propostasViewMode=this.value;renderApp()">
          <option value="ambos" ${vm === "ambos" ? "selected" : ""}>📋 Tabela + Cards</option>
          <option value="tabela" ${vm === "tabela" ? "selected" : ""}>📋 Apenas Tabela</option>
          <option value="cards" ${vm === "cards" ? "selected" : ""}>🗂️ Apenas Cards</option>
        </select>
      </div>

      <div class="filter-actions">
        <button type="button" class="btn-secondary" onclick="clearPropostasFilters()" title="Restaurar busca, status e colunas">
          ↺ Limpar filtros
        </button>
        <button type="button" class="btn-primary" onclick="navigateTo('calculadora')">
          + Nova proposta
        </button>
      </div>
    </div>

    <!-- CONFIGURAÇÃO RÁPIDA DE COLUNAS DA TABELA (SEÇÃO 5.3) -->
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px;font-size:12px;color:var(--muted)">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <strong>Colunas da tabela:</strong>
        <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer"><input type="checkbox" style="width:auto" ${cols.contato ? "checked" : ""} onchange="togglePropostasCol('contato')" /> Contato/CNPJ</label>
        <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer"><input type="checkbox" style="width:auto" ${cols.mensal ? "checked" : ""} onchange="togglePropostasCol('mensal')" /> Honorário Mensal</label>
        <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer"><input type="checkbox" style="width:auto" ${cols.implantacao ? "checked" : ""} onchange="togglePropostasCol('implantacao')" /> Implantação</label>
        <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer"><input type="checkbox" style="width:auto" ${cols.validade ? "checked" : ""} onchange="togglePropostasCol('validade')" /> Validade</label>
        <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer"><input type="checkbox" style="width:auto" ${cols.versao ? "checked" : ""} onchange="togglePropostasCol('versao')" /> Versão</label>
      </div>
      <span>Exibindo <strong>${props.length}</strong> de <strong>${allProps.length}</strong> proposta(s)</span>
    </div>

    ${
      props.length === 0
        ? `
      <div class="empty-state-box" style="margin-bottom:18px">
        <strong style="font-size:15px;color:var(--cream);display:block;margin-bottom:6px">Nenhuma proposta encontrada com os filtros atuais</strong>
        <p style="font-size:12.5px;margin-bottom:12px">Limpe os filtros ativos ou gere uma nova proposta comercial a partir da Calculadora.</p>
        <div style="display:flex;justify-content:center;gap:10px">
          <button class="btn-secondary" onclick="clearPropostasFilters()">↺ Limpar filtros</button>
          <button class="btn-primary" onclick="navigateTo('calculadora')">+ Nova proposta</button>
        </div>
      </div>
    `
        : ""
    }

    ${
      props.length > 0 && (vm === "ambos" || vm === "tabela")
        ? `
      <div class="card" style="margin-bottom:18px">
        <div class="card-head">
          <div class="card-titles">
            <span class="card-title">Tabela Gerencial de Propostas Comerciais</span>
            <span class="card-sub">Visão tabular rápida com filtros, colunas configuráveis e pré-visualização imediata</span>
          </div>
        </div>
        <div class="card-body">
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Nº / Empresa</th>
                  <th>Status</th>
                  ${cols.contato ? `<th>Contato / Documento</th>` : ""}
                  ${cols.mensal ? `<th>Honorário Mensal</th>` : ""}
                  ${cols.implantacao ? `<th>Implantação</th>` : ""}
                  ${cols.validade ? `<th>Validade</th>` : ""}
                  ${cols.versao ? `<th>Versão</th>` : ""}
                  <th>Ações Rápidas</th>
                </tr>
              </thead>
              <tbody>
                ${props
                  .map(
                    (p) => `
                  <tr>
                    <td>
                      <strong>${escapeHtml(p.proposal_number)}</strong>
                      <div style="font-size:12px;color:var(--cream)">${escapeHtml(p.company_name)}</div>
                    </td>
                    <td><span class="tag ${statusBadgeColor(p.status)}">${escapeHtml(p.status)}</span></td>
                    ${
                      cols.contato
                        ? `<td>${escapeHtml(p.client_name)}<div style="font-size:11px;color:var(--muted)">${escapeHtml(p.cpf_cnpj || "Em abertura")}</div></td>`
                        : ""
                    }
                    ${cols.mensal ? `<td><strong class="gold">${fmtBRL2(p.monthly_fee_final)}/mês</strong></td>` : ""}
                    ${cols.implantacao ? `<td>${fmtBRL2(p.setup_fee)}</td>` : ""}
                    ${cols.validade ? `<td>${escapeHtml(p.valid_until || "-")}</td>` : ""}
                    ${cols.versao ? `<td><span class="tag">v${p.current_version}</span></td>` : ""}
                    <td>
                      <div style="display:flex;gap:5px;flex-wrap:wrap">
                        <button class="btn-xs" onclick="openProposalPreviewModal('${p.id}')" title="Pré-visualizar Proposta">👁️ Preview</button>
                        <button class="btn-xs" onclick="openEditProposalModal('${p.id}')" title="Editar / Nova Versão">✏️ Editar</button>
                        <button class="btn-xs" onclick="sendProposalChannel('${p.id}', 'whatsapp')" title="Enviar por WhatsApp">💬 Whats</button>
                        <a class="btn-xs" href="${getPublicProposalLink(p.public_token)}" target="_blank" title="Abrir Link Público / PDF">🔗 PDF</a>
                      </div>
                    </td>
                  </tr>
                `
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `
        : ""
    }

    ${
      props.length > 0 && (vm === "ambos" || vm === "cards")
        ? `
    <div class="col-inputs">
      ${props
        .map(
          (p) => `
          <div class="card">
            <div class="card-body">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap">
                <div>
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap">
                    <span class="tag ${statusBadgeColor(p.status)}">Status: ${escapeHtml(p.status)}</span>
                    <span class="tag">Versão v${p.current_version}</span>
                    <strong style="font-size:15px">${escapeHtml(p.proposal_number)} — ${escapeHtml(p.company_name)}</strong>
                  </div>
                  <div style="font-size:12.5px;color:var(--muted)">
                    Contato: <strong>${escapeHtml(p.client_name)}</strong> (${escapeHtml(p.cpf_cnpj || "CNPJ em abertura")}) ·
                    E-mail: ${escapeHtml(p.contact_email || "-")} · WhatsApp: ${escapeHtml(p.contact_whatsapp || "-")} ·
                    Validade: ${escapeHtml(p.valid_until)}
                  </div>
                </div>

                <div style="text-align:right">
                  <span style="font-size:11px;color:var(--muted);display:block">Honorário Mensal</span>
                  <strong class="gold" style="font-size:22px;font-family:'Syne',sans-serif">${fmtBRL2(p.monthly_fee_final)}/mês</strong>
                  <span style="font-size:11px;color:var(--muted);display:block">Implantação: ${fmtBRL2(p.setup_fee)} | Avulsos: ${fmtBRL2(p.one_off_total)}</span>
                </div>
              </div>

              ${
                p.status === "Aceita"
                  ? `
                <div style="background:rgba(79,180,119,0.12);border:1px solid var(--ok);border-radius:10px;padding:10px 14px;font-size:12.5px">
                  <strong style="color:var(--ok)">✓ Aceite Comercial Registrado:</strong>
                  Responsável: <strong>${escapeHtml(p.accepted_by_name)}</strong> (${escapeHtml(p.accepted_by_document)}) ·
                  Cargo: ${escapeHtml(p.accepted_by_role || "-")} · Data: ${escapeHtml(p.accepted_at)} · Versão Aceita: v${p.accepted_version || p.current_version}
                </div>
              `
                  : ""
              }

              <div style="display:flex;gap:8px;flex-wrap:wrap;padding-top:10px;border-top:1px solid var(--line);align-items:center">
                <button class="btn-secondary" onclick="openProposalPreviewModal('${p.id}')">👁️ Pré-visualizar</button>
                <button class="btn-secondary" onclick="openEditProposalModal('${p.id}')">✏️ Editar / Nova Versão</button>
                <button class="btn-secondary" onclick="sendProposalChannel('${p.id}', 'email')">📧 Enviar por E-mail</button>
                <button class="btn-secondary" onclick="sendProposalChannel('${p.id}', 'whatsapp')">💬 Enviar por WhatsApp</button>
                <a class="btn-secondary" href="${getPublicProposalLink(p.public_token)}" target="_blank">🔗 Abrir Link Exclusivo / PDF</a>
                ${
                  p.status !== "Aceita"
                    ? `<button class="btn-primary" onclick="openAcceptProposalModal('${p.id}')">✓ Registrar Aceite Comercial</button>`
                    : ""
                }
                <select style="width:auto;padding:7px 10px;font-size:12px;margin-left:auto" onchange="changeProposalStatus('${p.id}', this.value)">
                  ${["Rascunho", "Enviada", "Visualizada", "Em negociação", "Aceita", "Recusada", "Expirada", "Cancelada"]
                    .map((st) => `<option value="${st}" ${p.status === st ? "selected" : ""}>Mudar Status: ${st}</option>`)
                    .join("")}
                </select>
              </div>

              <div class="dois" style="font-size:11.5px;color:var(--muted);background:var(--navy-3);padding:10px 12px;border-radius:9px">
                <div>
                  <strong style="color:var(--cream)">Histórico de Versões (${(p.versions || []).length}):</strong>
                  ${(p.versions || [])
                    .map((v) => `<div>• v${v.version_number}: ${fmtBRL2(v.monthly_fee_final)}/mês (Desc. ${v.discount_pct}%) — ${v.created_at}</div>`)
                    .join("")}
                </div>
                <div>
                  <strong style="color:var(--cream)">Rastreamento de Eventos (${(p.events || []).length}):</strong>
                  ${(p.events || [])
                    .slice(0, 4)
                    .map((ev) => `<div>• [${escapeHtml(ev.event_type.toUpperCase())}] via ${escapeHtml(ev.channel || "-")} para ${escapeHtml(ev.recipient || "-")} (${ev.created_at})</div>`)
                    .join("")}
                </div>
              </div>
            </div>
          </div>
        `
        )
        .join("")}
    </div>
    `
        : ""
    }
  `;
}

async function sendProposalChannel(propId, channel) {
  try {
    const res = await apiFetch(`/api/proposals/${propId}/send`, {
      method: "POST",
      body: JSON.stringify({ channel })
    });
    await Promise.all([loadProposals(), loadCRMPipeline()]);
    if (channel === "whatsapp" && res.meta && res.meta.whatsapp_message) {
      navigator.clipboard?.writeText(res.meta.whatsapp_message).catch(() => {});
      showToast("Mensagem e link de WhatsApp copiados e registrados!");
      alert("Mensagem formatada para WhatsApp:\n\n" + res.meta.whatsapp_message);
    } else {
      showToast(`Proposta enviada via ${channel.toUpperCase()}! Link: ${res.publicLink}`);
    }
    renderApp();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function changeProposalStatus(propId, status) {
  if (status === "Aceita") {
    openAcceptProposalModal(propId);
    return;
  }
  await apiFetch(`/api/proposals/${propId}/status`, {
    method: "POST",
    body: JSON.stringify({ status })
  });
  await Promise.all([loadProposals(), loadCRMPipeline()]);
  showToast(`Status da proposta alterado para: ${status}`);
  renderApp();
}

function openAcceptProposalModal(propId) {
  const p = STATE.proposals.find((x) => x.id === propId);
  if (!p) return;
  const modal = document.getElementById("modal-container");
  modal.innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this)this.remove()">
      <div class="modal-box">
        <div class="modal-head">
          <h3>✓ Registrar Aceite Comercial — ${escapeHtml(p.proposal_number)} (v${p.current_version})</h3>
          <button class="btn-xs" onclick="document.getElementById('modal-container').innerHTML=''">✕</button>
        </div>
        <p style="font-size:12.5px;color:var(--muted)">
          O aceite comercial registra a aprovação da proposta e move automaticamente a oportunidade no CRM para <strong>7. Ganho</strong>.
          <em>Nota: O aceite comercial não substitui automaticamente o contrato assinado eletronicamente (Res. CFC 1.590/2020).</em>
        </p>
        <div class="dois">
          <div class="campo">
            <label class="campo-label">Nome do Responsável pelo Aceite *</label>
            <input type="text" id="acc_mdl_name" value="${escapeHtml(p.client_name)}" />
          </div>
          <div class="campo">
            <label class="campo-label">CPF / Documento do Responsável *</label>
            <input type="text" id="acc_mdl_doc" value="${escapeHtml(p.cpf_cnpj || "")}" placeholder="000.000.000-00" />
          </div>
        </div>
        <div class="dois">
          <div class="campo">
            <label class="campo-label">Cargo / Vínculo</label>
            <input type="text" id="acc_mdl_role" value="Sócio-Administrador" />
          </div>
          <div class="campo">
            <label class="campo-label">E-mail do Responsável</label>
            <input type="email" id="acc_mdl_email" value="${escapeHtml(p.contact_email || "")}" />
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:10px">
          <button class="btn-secondary" onclick="document.getElementById('modal-container').innerHTML=''">Cancelar</button>
          <button class="btn-primary" onclick="submitInternalProposalAccept('${p.id}')">Confirmar Aceite e Marcar Ganho</button>
        </div>
      </div>
    </div>
  `;
}

async function submitInternalProposalAccept(propId) {
  await apiFetch(`/api/proposals/${propId}/status`, {
    method: "POST",
    body: JSON.stringify({
      status: "Aceita",
      accepted_by_name: document.getElementById("acc_mdl_name").value,
      accepted_by_document: document.getElementById("acc_mdl_doc").value,
      accepted_by_role: document.getElementById("acc_mdl_role").value,
      accepted_by_email: document.getElementById("acc_mdl_email").value
    })
  });
  document.getElementById("modal-container").innerHTML = "";
  await Promise.all([loadProposals(), loadCRMPipeline()]);
  showToast("Aceite comercial registrado e oportunidade marcada como GANHA no CRM!");
  renderApp();
}

function openEditProposalModal(propId) {
  const p = STATE.proposals.find((x) => x.id === propId);
  if (!p) return;
  const modal = document.getElementById("modal-container");
  modal.innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this)this.remove()">
      <div class="modal-box">
        <div class="modal-head">
          <h3>✏️ Editor de Proposta (${escapeHtml(p.proposal_number)}) — Gerará Versão v${p.current_version + 1}</h3>
          <button class="btn-xs" onclick="document.getElementById('modal-container').innerHTML=''">✕</button>
        </div>
        <div class="dois">
          <div class="campo">
            <label class="campo-label">Empresa</label>
            <input type="text" id="edt_prp_company" value="${escapeHtml(p.company_name)}" />
          </div>
          <div class="campo">
            <label class="campo-label">Contato</label>
            <input type="text" id="edt_prp_client" value="${escapeHtml(p.client_name)}" />
          </div>
        </div>
        <div class="tres">
          <div class="campo">
            <label class="campo-label">Honorário Base (R$)</label>
            <input type="number" step="0.01" id="edt_prp_base" value="${p.monthly_fee_base}" />
          </div>
          <div class="campo">
            <label class="campo-label">Desconto (%)</label>
            <input type="number" step="0.5" id="edt_prp_disc" value="${p.discount_pct}" />
          </div>
          <div class="campo">
            <label class="campo-label">Taxa de Implantação (R$)</label>
            <input type="number" step="0.01" id="edt_prp_setup" value="${p.setup_fee}" />
          </div>
        </div>
        <div class="campo">
          <label class="campo-label">Título da Capa</label>
          <input type="text" id="edt_prp_cover" value="${escapeHtml(p.cover_title)}" />
        </div>
        <div class="campo">
          <label class="campo-label">Apresentação do Escritório</label>
          <textarea id="edt_prp_pres">${escapeHtml(p.office_presentation)}</textarea>
        </div>
        <div class="campo">
          <label class="campo-label">Diferenciais Competitivos</label>
          <textarea id="edt_prp_diff">${escapeHtml(p.differentials_text)}</textarea>
        </div>
        <div class="campo">
          <label class="campo-label">Escopo Técnico</label>
          <textarea id="edt_prp_scope">${escapeHtml(p.technical_scope_text)}</textarea>
        </div>
        <div class="campo">
          <label class="campo-label">Próximos Passos</label>
          <textarea id="edt_prp_next">${escapeHtml(p.next_steps_text)}</textarea>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:10px">
          <button class="btn-secondary" onclick="document.getElementById('modal-container').innerHTML=''">Cancelar</button>
          <button class="btn-primary" onclick="submitEditProposal('${p.id}')">Salvar Nova Versão (v${p.current_version + 1})</button>
        </div>
      </div>
    </div>
  `;
}

async function submitEditProposal(propId) {
  const base = parseFloat(document.getElementById("edt_prp_base").value) || 0;
  const disc = parseFloat(document.getElementById("edt_prp_disc").value) || 0;
  const finalFee = Math.max(0, base * (1 - disc / 100));

  await apiFetch(`/api/proposals/${propId}`, {
    method: "PUT",
    body: JSON.stringify({
      company_name: document.getElementById("edt_prp_company").value,
      client_name: document.getElementById("edt_prp_client").value,
      monthly_fee_base: base,
      discount_pct: disc,
      monthly_fee_final: finalFee,
      setup_fee: parseFloat(document.getElementById("edt_prp_setup").value) || 0,
      cover_title: document.getElementById("edt_prp_cover").value,
      office_presentation: document.getElementById("edt_prp_pres").value,
      differentials_text: document.getElementById("edt_prp_diff").value,
      technical_scope_text: document.getElementById("edt_prp_scope").value,
      next_steps_text: document.getElementById("edt_prp_next").value
    })
  });
  document.getElementById("modal-container").innerHTML = "";
  await loadProposals();
  showToast("Nova versão da proposta salva com histórico preservado!");
  renderApp();
}

/**
 * Portal Público Standalone de Proposta Comercial & Impressão PDF para GitHub Pages (?proposta=<token>)
 */
function renderPublicProposalStandaloneView(publicToken) {
  const db = getOrInitBrowserDB();
  const prop = db.proposals.find((p) => p.public_token === publicToken);
  const root = getRootContainer();
  if (!prop) {
    root.innerHTML = `<div style="padding:40px;text-align:center"><h2>Proposta não encontrada.</h2><br/><a class="btn-primary" href="./index.html">Voltar à Plataforma</a></div>`;
    return;
  }
  const tenant = db.tenants.find((t) => t.id === prop.tenant_id) || db.tenants[0];
  applyTenantTheme(tenant);

  if (prop.status === "Enviada") {
    prop.status = "Visualizada";
    prop.viewed_at = nowISO();
    prop.events.unshift({ id: uid("pev"), event_type: "visualizada", channel: "Link Público", recipient: prop.client_name, created_at: nowISO() });
    if (prop.opportunity_id) {
      const negStg = db.stages.find((s) => s.tenant_id === prop.tenant_id && s.slug === "negociacao");
      const opp = db.opportunities.find((o) => o.id === prop.opportunity_id);
      if (opp && negStg) opp.stage_id = negStg.id;
    }
    saveBrowserDB(db);
  }

  const servicesRows = (prop.services_summary || [])
    .map(
      (s) => `
    <tr>
      <td>${escapeHtml(s.nome)}</td>
      <td style="text-align:center">${Number(s.horas || 0).toFixed(1)} h/mês</td>
      <td style="text-align:right;font-weight:700">${fmtBRL2(s.valor)}</td>
    </tr>
  `
    )
    .join("");

  root.innerHTML = `
    <div class="page-container" style="max-width:920px">
      <div class="card no-print" style="margin-bottom:16px">
        <div class="card-body" style="flex-direction:row;justify-content:space-between;align-items:center;flex-wrap:wrap">
          <div>
            <strong>${escapeHtml(tenant.trade_name || tenant.name)}</strong>
            <span style="font-size:12px;color:var(--muted);margin-left:8px">Proposta #${escapeHtml(prop.proposal_number)} · Versão v${prop.current_version}</span>
          </div>
          <div style="display:flex;gap:8px">
            <a class="btn-secondary" href="./index.html">← Voltar ao Sistema</a>
            <button class="btn-primary" onclick="window.print()">🖨️ Baixar / Imprimir PDF Profissional</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-body" style="padding:30px">
          <div style="border-bottom:1px solid var(--line);padding-bottom:20px">
            <span class="tag tag-gold">Status: ${escapeHtml(prop.status)} · Versão v${prop.current_version}</span>
            <h1 style="font-size:24px;margin-top:10px">${escapeHtml(prop.cover_title)}</h1>
            <p style="color:var(--muted);font-size:13.5px">Elaborada para <strong>${escapeHtml(prop.company_name)}</strong> (A/C: ${escapeHtml(prop.client_name)}) · Validade: ${escapeHtml(prop.valid_until)}</p>
          </div>

          <div>
            <h3 style="color:var(--gold);font-size:16px;margin-bottom:6px">1. Apresentação do Escritório</h3>
            <p style="font-size:13.5px;white-space:pre-line">${escapeHtml(prop.office_presentation)}</p>
          </div>

          <div>
            <h3 style="color:var(--gold);font-size:16px;margin-bottom:6px">2. Diferenciais do Atendimento</h3>
            <p style="font-size:13.5px;white-space:pre-line">${escapeHtml(prop.differentials_text)}</p>
          </div>

          <div>
            <h3 style="color:var(--gold);font-size:16px;margin-bottom:6px">3. Escopo Técnico Discriminado (Res. CFC 1.590/2020 e NBC PG 01)</h3>
            <p style="font-size:13.5px;margin-bottom:10px">${escapeHtml(prop.technical_scope_text)}</p>
            <div class="table-responsive">
              <table class="data-table">
                <thead><tr><th>Departamento / Atividade Técnica</th><th style="text-align:center">Alocação</th><th style="text-align:right">Valor Mensal</th></tr></thead>
                <tbody>${servicesRows}</tbody>
              </table>
            </div>
          </div>

          <div>
            <h3 style="color:var(--gold);font-size:16px;margin-bottom:10px">4. Investimento e Condições</h3>
            <div class="tres">
              <div class="kpi-card"><span>Honorário Base</span><strong>${fmtBRL2(prop.monthly_fee_base)}</strong></div>
              <div class="kpi-card" style="border-color:var(--gold)"><span>Honorário Mensal Final</span><strong class="gold">${fmtBRL2(prop.monthly_fee_final)}/mês</strong></div>
              <div class="kpi-card"><span>Taxa de Implantação</span><strong>${fmtBRL2(prop.setup_fee)}</strong></div>
            </div>
            <p style="font-size:13px;margin-top:8px"><strong>Condições de Pagamento:</strong> ${escapeHtml(prop.payment_conditions)}</p>
          </div>

          ${
            prop.status === "Aceita"
              ? `
            <div style="background:rgba(79,180,119,0.14);border:1px solid var(--ok);padding:16px;border-radius:12px">
              <h3 style="color:var(--ok)">✓ Aceite Comercial Registrado</h3>
              <p style="font-size:13px">Responsável: <strong>${escapeHtml(prop.accepted_by_name)}</strong> (${escapeHtml(prop.accepted_by_document)}) · Data: ${escapeHtml(prop.accepted_at)}</p>
            </div>
          `
              : `
            <div class="card no-print" style="background:var(--navy-3);padding:20px">
              <h3 style="color:var(--gold);margin-bottom:10px">Formalizar Aceite Comercial desta Proposta</h3>
              <div class="dois">
                <div class="campo"><label class="campo-label">Nome Completo *</label><input type="text" id="pub_acc_name" value="${escapeHtml(prop.client_name)}" /></div>
                <div class="campo"><label class="campo-label">CPF / CNPJ *</label><input type="text" id="pub_acc_doc" value="${escapeHtml(prop.cpf_cnpj)}" /></div>
              </div>
              <p style="font-size:12px;color:var(--muted);margin:10px 0">
                Nota Legal: O aceite comercial registra a aprovação desta proposta (v${prop.current_version}) e não substitui automaticamente o Contrato de Prestação de Serviços Contábeis assinado eletronicamente (Res. CFC 1.590/2020).
              </p>
              <button class="btn-primary" onclick="confirmPublicProposalBrowser('${prop.id}')">✓ CONFIRMAR ACEITE COMERCIAL</button>
            </div>
          `
          }
        </div>
      </div>
    </div>
  `;
}

async function confirmPublicProposalBrowser(propId) {
  const name = document.getElementById("pub_acc_name").value;
  const doc = document.getElementById("pub_acc_doc").value;
  if (!name || !doc) {
    showToast("Preencha nome e CPF/CNPJ do responsável.", true);
    return;
  }
  await apiFetch(`/api/proposals/${propId}/status`, {
    method: "POST",
    body: JSON.stringify({
      status: "Aceita",
      accepted_by_name: name,
      accepted_by_document: doc
    })
  });
  renderPublicProposalStandaloneView(STATE.publicProposalToken);
  showToast("Aceite comercial confirmado com sucesso!");
}

/* =========================================================================
   4. MÓDULO CRM DE VENDAS ESPECIALIZADO EM CONTABILIDADE
      SEÇÃO 5.4 DO PLANO UX/UI: KANBAN + VISÃO EM LISTA, FILTROS COM LIMPAR,
      TEMPO PARADO, VENDEDOR RESPONSÁVEL E PAINEL LATERAL DIREITO (DRAWER)
   ========================================================================= */
function updateCrmFilter(key, val) {
  STATE.crmFilter[key] = val;
  renderApp();
}

function clearCrmFilters() {
  STATE.crmFilter = { q: "", stage: "", seller: "", regime: "" };
  renderApp();
  showToast("Filtros do CRM limpos.");
}

function getLeadIdleDays(op) {
  const refStr = op.updated_at || op.created_at;
  if (!refStr) return 0;
  const dt = new Date(refStr.replace(" ", "T"));
  if (isNaN(dt.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - dt.getTime()) / 86400000));
}

function getSellerNameForOpp(op) {
  if (op.assigned_seller_name) return op.assigned_seller_name;
  const s = (STATE.crm.sellers || []).find((x) => x.id === op.assigned_seller_id);
  return s ? s.name : STATE.currentUser?.name || "Consultor Comercial";
}

function getFilteredCrmOpportunities() {
  const cf = STATE.crmFilter;
  const q = (cf.q || "").trim().toLowerCase();
  return (STATE.crm.opportunities || []).filter((op) => {
    if (cf.stage && op.stage_id !== cf.stage) return false;
    if (cf.seller && op.assigned_seller_id !== cf.seller) return false;
    if (cf.regime && (op.current_tax_regime || "simples") !== cf.regime) return false;
    if (q) {
      const hay = `${op.company_name} ${op.contact_name} ${op.cpf_cnpj || ""} ${op.email || ""} ${op.whatsapp || ""} ${op.lead_origin || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

async function openLeadDrawer(oppId) {
  const op = STATE.crm.opportunities.find((o) => o.id === oppId);
  if (!op) return;
  STATE.drawerOppId = oppId;
  const drawerRoot = document.getElementById("drawer-container");
  if (!drawerRoot) return;

  const stg = STATE.crm.stages.find((s) => s.id === op.stage_id) || {};
  const idleDays = getLeadIdleDays(op);
  const sellerName = getSellerNameForOpp(op);
  const oppActs = STATE.crm.activities.filter((a) => a.opportunity_id === oppId);

  drawerRoot.innerHTML = `
    <div class="drawer-backdrop" onclick="if(event.target===this)closeLeadDrawer()">
      <aside class="drawer-panel" role="dialog" aria-label="Detalhes do Lead">
        <div class="drawer-head">
          <div>
            <span class="tag tag-gold" style="margin-bottom:4px">${escapeHtml(stg.name || "Etapa")} · ⏱️ ${idleDays}d parado</span>
            <h3 style="font-size:17px">${escapeHtml(op.company_name)}</h3>
            <span style="font-size:12px;color:var(--muted)">Contato: <strong>${escapeHtml(op.contact_name)}</strong> · ${escapeHtml(op.cpf_cnpj || "CNPJ em abertura")}</span>
          </div>
          <button class="btn-xs" onclick="closeLeadDrawer()">✕</button>
        </div>

        <div class="drawer-body">
          <div class="tres">
            <div class="kpi-card">
              <span>Honorário Potencial</span>
              <strong class="gold" style="font-size:16px">${fmtBRL2(op.potential_monthly_value)}/mês</strong>
            </div>
            <div class="kpi-card">
              <span>Faturamento Est.</span>
              <strong style="font-size:15px">${fmtBRL0(op.estimated_revenue)}</strong>
            </div>
            <div class="kpi-card">
              <span>Regime / Porte</span>
              <strong style="font-size:13px">${escapeHtml((op.current_tax_regime || "simples").toUpperCase())} (${op.employees_count || 0} func.)</strong>
            </div>
          </div>

          <div class="card" style="background:var(--navy-3)">
            <div class="card-body" style="padding:12px 14px;gap:8px;font-size:12.5px">
              <div><strong>👔 Vendedor Responsável:</strong> ${escapeHtml(sellerName)}</div>
              <div><strong>📍 Cidade/UF:</strong> ${escapeHtml(op.city || "-")} / ${escapeHtml(op.state || "-")} · <strong>Origem:</strong> ${escapeHtml(op.lead_origin || "-")}</div>
              <div><strong>📧 E-mail:</strong> ${escapeHtml(op.email || "-")} · <strong>📱 WhatsApp:</strong> ${escapeHtml(op.whatsapp || "-")}</div>
              <div><strong>🔄 Tipo de Contratação:</strong> ${escapeHtml(op.hiring_type || "Troca de contador")} · <strong>Contador Atual:</strong> ${escapeHtml(op.current_accountant || "Não informado")}</div>
            </div>
          </div>

          <div class="campo">
            <label class="campo-label">Mover Etapa do Pipeline (Acessível s/ Drag-and-Drop)</label>
            <select onchange="moveOppViaSelect('${op.id}', this.value);setTimeout(()=>openLeadDrawer('${op.id}'),120)">
              ${STATE.crm.stages
                .map((sOpt) => `<option value="${sOpt.id}" ${sOpt.id === op.stage_id ? "selected" : ""}>${escapeHtml(sOpt.name)}</option>`)
                .join("")}
            </select>
          </div>

          <div class="card">
            <div class="card-head" style="padding:10px 14px">
              <div class="card-titles">
                <span class="card-title" style="font-size:13px">📌 Registrar Próxima Ação / Follow-up Rápido</span>
              </div>
            </div>
            <div class="card-body" style="padding:12px 14px">
              <div class="dois">
                <div class="campo">
                  <label class="campo-label">Próxima Ação</label>
                  <input type="text" id="drw_act_title" value="${escapeHtml(op.next_action || "Apresentar diagnóstico e proposta")}" />
                </div>
                <div class="campo">
                  <label class="campo-label">Data Limite</label>
                  <input type="date" id="drw_act_due" value="${new Date().toISOString().slice(0, 10)}" />
                </div>
              </div>
              <button class="btn-secondary" onclick="submitDrawerQuickActivity('${op.id}')">+ Salvar Próxima Ação no Lead</button>
            </div>
          </div>

          <div>
            <h4 style="font-size:13px;color:var(--gold);margin-bottom:6px">Atividades Vinculadas (${oppActs.length})</h4>
            ${
              oppActs.length === 0
                ? `<p style="font-size:12px;color:var(--muted)">Nenhuma tarefa cadastrada ainda para este lead.</p>`
                : oppActs
                    .map(
                      (a) => `
                  <div style="font-size:12px;padding:7px 10px;border:1px solid var(--line);border-radius:8px;margin-bottom:6px;display:flex;justify-content:space-between">
                    <span>${a.completed ? "✅" : "⬜"} <strong>${escapeHtml(a.title)}</strong> (${escapeHtml(a.activity_type)})</span>
                    <span class="tag">${escapeHtml(a.due_date || "-")}</span>
                  </div>
                `
                    )
                    .join("")
            }
          </div>
        </div>

        <div class="drawer-foot">
          <button class="btn-danger" onclick="closeLeadDrawer();deleteOpportunityLead('${op.id}')">🗑️ Excluir Lead</button>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn-secondary" onclick="closeLeadDrawer();openDiagnosticForOpp('${op.id}')">🩺 Diagnóstico</button>
            <button class="btn-primary" onclick="closeLeadDrawer();sendOppToCalculator('${op.id}')">🧮 Precificar na Calculadora</button>
          </div>
        </div>
      </aside>
    </div>
  `;
}

function closeLeadDrawer() {
  STATE.drawerOppId = "";
  const drawerRoot = document.getElementById("drawer-container");
  if (drawerRoot) drawerRoot.innerHTML = "";
}

async function submitDrawerQuickActivity(oppId) {
  const title = document.getElementById("drw_act_title")?.value || "Follow-up comercial";
  const due = document.getElementById("drw_act_due")?.value || new Date().toISOString().slice(0, 10);
  await apiFetch("/api/crm/activities", {
    method: "POST",
    body: JSON.stringify({
      opportunity_id: oppId,
      activity_type: "tarefa",
      due_date: due,
      title,
      description: "Registrado via Painel Lateral (Drawer) do CRM"
    })
  });
  await loadCRMPipeline();
  showToast("Próxima ação registrada com sucesso!");
  renderApp();
  openLeadDrawer(oppId);
}

function renderCRMView() {
  const pendingActs = STATE.crm.activities.filter((a) => !a.completed).length;

  let subView = "";
  if (STATE.crmSubTab === "kanban") subView = renderCRMKanbanTab();
  else if (STATE.crmSubTab === "diagnostico") subView = renderCRMDiagnosticoTab();
  else if (STATE.crmSubTab === "atividades") subView = renderCRMAtividadesTab();
  else if (STATE.crmSubTab === "indicadores") subView = renderCRMIndicadoresTab();

  return `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
      <div class="crm-tabs" style="margin-bottom:0;border-bottom:0">
        <button class="crm-tab ${STATE.crmSubTab === "kanban" ? "active" : ""}" onclick="navigateTo('crm', 'kanban')">
          📊 7.1 Pipeline (${STATE.crm.opportunities.length})
        </button>
        <button class="crm-tab ${STATE.crmSubTab === "diagnostico" ? "active" : ""}" onclick="navigateTo('crm', 'diagnostico')">
          🩺 7.3 Diagnóstico Comercial Contábil
        </button>
        <button class="crm-tab ${STATE.crmSubTab === "atividades" ? "active" : ""}" onclick="navigateTo('crm', 'atividades')">
          📅 7.4 Atividades & Follow-ups (${pendingActs})
        </button>
        <button class="crm-tab ${STATE.crmSubTab === "indicadores" ? "active" : ""}" onclick="navigateTo('crm', 'indicadores')">
          📈 7.7 Indicadores Comerciais & MRR
        </button>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${
          STATE.crm.opportunities.length > 0
            ? `<button class="btn-danger" onclick="openClearAllLeadsModal()">🗑️ Retirar Todos os Leads (${STATE.crm.opportunities.length})</button>`
            : ""
        }
        <button class="btn-primary" onclick="openNewLeadModal()">+ Novo Lead / Oportunidade</button>
      </div>
    </div>
    <hr style="border:0;border-top:1px solid var(--line);margin:12px 0 18px" />
    ${subView}
  `;
}

function renderCRMKanbanTab() {
  const cf = STATE.crmFilter;
  const vm = STATE.crmViewMode || "kanban";
  const filteredOpps = getFilteredCrmOpportunities();

  return `
    <!-- BARRA DE FILTROS DO CRM + ALTERNÂNCIA KANBAN / LISTA + LIMPAR FILTROS (SEÇÃO 5.4 DO PLANO UX/UI) -->
    <div class="filter-bar">
      <div class="campo" style="min-width:210px;flex:1">
        <label class="campo-label">🔍 Buscar Lead / Oportunidade</label>
        <input
          type="text"
          value="${escapeHtml(cf.q)}"
          placeholder="Empresa, contato, CNPJ, origem..."
          oninput="updateCrmFilter('q', this.value)"
        />
      </div>

      <div class="campo" style="min-width:155px">
        <label class="campo-label">Etapa do Funil</label>
        <select onchange="updateCrmFilter('stage', this.value)">
          <option value="">Todas as etapas</option>
          ${STATE.crm.stages.map((s) => `<option value="${s.id}" ${cf.stage === s.id ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}
        </select>
      </div>

      <div class="campo" style="min-width:155px">
        <label class="campo-label">Regime Tributário</label>
        <select onchange="updateCrmFilter('regime', this.value)">
          <option value="">Todos os regimes</option>
          <option value="mei" ${cf.regime === "mei" ? "selected" : ""}>MEI</option>
          <option value="simples" ${cf.regime === "simples" ? "selected" : ""}>Simples Nacional</option>
          <option value="presumido" ${cf.regime === "presumido" ? "selected" : ""}>Lucro Presumido</option>
          <option value="real" ${cf.regime === "real" ? "selected" : ""}>Lucro Real</option>
        </select>
      </div>

      <div class="campo" style="min-width:155px">
        <label class="campo-label">Vendedor Responsável</label>
        <select onchange="updateCrmFilter('seller', this.value)">
          <option value="">Todos os vendedores</option>
          ${(STATE.crm.sellers || []).map((s) => `<option value="${s.id}" ${cf.seller === s.id ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}
        </select>
      </div>

      <div class="filter-actions">
        <button type="button" class="btn-secondary" onclick="clearCrmFilters()">↺ Limpar filtros</button>
        <button
          type="button"
          class="${vm === "kanban" ? "btn-primary" : "btn-secondary"}"
          onclick="STATE.crmViewMode='kanban';renderApp()"
          title="Visualização padrão em colunas Kanban"
        >
          📊 Kanban
        </button>
        <button
          type="button"
          class="${vm === "lista" ? "btn-primary" : "btn-secondary"}"
          onclick="STATE.crmViewMode='lista';renderApp()"
          title="Alternar para visualização tabular em Lista"
        >
          📋 Lista
        </button>
      </div>
    </div>

    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;font-size:12.5px;color:var(--muted)">
      <span>
        💡 Arraste e solte no Kanban, use o seletor de etapa, clique em <strong>🔍 Detalhes</strong> para abrir o Painel Lateral (Drawer) ou em <strong>🗑️ Excluir</strong> para retirar o lead.
      </span>
      <span>Exibindo <strong>${filteredOpps.length}</strong> de <strong>${STATE.crm.opportunities.length}</strong> lead(s)</span>
    </div>

    ${
      vm === "lista"
        ? `
      <!-- VISÃO EM LISTA DO CRM (SEÇÃO 5.4 DO PLANO UX/UI) -->
      <div class="card">
        <div class="card-body">
          ${
            filteredOpps.length === 0
              ? `<div class="empty-state-box">Nenhum lead encontrado para os filtros selecionados.</div>`
              : `
            <div class="table-responsive">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Empresa / Cliente</th>
                    <th>Etapa Atual</th>
                    <th>Regime / Porte</th>
                    <th>Valor Mensal Potencial</th>
                    <th>Responsável</th>
                    <th>Tempo Parado</th>
                    <th>Próxima Atividade</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  ${filteredOpps
                    .map((op) => {
                      const stg = STATE.crm.stages.find((s) => s.id === op.stage_id) || {};
                      const idle = getLeadIdleDays(op);
                      return `
                      <tr>
                        <td>
                          <strong style="cursor:pointer;color:var(--gold)" onclick="openLeadDrawer('${op.id}')">${escapeHtml(op.company_name)}</strong>
                          <div style="font-size:11.5px;color:var(--muted)">👤 ${escapeHtml(op.contact_name)} · ${escapeHtml(op.cpf_cnpj || "Sem CNPJ")}</div>
                        </td>
                        <td>
                          <select style="font-size:11.5px;padding:4px 8px;width:auto" onchange="moveOppViaSelect('${op.id}', this.value)">
                            ${STATE.crm.stages
                              .map((sOpt) => `<option value="${sOpt.id}" ${sOpt.id === op.stage_id ? "selected" : ""}>${escapeHtml(sOpt.name)}</option>`)
                              .join("")}
                          </select>
                        </td>
                        <td>
                          <span class="tag">${escapeHtml((op.current_tax_regime || "simples").toUpperCase())}</span>
                          <span style="font-size:11.5px;color:var(--muted);margin-left:4px">${op.employees_count || 0} func.</span>
                        </td>
                        <td><strong class="gold">${fmtBRL0(op.potential_monthly_value)}/mês</strong></td>
                        <td>${escapeHtml(getSellerNameForOpp(op))}</td>
                        <td><span class="tag ${idle > 7 ? "tag-warn" : ""}">⏱️ ${idle}d</span></td>
                        <td>${escapeHtml(op.next_action || "-")} <span style="font-size:11px;color:var(--muted)">(${escapeHtml(op.next_action_date || "-")})</span></td>
                        <td>
                          <div style="display:flex;gap:5px;flex-wrap:wrap">
                            <button class="btn-xs" onclick="openLeadDrawer('${op.id}')">🔍 Detalhes</button>
                            <button class="btn-xs" onclick="openDiagnosticForOpp('${op.id}')">🩺 Diagnóstico</button>
                            <button class="btn-xs" onclick="sendOppToCalculator('${op.id}')">🧮 Precificar</button>
                            <button class="btn-xs btn-danger-xs" onclick="deleteOpportunityLead('${op.id}')">🗑️ Excluir</button>
                          </div>
                        </td>
                      </tr>
                    `;
                    })
                    .join("")}
                </tbody>
              </table>
            </div>
          `
          }
        </div>
      </div>
    `
        : `
      <!-- VISÃO KANBAN PADRÃO ENRIQUECIDA (SEÇÃO 5.4 DO PLANO UX/UI) -->
      <div class="kanban-board">
        ${STATE.crm.stages
          .map((st) => {
            const colOpps = filteredOpps.filter((o) => o.stage_id === st.id);
            const colTotal = colOpps.reduce((acc, o) => acc + Number(o.potential_monthly_value || 0), 0);
            return `
            <div class="kanban-col"
                 ondragover="event.preventDefault();this.classList.add('drag-over')"
                 ondragleave="this.classList.remove('drag-over')"
                 ondrop="handleKanbanDrop(event, '${st.id}', ${st.is_lost ? "true" : "false"})">
              <div class="kanban-col-head">
                <div class="kanban-col-title">
                  <span class="stage-dot" style="background:${escapeHtml(st.color)}"></span>
                  <span>${escapeHtml(st.name)}</span>
                </div>
                <span class="tag">${colOpps.length} · ${fmtBRL0(colTotal)}</span>
              </div>
              <div class="kanban-col-body">
                ${colOpps
                  .map((op) => {
                    const idleDays = getLeadIdleDays(op);
                    const sellerName = getSellerNameForOpp(op);
                    return `
                  <div class="kanban-card" draggable="true" ondragstart="event.dataTransfer.setData('text/plain', '${op.id}')">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px">
                      <span class="kanban-card-company" style="cursor:pointer" onclick="openLeadDrawer('${op.id}')" title="Clique para abrir o Painel Lateral (Drawer)">${escapeHtml(op.company_name)}</span>
                      <div style="display:flex;align-items:center;gap:4px">
                        <span class="tag tag-gold">${fmtBRL0(op.potential_monthly_value)}/mês</span>
                        <button type="button" class="btn-xs btn-danger-xs" onclick="deleteOpportunityLead('${op.id}')" title="Retirar / Excluir este Lead">🗑️</button>
                      </div>
                    </div>
                    <div class="kanban-card-contact">
                      👤 ${escapeHtml(op.contact_name)} · 👔 ${escapeHtml(sellerName)}
                    </div>
                    <div class="kanban-tags">
                      <span class="tag">${escapeHtml((op.current_tax_regime || "simples").toUpperCase())}</span>
                      <span class="tag">${op.employees_count || 0} func.</span>
                      <span class="tag ${idleDays > 7 ? "tag-warn" : ""}" title="Tempo parado nesta etapa">⏱️ ${idleDays}d parado</span>
                      ${op.has_diagnostic ? '<span class="tag tag-ok">✓ Diagnóstico</span>' : ""}
                      ${op.latest_proposal_status ? `<span class="tag tag-gold">Prop.: ${escapeHtml(op.latest_proposal_status)}</span>` : ""}
                      ${op.loss_reason_name ? `<span class="tag tag-warn">Perda: ${escapeHtml(op.loss_reason_name)}</span>` : ""}
                    </div>
                    ${
                      op.next_action
                        ? `<div style="font-size:11px;color:var(--cream);background:var(--navy-3);padding:5px 7px;border-radius:6px;border:1px solid var(--line)">
                            📌 <strong>Próx. atividade:</strong> ${escapeHtml(op.next_action)} (${escapeHtml(op.next_action_date || "-")})
                          </div>`
                        : ""
                    }
                    <div class="kanban-card-actions">
                      <button class="btn-xs" onclick="openLeadDrawer('${op.id}')" title="Abrir Painel Lateral de Detalhes">🔍 Detalhes</button>
                      <button class="btn-xs" onclick="openDiagnosticForOpp('${op.id}')">🩺 Diagnóstico</button>
                      <button class="btn-xs" onclick="sendOppToCalculator('${op.id}')">🧮 Precificar</button>
                      <button class="btn-xs" onclick="openActivityModalForOpp('${op.id}')">+ Tarefa</button>
                      <button class="btn-xs btn-danger-xs" onclick="deleteOpportunityLead('${op.id}')" title="Retirar / Excluir este Lead">🗑️ Excluir</button>
                    </div>
                    <select style="font-size:11px;padding:4px 6px;margin-top:2px" onchange="moveOppViaSelect('${op.id}', this.value)">
                      ${STATE.crm.stages
                        .map((sOpt) => `<option value="${sOpt.id}" ${sOpt.id === op.stage_id ? "selected" : ""}>Mover p/: ${escapeHtml(sOpt.name)}</option>`)
                        .join("")}
                    </select>
                  </div>
                `;
                  })
                  .join("")}
              </div>
            </div>
          `;
          })
          .join("")}
      </div>
    `
    }
  `;
}

async function deleteOpportunityLead(oppId) {
  if (!oppId) return;
  const opp = STATE.crm.opportunities.find((o) => o.id === oppId);
  const label = opp ? opp.company_name : oppId;
  try {
    await apiFetch(`/api/crm/opportunities/${oppId}`, { method: "DELETE" });
    if (STATE.calc.opportunityId === oppId) {
      STATE.calc.opportunityId = "";
    }
    if (STATE.selectedDiagnosticOppId === oppId) {
      STATE.selectedDiagnosticOppId = "";
    }
    await loadCRMPipeline();
    if (STATE.crmSubTab === "indicadores") {
      await loadCRMDashboard();
    }
    showToast(`Lead "${label}" retirado/excluído com sucesso!`);
    renderApp();
  } catch (err) {
    showToast("Erro ao excluir lead: " + err.message, true);
  }
}

function openClearAllLeadsModal() {
  const modal = document.getElementById("modal-container");
  modal.innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this)this.remove()">
      <div class="modal-box" style="max-width:440px">
        <div class="modal-head">
          <h3>🗑️ Retirar Todos os Leads do Escritório</h3>
          <button class="btn-xs" onclick="document.getElementById('modal-container').innerHTML=''">✕</button>
        </div>
        <p style="font-size:13.5px;color:var(--cream)">
          Tem certeza que deseja retirar/excluir todos os <strong>${STATE.crm.opportunities.length} leads/oportunidades</strong> deste escritório no CRM?
        </p>
        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:8px">
          <button class="btn-secondary" onclick="document.getElementById('modal-container').innerHTML=''">Cancelar</button>
          <button class="btn-danger" onclick="confirmClearAllTenantLeads()">🗑️ Sim, Excluir Todos</button>
        </div>
      </div>
    </div>
  `;
}

async function confirmClearAllTenantLeads() {
  try {
    await apiFetch("/api/crm/opportunities", { method: "DELETE" });
    STATE.calc.opportunityId = "";
    STATE.selectedDiagnosticOppId = "";
    document.getElementById("modal-container").innerHTML = "";
    await loadCRMPipeline();
    if (STATE.crmSubTab === "indicadores") {
      await loadCRMDashboard();
    }
    showToast("Todos os leads do escritório foram retirados!");
    renderApp();
  } catch (err) {
    showToast("Erro ao limpar leads: " + err.message, true);
  }
}

async function moveOppViaSelect(oppId, targetStageId) {
  const stg = STATE.crm.stages.find((s) => s.id === targetStageId);
  if (stg && stg.is_lost) {
    openLossReasonModal(oppId, targetStageId);
    return;
  }
  await apiFetch(`/api/crm/opportunities/${oppId}/move`, {
    method: "POST",
    body: JSON.stringify({ stage_id: targetStageId, notes: "Movido via seletor rápido de etapa" })
  });
  await loadCRMPipeline();
  showToast("Etapa atualizada!");
  renderApp();
}

async function handleKanbanDrop(event, targetStageId, isLostStage) {
  event.preventDefault();
  event.currentTarget.classList.remove("drag-over");
  const oppId = event.dataTransfer.getData("text/plain");
  if (!oppId) return;

  if (isLostStage) {
    openLossReasonModal(oppId, targetStageId);
    return;
  }

  await apiFetch(`/api/crm/opportunities/${oppId}/move`, {
    method: "POST",
    body: JSON.stringify({ stage_id: targetStageId, notes: "Movido via Kanban Drag-and-Drop" })
  });
  await loadCRMPipeline();
  showToast("Etapa da oportunidade atualizada no Pipeline!");
  renderApp();
}

function openLossReasonModal(oppId, targetStageId) {
  const modal = document.getElementById("modal-container");
  modal.innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this)this.remove()">
      <div class="modal-box" style="max-width:460px">
        <div class="modal-head">
          <h3>Registrar Motivo de Perda Comercial</h3>
          <button class="btn-xs" onclick="document.getElementById('modal-container').innerHTML=''">✕</button>
        </div>
        <div class="campo">
          <label class="campo-label">Selecione o Motivo Principal *</label>
          <select id="mdl_loss_reason">
            ${STATE.crm.lossReasons.map((r) => `<option value="${r.id}">${escapeHtml(r.name)} — ${escapeHtml(r.description || "")}</option>`).join("")}
          </select>
        </div>
        <div class="campo">
          <label class="campo-label">Observações sobre a perda</label>
          <textarea id="mdl_loss_notes" placeholder="Detalhes adicionais..."></textarea>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:10px">
          <button class="btn-secondary" onclick="document.getElementById('modal-container').innerHTML=''">Cancelar</button>
          <button class="btn-danger" onclick="confirmLossMove('${oppId}', '${targetStageId}')">Confirmar Perda</button>
        </div>
      </div>
    </div>
  `;
}

async function confirmLossMove(oppId, targetStageId) {
  const reasonId = document.getElementById("mdl_loss_reason").value;
  const notes = document.getElementById("mdl_loss_notes").value;
  await apiFetch(`/api/crm/opportunities/${oppId}/move`, {
    method: "POST",
    body: JSON.stringify({ stage_id: targetStageId, loss_reason_id: reasonId, notes: notes || "Marcada como perdida" })
  });
  document.getElementById("modal-container").innerHTML = "";
  await loadCRMPipeline();
  showToast("Oportunidade marcada como perdida com motivo registrado.");
  renderApp();
}

async function sendOppToCalculator(oppId) {
  await importOpportunityIntoCalculator(oppId);
  await navigateTo("calculadora");
}

async function openDiagnosticForOpp(oppId) {
  STATE.selectedDiagnosticOppId = oppId;
  await fetchOpportunityDiagnostic(oppId);
  await navigateTo("crm", "diagnostico");
}

async function fetchOpportunityDiagnostic(oppId) {
  if (!oppId) return;
  const res = await apiFetch(`/api/crm/opportunities/${oppId}/diagnostic`);
  STATE.currentDiagnostic = res;
}

function renderCRMDiagnosticoTab() {
  const opp = STATE.crm.opportunities.find((o) => o.id === STATE.selectedDiagnosticOppId) || STATE.crm.opportunities[0];
  const diag = STATE.currentDiagnostic?.diagnostic || {};
  const pv = STATE.parameters?.activeVersion || {};
  const accessories = pv.accessories || [];
  const avulsos = (STATE.parameters?.plansServices || []).filter((p) => p.item_type === "servico_avulso");
  const customQuestions = parseCustomQuestions();

  const regimeVal = diag.tax_regime || opp?.current_tax_regime || "simples";
  const actVal = diag.economic_activity || opp?.economic_activity || "servicos";
  const revVal = diag.monthly_revenue ?? opp?.estimated_revenue ?? 50000;
  const volVal = diag.invoice_volume_index ?? opp?.invoice_volume_index ?? 1;
  const empVal = diag.employees_count ?? opp?.employees_count ?? 2;
  const partVal = diag.partners_count ?? opp?.partners_count ?? 1;
  const branchVal = diag.branches_count ?? opp?.branches_count ?? 0;
  const compVal = diag.operational_complexity || "padrao";
  const specObs = diag.specific_obligations || {};
  const desServs = diag.desired_services || {};
  const customAns = diag.custom_answers || {};

  return `
    <div class="card">
      <div class="card-head" style="justify-content:space-between;flex-wrap:wrap">
        <div class="card-titles">
          <span class="card-title">7.3 Diagnóstico Comercial Contábil Estruturado</span>
          <span class="card-sub">Alimenta automaticamente a Calculadora de Honorários sem redigitação</span>
        </div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <select style="width:280px;max-width:100%" onchange="openDiagnosticForOpp(this.value)">
            ${STATE.crm.opportunities
              .map(
                (o) => `
              <option value="${o.id}" ${o.id === opp?.id ? "selected" : ""}>
                ${escapeHtml(o.company_name)} (${escapeHtml(o.contact_name)})
              </option>
            `
              )
              .join("")}
          </select>
          ${
            opp
              ? `
                <button class="btn-danger" onclick="deleteOpportunityLead('${opp.id}')">🗑️ Excluir Lead</button>
                <button class="btn-primary" onclick="saveDiagnosticAndSendToCalc('${opp.id}')">🧮 Salvar Diagnóstico & Enviar p/ Calculadora</button>
              `
              : ""
          }
        </div>
      </div>

      ${
        !opp
          ? `<div class="card-body">Cadastre um lead primeiro.</div>`
          : `
        <div class="card-body">
          <div class="dois">
            <div class="campo">
              <label class="campo-label">Necessidade Principal do Cliente</label>
              <textarea id="dg_need" placeholder="Ex.: Redução legal de impostos, troca de contador por falta de atendimento, abertura de CNPJ...">${escapeHtml(diag.client_need || "")}</textarea>
            </div>
            <div class="campo">
              <label class="campo-label">Situação Atual da Empresa & Dores com o Contador Atual</label>
              <textarea id="dg_pains" placeholder="Ex.: Atraso em guias, falta de balancetes gerenciais, dúvidas sem resposta...">${escapeHtml(diag.accountant_pains || "")}</textarea>
            </div>
          </div>

          <div class="quatro">
            <div class="campo">
              <label class="campo-label">Regime Tributário</label>
              <select id="dg_regime">
                <option value="mei" ${regimeVal === "mei" ? "selected" : ""}>MEI</option>
                <option value="simples" ${regimeVal === "simples" ? "selected" : ""}>Simples Nacional</option>
                <option value="presumido" ${regimeVal === "presumido" ? "selected" : ""}>Lucro Presumido</option>
                <option value="real" ${regimeVal === "real" ? "selected" : ""}>Lucro Real</option>
              </select>
            </div>
            <div class="campo">
              <label class="campo-label">Atividade Econômica</label>
              <select id="dg_activity">
                <option value="comercio" ${actVal === "comercio" ? "selected" : ""}>Comércio</option>
                <option value="servicos" ${actVal === "servicos" ? "selected" : ""}>Serviços</option>
                <option value="industria" ${actVal === "industria" ? "selected" : ""}>Indústria</option>
              </select>
            </div>
            <div class="campo">
              <label class="campo-label">Faturamento Mensal (R$)</label>
              <input type="number" id="dg_revenue" value="${revVal}" />
            </div>
            <div class="campo">
              <label class="campo-label">Volume de Notas Fiscais</label>
              <select id="dg_volume">
                <option value="0" ${Number(volVal) === 0 ? "selected" : ""}>Até 20 NF/mês</option>
                <option value="1" ${Number(volVal) === 1 ? "selected" : ""}>21 a 80 NF/mês</option>
                <option value="2" ${Number(volVal) === 2 ? "selected" : ""}>81 a 200 NF/mês</option>
                <option value="3" ${Number(volVal) === 3 ? "selected" : ""}>201 a 500 NF/mês</option>
                <option value="4" ${Number(volVal) === 4 ? "selected" : ""}>Acima de 500/mês</option>
              </select>
            </div>
          </div>

          <div class="quatro">
            <div class="campo">
              <label class="campo-label">Funcionários (Folha CLT)</label>
              <input type="number" id="dg_emp" value="${empVal}" />
            </div>
            <div class="campo">
              <label class="campo-label">Sócios (Pró-labore)</label>
              <input type="number" id="dg_part" value="${partVal}" />
            </div>
            <div class="campo">
              <label class="campo-label">Filiais / IE Adicionais</label>
              <input type="number" id="dg_branch" value="${branchVal}" />
            </div>
            <div class="campo">
              <label class="campo-label">Complexidade Operacional</label>
              <select id="dg_comp">
                <option value="padrao" ${compVal === "padrao" ? "selected" : ""}>Padrão (1.0x)</option>
                <option value="baixa" ${compVal === "baixa" ? "selected" : ""}>Baixa (0.90x)</option>
                <option value="media" ${compVal === "media" ? "selected" : ""}>Média (1.10x)</option>
                <option value="alta" ${compVal === "alta" ? "selected" : ""}>Alta (1.25x)</option>
                <option value="especial" ${compVal === "especial" ? "selected" : ""}>Especial (1.50x)</option>
              </select>
            </div>
          </div>

          <div class="dois">
            <div class="campo">
              <label class="campo-label">Obrigações Específicas Identificadas</label>
              <div class="checks">
                ${accessories
                  .map(
                    (ob) => `
                  <label style="display:flex;align-items:center;gap:8px;font-size:13px;background:var(--navy-3);padding:8px 11px;border-radius:8px;border:1px solid var(--line)">
                    <input type="checkbox" class="dg-ob-chk" value="${ob.id}" ${specObs[ob.id] ? "checked" : ""} style="width:auto" />
                    <span>${escapeHtml(ob.rotulo)} (+${ob.horas}h)</span>
                  </label>
                `
                  )
                  .join("")}
              </div>
            </div>

            <div class="campo">
              <label class="campo-label">Serviços Pontuais / Adicionais Desejados</label>
              <div class="checks">
                ${avulsos
                  .map(
                    (av) => `
                  <label style="display:flex;align-items:center;gap:8px;font-size:13px;background:var(--navy-3);padding:8px 11px;border-radius:8px;border:1px solid var(--line)">
                    <input type="checkbox" class="dg-av-chk" data-price="${av.base_price}" value="${av.id}" ${desServs[av.id] ? "checked" : ""} style="width:auto" />
                    <span>${escapeHtml(av.name)} (${fmtBRL0(av.base_price)})</span>
                  </label>
                `
                  )
                  .join("")}
              </div>
            </div>
          </div>

          <div style="border-top:1px solid var(--line);padding-top:12px">
            <h4 style="font-size:13px;color:var(--gold);margin-bottom:10px">Perguntas Personalizadas do Escritório</h4>
            <div class="tres">
              ${customQuestions
                .map(
                  (q) => `
                <div class="campo">
                  <label class="campo-label">${escapeHtml(q.pergunta)}</label>
                  <input type="text" class="dg-custom-q" data-qid="${escapeHtml(q.id)}" value="${escapeHtml(customAns[q.id] || "")}" placeholder="Resposta..." />
                </div>
              `
                )
                .join("")}
            </div>
          </div>

          <div style="display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap">
            <button class="btn-secondary" onclick="saveDiagnosticOnly('${opp.id}')">💾 Salvar Diagnóstico</button>
            <button class="btn-primary" onclick="saveDiagnosticAndSendToCalc('${opp.id}')">🧮 Salvar & Calcular Honorários Agora</button>
          </div>
        </div>
      `
      }
    </div>
  `;
}

function parseCustomQuestions() {
  try {
    const raw = STATE.tenant?.custom_diagnostic_questions_json;
    if (!raw) return [];
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (_) {
    return [];
  }
}

async function saveDiagnosticOnly(oppId) {
  const obMap = {};
  document.querySelectorAll(".dg-ob-chk:checked").forEach((el) => {
    obMap[el.value] = true;
  });
  const avMap = {};
  document.querySelectorAll(".dg-av-chk:checked").forEach((el) => {
    avMap[el.value] = { valor: parseFloat(el.getAttribute("data-price")) || 0 };
  });
  const customMap = {};
  document.querySelectorAll(".dg-custom-q").forEach((el) => {
    customMap[el.getAttribute("data-qid")] = el.value;
  });

  await apiFetch(`/api/crm/opportunities/${oppId}/diagnostic`, {
    method: "POST",
    body: JSON.stringify({
      client_need: document.getElementById("dg_need").value,
      accountant_pains: document.getElementById("dg_pains").value,
      tax_regime: document.getElementById("dg_regime").value,
      economic_activity: document.getElementById("dg_activity").value,
      monthly_revenue: parseFloat(document.getElementById("dg_revenue").value) || 50000,
      invoice_volume_index: parseInt(document.getElementById("dg_volume").value, 10) || 0,
      employees_count: parseInt(document.getElementById("dg_emp").value, 10) || 0,
      partners_count: parseInt(document.getElementById("dg_part").value, 10) || 1,
      branches_count: parseInt(document.getElementById("dg_branch").value, 10) || 0,
      operational_complexity: document.getElementById("dg_comp").value,
      specific_obligations: obMap,
      desired_services: avMap,
      custom_answers: customMap
    })
  });
  await Promise.all([loadCRMPipeline(), fetchOpportunityDiagnostic(oppId)]);
  showToast("Diagnóstico comercial salvo e vinculado à oportunidade!");
}

async function saveDiagnosticAndSendToCalc(oppId) {
  await saveDiagnosticOnly(oppId);
  await importOpportunityIntoCalculator(oppId);
  await navigateTo("calculadora");
}

function renderCRMAtividadesTab() {
  const today = new Date().toISOString().slice(0, 10);
  const acts = STATE.crm.activities;

  return `
    <div class="card">
      <div class="card-head" style="justify-content:space-between;flex-wrap:wrap">
        <div class="card-titles">
          <span class="card-title">7.4 Gestão de Atividades, Tarefas, Reuniões e Follow-ups</span>
          <span class="card-sub">Controle de prazos, alertas de tarefas atrasadas e histórico do relacionamento comercial</span>
        </div>
        <button class="btn-primary" onclick="openActivityModalForOpp('')">+ Nova Atividade / Follow-up</button>
      </div>
      <div class="card-body">
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Tipo</th>
                <th>Título / Observação</th>
                <th>Oportunidade / Empresa</th>
                <th>Responsável</th>
                <th>Prazo</th>
              </tr>
            </thead>
            <tbody>
              ${acts
                .map((a) => {
                  const isOverdue = !a.completed && a.due_date && a.due_date < today;
                  return `
                  <tr>
                    <td>
                      <button class="btn-xs" onclick="toggleActivityStatus('${a.id}')">
                        ${a.completed ? "✅ Concluída" : "⬜ Pendente"}
                      </button>
                    </td>
                    <td><span class="tag">${escapeHtml(a.activity_type.toUpperCase())}</span></td>
                    <td>
                      <strong style="${a.completed ? "text-decoration:line-through;color:var(--muted)" : ""}">${escapeHtml(a.title)}</strong>
                      <div style="font-size:11.5px;color:var(--muted)">${escapeHtml(a.description || "")}</div>
                    </td>
                    <td>${escapeHtml(a.company_name)} (${escapeHtml(a.contact_name)})</td>
                    <td>${escapeHtml(a.assigned_user_name || "-")}</td>
                    <td>
                      <span class="tag ${isOverdue ? "tag-warn" : a.completed ? "tag-ok" : ""}">
                        ${escapeHtml(a.due_date || "-")} ${isOverdue ? "⚠️ ATRASADA" : ""}
                      </span>
                    </td>
                  </tr>
                `;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

async function toggleActivityStatus(actId) {
  await apiFetch(`/api/crm/activities/${actId}/toggle`, { method: "PUT", body: "{}" });
  await loadCRMPipeline();
  renderApp();
}

function renderCRMIndicadoresTab() {
  const d = STATE.dashboard;
  if (!d || !d.kpis) {
    loadCRMDashboard().then(() => renderApp());
    return `<div class="card"><div class="card-body">Calculando indicadores comerciais...</div></div>`;
  }
  const k = d.kpis;

  return `
    <div class="card" style="margin-bottom:18px">
      <div class="card-body" style="padding:12px 16px">
        <div class="quatro" style="align-items:end">
          <div class="campo">
            <label class="campo-label">Período de Análise</label>
            <select onchange="updateDashboardFilter('days', this.value)">
              <option value="30" ${STATE.dashboardFilters.days === "30" ? "selected" : ""}>Últimos 30 dias</option>
              <option value="90" ${STATE.dashboardFilters.days === "90" ? "selected" : ""}>Últimos 90 dias</option>
              <option value="365" ${STATE.dashboardFilters.days === "365" ? "selected" : ""}>Últimos 12 meses</option>
              <option value="0" ${STATE.dashboardFilters.days === "0" ? "selected" : ""}>Todo o histórico</option>
            </select>
          </div>
          <div class="campo">
            <label class="campo-label">Filtrar por Vendedor</label>
            <select onchange="updateDashboardFilter('seller', this.value)">
              <option value="">Todos os vendedores</option>
              ${STATE.crm.sellers.map((s) => `<option value="${s.id}" ${STATE.dashboardFilters.seller === s.id ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}
            </select>
          </div>
          <div class="campo">
            <label class="campo-label">Filtrar por Origem do Lead</label>
            <select onchange="updateDashboardFilter('origin', this.value)">
              <option value="">Todas as origens</option>
              ${(d.origins || []).map((orig) => `<option value="${escapeHtml(orig)}" ${STATE.dashboardFilters.origin === orig ? "selected" : ""}>${escapeHtml(orig)}</option>`).join("")}
            </select>
          </div>
          <div>
            <button class="btn-secondary" onclick="updateDashboardFilter('reset', '')">Limpar Filtros</button>
          </div>
        </div>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-card" style="border-color:var(--ok)">
        <span>Receita Recorrente Ganha (MRR)</span>
        <strong style="color:var(--ok)">${fmtBRL2(k.mrrGanho)}/mês</strong>
        <em>${fmtBRL0(k.mrrGanho * 12)}/ano efetivamente ganho</em>
      </div>
      <div class="kpi-card" style="border-color:var(--gold)">
        <span>Receita em Propostas Ativas</span>
        <strong class="gold">${fmtBRL2(k.valorEmPropostas)}/mês</strong>
        <em>${k.propostasEnviadas} enviadas · ${k.propostasAceitas} aceitas</em>
      </div>
      <div class="kpi-card">
        <span>Valor Potencial do Pipeline Aberto</span>
        <strong>${fmtBRL2(k.valorPotencialPipeline)}/mês</strong>
        <em>${k.oportunidadesAbertas} oportunidades em aberto</em>
      </div>
      <div class="kpi-card">
        <span>Taxa de Fechamento & Ticket Médio</span>
        <strong>${k.taxaFechamentoPct}% · ${fmtBRL0(k.ticketMedio)}</strong>
        <em>Tempo médio fechamento: ${k.tempoMedioFechamentoDias} dias</em>
      </div>
      <div class="kpi-card">
        <span>Leads Gerados & Atividades</span>
        <strong>${k.leadsGerados} leads</strong>
        <em>${k.atividadesPendentes} pendentes (${k.atividadesAtrasadas} atrasadas)</em>
      </div>
    </div>

    <div class="dois" style="align-items:start">
      <div class="card">
        <div class="card-head"><div class="card-titles"><span class="card-title">Conversão e Volume por Etapa do Funil</span></div></div>
        <div class="card-body">
          <div class="table-responsive">
            <table class="data-table">
              <thead><tr><th>Etapa do Pipeline</th><th>Qtd.</th><th>% do Total</th><th>Valor Mensal</th></tr></thead>
              <tbody>
                ${(d.stageBreakdown || [])
                  .map(
                    (st) => `
                  <tr>
                    <td><span class="stage-dot" style="background:${st.color};display:inline-block;margin-right:6px"></span>${escapeHtml(st.name)}</td>
                    <td><strong>${st.count}</strong></td>
                    <td>${st.conversion_pct}%</td>
                    <td>${fmtBRL2(st.value)}</td>
                  </tr>
                `
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="col-inputs">
        <div class="card">
          <div class="card-head"><div class="card-titles"><span class="card-title">Desempenho por Vendedor / Consultor</span></div></div>
          <div class="card-body">
            <div class="table-responsive">
              <table class="data-table">
                <thead><tr><th>Vendedor</th><th>Leads</th><th>Ganhos</th><th>MRR Ganho</th><th>Pipeline</th></tr></thead>
                <tbody>
                  ${(d.sellerPerformance || [])
                    .map(
                      (sp) => `
                    <tr>
                      <td><strong>${escapeHtml(sp.name)}</strong></td>
                      <td>${sp.leads}</td>
                      <td>${sp.won}</td>
                      <td style="color:var(--ok);font-weight:700">${fmtBRL2(sp.mrr)}</td>
                      <td>${fmtBRL2(sp.pipeline)}</td>
                    </tr>
                  `
                    )
                    .join("")}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><div class="card-titles"><span class="card-title">Análise de Motivos de Perda</span></div></div>
          <div class="card-body">
            ${
              (d.lossBreakdown || []).length === 0
                ? `<p style="font-size:13px;color:var(--muted)">Nenhuma oportunidade perdida no período.</p>`
                : `
              <div class="table-responsive">
                <table class="data-table">
                  <thead><tr><th>Motivo de Perda</th><th>Ocorrências</th></tr></thead>
                  <tbody>
                    ${d.lossBreakdown.map((lb) => `<tr><td>${escapeHtml(lb.reason)}</td><td><strong>${lb.count}</strong></td></tr>`).join("")}
                  </tbody>
                </table>
              </div>
            `
            }
          </div>
        </div>
      </div>
    </div>
  `;
}

async function updateDashboardFilter(key, val) {
  if (key === "reset") {
    STATE.dashboardFilters = { days: "90", seller: "", origin: "" };
  } else {
    STATE.dashboardFilters[key] = val;
  }
  await loadCRMDashboard();
  renderApp();
}

function openNewLeadModal() {
  const modal = document.getElementById("modal-container");
  modal.innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this)this.remove()">
      <div class="modal-box">
        <div class="modal-head">
          <h3>7.2 Cadastrar Novo Lead / Oportunidade Contábil</h3>
          <button class="btn-xs" onclick="document.getElementById('modal-container').innerHTML=''">✕</button>
        </div>
        <div class="dois">
          <div class="campo">
            <label class="campo-label">Nome da Empresa *</label>
            <input type="text" id="ld_company" placeholder="Ex.: Alfa Comércio Digital Ltda." />
          </div>
          <div class="campo">
            <label class="campo-label">Nome do Contato / Decisor *</label>
            <input type="text" id="ld_contact" placeholder="Ex.: João Silva" />
          </div>
        </div>
        <div class="tres">
          <div class="campo">
            <label class="campo-label">CPF / CNPJ</label>
            <input type="text" id="ld_doc" placeholder="00.000.000/0001-00" />
          </div>
          <div class="campo">
            <label class="campo-label">E-mail</label>
            <input type="email" id="ld_email" placeholder="contato@empresa.com.br" />
          </div>
          <div class="campo">
            <label class="campo-label">WhatsApp</label>
            <input type="text" id="ld_whats" placeholder="(11) 99999-9999" />
          </div>
        </div>
        <div class="quatro">
          <div class="campo">
            <label class="campo-label">Município</label>
            <input type="text" id="ld_city" value="São Paulo" />
          </div>
          <div class="campo">
            <label class="campo-label">UF</label>
            <input type="text" id="ld_state" value="SP" maxlength="2" />
          </div>
          <div class="campo">
            <label class="campo-label">Origem do Lead</label>
            <select id="ld_origin">
              <option value="Indicação">Indicação</option>
              <option value="Google Ads">Google Ads</option>
              <option value="Instagram / Meta Ads">Instagram / Meta Ads</option>
              <option value="Prospecção Ativa">Prospecção Ativa</option>
              <option value="Site / SEO">Site / SEO</option>
            </select>
          </div>
          <div class="campo">
            <label class="campo-label">Tipo de Contratação</label>
            <select id="ld_hiring">
              <option value="Troca de contador">Troca de contador</option>
              <option value="Abertura de empresa">Abertura de empresa</option>
              <option value="Regularização contábil/fiscal">Regularização contábil/fiscal</option>
              <option value="Alteração empresarial">Alteração empresarial</option>
              <option value="BPO Financeiro">BPO Financeiro</option>
              <option value="Serviços pontuais">Serviços pontuais</option>
            </select>
          </div>
        </div>
        <div class="quatro">
          <div class="campo">
            <label class="campo-label">Regime Tributário Atual</label>
            <select id="ld_regime">
              <option value="simples">Simples Nacional</option>
              <option value="presumido">Lucro Presumido</option>
              <option value="real">Lucro Real</option>
              <option value="mei">MEI</option>
            </select>
          </div>
          <div class="campo">
            <label class="campo-label">Atividade</label>
            <select id="ld_activity">
              <option value="servicos">Serviços</option>
              <option value="comercio">Comércio</option>
              <option value="industria">Indústria</option>
            </select>
          </div>
          <div class="campo">
            <label class="campo-label">Faturamento Estimado (R$)</label>
            <input type="number" id="ld_rev" value="60000" />
          </div>
          <div class="campo">
            <label class="campo-label">Funcionários / Sócios</label>
            <div style="display:flex;gap:6px">
              <input type="number" id="ld_emp" value="2" title="Funcionários" />
              <input type="number" id="ld_part" value="1" title="Sócios" />
            </div>
          </div>
        </div>
        <div class="tres">
          <div class="campo">
            <label class="campo-label">Contador Atual</label>
            <input type="text" id="ld_acc" placeholder="Nome do escritório atual" />
          </div>
          <div class="campo">
            <label class="campo-label">Próxima Ação Comercial</label>
            <input type="text" id="ld_next" value="Realizar diagnóstico comercial" />
          </div>
          <div class="campo">
            <label class="campo-label">Data Prevista Contratação</label>
            <input type="date" id="ld_close" value="${new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10)}" />
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:10px">
          <button class="btn-secondary" onclick="document.getElementById('modal-container').innerHTML=''">Cancelar</button>
          <button class="btn-primary" onclick="submitNewLead()">Cadastrar Lead no Pipeline</button>
        </div>
      </div>
    </div>
  `;
}

async function submitNewLead() {
  try {
    await apiFetch("/api/crm/opportunities", {
      method: "POST",
      body: JSON.stringify({
        company_name: document.getElementById("ld_company").value,
        contact_name: document.getElementById("ld_contact").value,
        cpf_cnpj: document.getElementById("ld_doc").value,
        email: document.getElementById("ld_email").value,
        whatsapp: document.getElementById("ld_whats").value,
        city: document.getElementById("ld_city").value,
        state: document.getElementById("ld_state").value,
        lead_origin: document.getElementById("ld_origin").value,
        hiring_type: document.getElementById("ld_hiring").value,
        current_tax_regime: document.getElementById("ld_regime").value,
        economic_activity: document.getElementById("ld_activity").value,
        estimated_revenue: parseFloat(document.getElementById("ld_rev").value) || 50000,
        employees_count: parseInt(document.getElementById("ld_emp").value, 10) || 0,
        partners_count: parseInt(document.getElementById("ld_part").value, 10) || 1,
        current_accountant: document.getElementById("ld_acc").value,
        next_action: document.getElementById("ld_next").value,
        expected_close_date: document.getElementById("ld_close").value
      })
    });
    document.getElementById("modal-container").innerHTML = "";
    await loadCRMPipeline();
    showToast("Lead cadastrado no Pipeline Kanban!");
    renderApp();
  } catch (err) {
    showToast(err.message, true);
  }
}

function openActivityModalForOpp(oppId) {
  const modal = document.getElementById("modal-container");
  modal.innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this)this.remove()">
      <div class="modal-box" style="max-width:520px">
        <div class="modal-head">
          <h3>Agendar Atividade / Follow-up</h3>
          <button class="btn-xs" onclick="document.getElementById('modal-container').innerHTML=''">✕</button>
        </div>
        <div class="campo">
          <label class="campo-label">Oportunidade</label>
          <select id="act_opp_id">
            ${STATE.crm.opportunities
              .map((o) => `<option value="${o.id}" ${o.id === oppId ? "selected" : ""}>${escapeHtml(o.company_name)}</option>`)
              .join("")}
          </select>
        </div>
        <div class="dois">
          <div class="campo">
            <label class="campo-label">Tipo de Interação</label>
            <select id="act_type">
              <option value="tarefa">Tarefa</option>
              <option value="ligacao">Ligação Telefônica</option>
              <option value="reuniao">Reunião Comercial</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="email">E-mail</option>
              <option value="lembrete">Lembrete</option>
            </select>
          </div>
          <div class="campo">
            <label class="campo-label">Prazo / Data</label>
            <input type="date" id="act_due" value="${new Date().toISOString().slice(0, 10)}" />
          </div>
        </div>
        <div class="campo">
          <label class="campo-label">Título da Próxima Ação *</label>
          <input type="text" id="act_title" placeholder="Ex.: Apresentar proposta revisada ao sócio" />
        </div>
        <div class="campo">
          <label class="campo-label">Observações</label>
          <textarea id="act_desc"></textarea>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:10px">
          <button class="btn-secondary" onclick="document.getElementById('modal-container').innerHTML=''">Cancelar</button>
          <button class="btn-primary" onclick="submitNewActivity()">Salvar Atividade</button>
        </div>
      </div>
    </div>
  `;
}

async function submitNewActivity() {
  await apiFetch("/api/crm/activities", {
    method: "POST",
    body: JSON.stringify({
      opportunity_id: document.getElementById("act_opp_id").value,
      activity_type: document.getElementById("act_type").value,
      due_date: document.getElementById("act_due").value,
      title: document.getElementById("act_title").value,
      description: document.getElementById("act_desc").value
    })
  });
  document.getElementById("modal-container").innerHTML = "";
  await loadCRMPipeline();
  showToast("Atividade agendada e próxima ação atualizada!");
  renderApp();
}

async function openStageHistoryModal(oppId) {
  const res = await apiFetch(`/api/crm/opportunities/${oppId}/history`);
  const hist = res.history || [];
  const modal = document.getElementById("modal-container");
  modal.innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this)this.remove()">
      <div class="modal-box" style="max-width:560px">
        <div class="modal-head">
          <h3>🕒 Histórico de Movimentações no Funil</h3>
          <button class="btn-xs" onclick="document.getElementById('modal-container').innerHTML=''">✕</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;font-size:13px">
          ${
            hist.length === 0
              ? `<p>Sem movimentações registradas.</p>`
              : hist
                  .map(
                    (h) => `
              <div style="background:var(--navy-3);padding:10px 12px;border-radius:9px;border:1px solid var(--line)">
                <strong>${escapeHtml(h.from_stage_name || "Início")} ➔ ${escapeHtml(h.to_stage_name)}</strong>
                <div style="font-size:11.5px;color:var(--muted)">${escapeHtml(h.notes || "")} · ${h.created_at}</div>
              </div>
            `
                  )
                  .join("")
          }
        </div>
      </div>
    </div>
  `;
}

/* =========================================================================
   5. MÓDULO DE CONFIGURAÇÕES DO ESCRITÓRIO (PARTE INFERIOR DO MENU)
   ========================================================================= */
function renderConfiguracoesView() {
  const s = STATE.settingsData;
  if (!s) {
    return `<div class="card"><div class="card-body">Carregando configurações do escritório...</div></div>`;
  }
  const t = s.tenant || {};
  const tpl = (s.templates || [])[0] || {};
  const smtp = t.smtp_config || {};
  const msgs = t.default_messages || {};

  return `
    <div class="dois" style="align-items:start">
      <div class="col-inputs">
        <div class="card">
          <div class="card-head">
            <div class="card-titles">
              <span class="card-title">Dados Cadastrais & Identidade Visual do Escritório</span>
              <span class="card-sub">Personaliza propostas, links públicos, cores e cabeçalhos deste tenant</span>
            </div>
          </div>
          <div class="card-body">
            <div class="dois">
              <div class="campo">
                <label class="campo-label">Razão Social do Escritório</label>
                <input type="text" id="cfg_name" value="${escapeHtml(t.name)}" />
              </div>
              <div class="campo">
                <label class="campo-label">Nome Fantasia / Marca</label>
                <input type="text" id="cfg_trade" value="${escapeHtml(t.trade_name)}" />
              </div>
            </div>
            <div class="tres">
              <div class="campo">
                <label class="campo-label">CNPJ</label>
                <input type="text" id="cfg_cnpj" value="${escapeHtml(t.cnpj)}" />
              </div>
              <div class="campo">
                <label class="campo-label">Registro CRC</label>
                <input type="text" id="cfg_crc" value="${escapeHtml(t.crc_registration)}" />
              </div>
              <div class="campo">
                <label class="campo-label">Cor Principal (Hex)</label>
                <input type="color" id="cfg_color" value="${escapeHtml(t.primary_color || "#C9A227")}" style="height:40px;padding:4px" />
              </div>
            </div>
            <div class="dois">
              <div class="campo">
                <label class="campo-label">E-mail Comercial</label>
                <input type="email" id="cfg_email" value="${escapeHtml(t.email)}" />
              </div>
              <div class="campo">
                <label class="campo-label">Telefone / WhatsApp</label>
                <input type="text" id="cfg_phone" value="${escapeHtml(t.phone)}" />
              </div>
            </div>
            <div class="campo">
              <label class="campo-label">Assinatura Comercial Padrão</label>
              <input type="text" id="cfg_sig" value="${escapeHtml(t.commercial_signature)}" />
            </div>

            <h4 style="font-size:13px;color:var(--gold);margin-top:8px">Modelo Padrão de Proposta Comercial</h4>
            <div class="campo">
              <label class="campo-label">Título Padrão da Capa</label>
              <input type="text" id="cfg_tpl_cover" value="${escapeHtml(tpl.cover_title || "")}" />
            </div>
            <div class="campo">
              <label class="campo-label">Apresentação Institucional do Escritório</label>
              <textarea id="cfg_tpl_pres">${escapeHtml(tpl.office_presentation || "")}</textarea>
            </div>
            <div class="campo">
              <label class="campo-label">Diferenciais do Escritório</label>
              <textarea id="cfg_tpl_diff">${escapeHtml(tpl.differentials_text || "")}</textarea>
            </div>
            <div class="campo">
              <label class="campo-label">Mensagem Padrão de WhatsApp</label>
              <input type="text" id="cfg_msg_whats" value="${escapeHtml(msgs.whatsapp_proposal || "")}" />
            </div>

            <h4 style="font-size:13px;color:var(--gold);margin-top:8px">Configuração de E-mail Transacional (SMTP) & Integrações</h4>
            <div class="tres">
              <div class="campo">
                <label class="campo-label">Servidor SMTP</label>
                <input type="text" id="cfg_smtp_host" value="${escapeHtml(smtp.host || "")}" placeholder="smtp.seudominio.cnt.br" />
              </div>
              <div class="campo">
                <label class="campo-label">Porta</label>
                <input type="number" id="cfg_smtp_port" value="${escapeHtml(smtp.port || 587)}" />
              </div>
              <div class="campo">
                <label class="campo-label">Usuário SMTP</label>
                <input type="text" id="cfg_smtp_user" value="${escapeHtml(smtp.user || "")}" />
              </div>
            </div>

            <div style="display:flex;gap:10px;flex-wrap:wrap">
              <button class="btn-primary" onclick="saveTenantSettings()">💾 Salvar Configurações do Escritório</button>
              <button class="btn-secondary" onclick="resetLocalDemoData()">🔄 Restaurar Dados de Demonstração</button>
            </div>
          </div>
        </div>
      </div>

      <div class="col-inputs">
        <div class="card">
          <div class="card-head" style="justify-content:space-between;flex-wrap:wrap">
            <div class="card-titles">
              <span class="card-title">Usuários e Permissões (RBAC)</span>
              <span class="card-sub">Admin Plataforma, Admin Escritório, Gestor Comercial e Vendedor</span>
            </div>
            <button class="btn-secondary" onclick="openNewUserModal()">+ Novo Usuário</button>
          </div>
          <div class="card-body">
            <div class="table-responsive">
              <table class="data-table">
                <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Alçada Desc.</th></tr></thead>
                <tbody>
                  ${(s.users || [])
                    .map(
                      (u) => `
                    <tr>
                      <td><strong>${escapeHtml(u.name)}</strong></td>
                      <td>${escapeHtml(u.email)}</td>
                      <td><span class="tag tag-gold">${escapeHtml(u.role)}</span></td>
                      <td>${u.max_discount_pct}%</td>
                    </tr>
                  `
                    )
                    .join("")}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head" style="justify-content:space-between;flex-wrap:wrap">
            <div class="card-titles">
              <span class="card-title">Multi-Tenant: Cadastrar Novo Escritório Independente</span>
              <span class="card-sub">Cria um novo tenant com dados, parâmetros, funil e propostas 100% isolados</span>
            </div>
            <button class="btn-primary" onclick="openNewTenantModal()">+ Novo Escritório SaaS</button>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <div class="card-titles">
              <span class="card-title">Trilha de Auditoria e Segurança LGPD</span>
              <span class="card-sub">Registro imutável de ações sensíveis deste escritório</span>
            </div>
          </div>
          <div class="card-body" style="max-height:290px;overflow-y:auto">
            <div class="table-responsive">
              <table class="data-table">
                <thead><tr><th>Data/Hora</th><th>Ação</th><th>Entidade</th><th>Origem</th></tr></thead>
                <tbody>
                  ${(s.auditLogs || [])
                    .map(
                      (l) => `
                    <tr>
                      <td>${escapeHtml(l.created_at)}</td>
                      <td><strong>${escapeHtml(l.action)}</strong></td>
                      <td>${escapeHtml(l.entity_type)} (${escapeHtml(l.entity_id || "-")})</td>
                      <td>${escapeHtml(l.ip_address)}</td>
                    </tr>
                  `
                    )
                    .join("")}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function resetLocalDemoData() {
  resetBrowserDB();
  showToast("Banco de dados do navegador restaurado para o estado inicial!");
  await bootstrapApp();
}

async function saveTenantSettings() {
  const color = document.getElementById("cfg_color").value;
  await apiFetch("/api/settings", {
    method: "PUT",
    body: JSON.stringify({
      name: document.getElementById("cfg_name").value,
      trade_name: document.getElementById("cfg_trade").value,
      cnpj: document.getElementById("cfg_cnpj").value,
      crc_registration: document.getElementById("cfg_crc").value,
      primary_color: color,
      email: document.getElementById("cfg_email").value,
      phone: document.getElementById("cfg_phone").value,
      commercial_signature: document.getElementById("cfg_sig").value,
      default_messages: {
        whatsapp_proposal: document.getElementById("cfg_msg_whats").value
      },
      smtp_config: {
        host: document.getElementById("cfg_smtp_host").value,
        port: document.getElementById("cfg_smtp_port").value,
        user: document.getElementById("cfg_smtp_user").value
      },
      proposal_template: {
        cover_title: document.getElementById("cfg_tpl_cover").value,
        office_presentation: document.getElementById("cfg_tpl_pres").value,
        differentials_text: document.getElementById("cfg_tpl_diff").value
      }
    })
  });
  await bootstrapApp();
  await loadSettings();
  showToast("Configurações e identidade visual atualizadas!");
  renderApp();
}

function openNewUserModal() {
  const modal = document.getElementById("modal-container");
  modal.innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this)this.remove()">
      <div class="modal-box" style="max-width:480px">
        <div class="modal-head">
          <h3>Cadastrar Usuário no Escritório</h3>
          <button class="btn-xs" onclick="document.getElementById('modal-container').innerHTML=''">✕</button>
        </div>
        <div class="campo">
          <label class="campo-label">Nome Completo *</label>
          <input type="text" id="usr_name" />
        </div>
        <div class="campo">
          <label class="campo-label">E-mail *</label>
          <input type="email" id="usr_email" />
        </div>
        <div class="dois">
          <div class="campo">
            <label class="campo-label">Perfil de Permissão (RBAC)</label>
            <select id="usr_role">
              <option value="vendedor">Vendedor</option>
              <option value="gestor_comercial">Gestor Comercial</option>
              <option value="admin_escritorio">Administrador do Escritório</option>
            </select>
          </div>
          <div class="campo">
            <label class="campo-label">Alçada Máx. Desconto (%)</label>
            <input type="number" id="usr_disc" value="8" />
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:10px">
          <button class="btn-secondary" onclick="document.getElementById('modal-container').innerHTML=''">Cancelar</button>
          <button class="btn-primary" onclick="submitNewUser()">Criar Usuário</button>
        </div>
      </div>
    </div>
  `;
}

async function submitNewUser() {
  try {
    await apiFetch("/api/users", {
      method: "POST",
      body: JSON.stringify({
        name: document.getElementById("usr_name").value,
        email: document.getElementById("usr_email").value,
        role: document.getElementById("usr_role").value,
        max_discount_pct: parseFloat(document.getElementById("usr_disc").value) || 8
      })
    });
    document.getElementById("modal-container").innerHTML = "";
    await bootstrapApp();
    await loadSettings();
    showToast("Usuário cadastrado com sucesso!");
    renderApp();
  } catch (err) {
    showToast(err.message, true);
  }
}

function openNewTenantModal() {
  const modal = document.getElementById("modal-container");
  modal.innerHTML = `
    <div class="modal-backdrop" onclick="if(event.target===this)this.remove()">
      <div class="modal-box" style="max-width:520px">
        <div class="modal-head">
          <h3>Provisionar Novo Escritório Contábil (Multi-Tenant)</h3>
          <button class="btn-xs" onclick="document.getElementById('modal-container').innerHTML=''">✕</button>
        </div>
        <div class="campo">
          <label class="campo-label">Razão Social *</label>
          <input type="text" id="tnt_name" placeholder="Ex.: Omega Contabilidade Digital Ltda." />
        </div>
        <div class="dois">
          <div class="campo">
            <label class="campo-label">Nome Fantasia *</label>
            <input type="text" id="tnt_trade" placeholder="Omega Contábil" />
          </div>
          <div class="campo">
            <label class="campo-label">Registro CRC</label>
            <input type="text" id="tnt_crc" placeholder="CRC-MG 001234/O" />
          </div>
        </div>
        <div class="tres">
          <div class="campo">
            <label class="campo-label">Cidade</label>
            <input type="text" id="tnt_city" value="Belo Horizonte" />
          </div>
          <div class="campo">
            <label class="campo-label">UF</label>
            <input type="text" id="tnt_state" value="MG" />
          </div>
          <div class="campo">
            <label class="campo-label">Cor Identidade</label>
            <input type="color" id="tnt_color" value="#10B981" style="height:40px" />
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:10px">
          <button class="btn-secondary" onclick="document.getElementById('modal-container').innerHTML=''">Cancelar</button>
          <button class="btn-primary" onclick="submitNewTenant()">Provisionar Escritório</button>
        </div>
      </div>
    </div>
  `;
}

async function submitNewTenant() {
  try {
    const res = await apiFetch("/api/tenants", {
      method: "POST",
      body: JSON.stringify({
        name: document.getElementById("tnt_name").value,
        trade_name: document.getElementById("tnt_trade").value,
        crc_registration: document.getElementById("tnt_crc").value,
        city: document.getElementById("tnt_city").value,
        state: document.getElementById("tnt_state").value,
        primary_color: document.getElementById("tnt_color").value
      })
    });
    document.getElementById("modal-container").innerHTML = "";
    await switchUserAccount(res.admin_user_id);
  } catch (err) {
    showToast(err.message, true);
  }
}

window.addEventListener("DOMContentLoaded", bootstrapApp);
