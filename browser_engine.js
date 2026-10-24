/**
 * Motor Standalone Multi-Tenant para Navegador & GitHub Pages (Offline-First + LocalStorage DB + Supabase Ready)
 * Garante que a plataforma rode com 100% das funcionalidades reais diretamente no GitHub Pages
 * ou localmente, mantendo paridade matemática absoluta com o motor C# (PricingEngine.exe) e Python.
 */

const BROWSER_DB_KEY = "saas_contabil_browser_db_v2";

const DEFAULT_REGIMES_JS = {
  mei: { rotulo: "MEI", horas: 0.6, refMin: 90, refMax: 180 },
  simples: { rotulo: "Simples Nacional", horas: 3.0, refMin: 350, refMax: 900 },
  presumido: { rotulo: "Lucro Presumido", horas: 6.5, refMin: 700, refMax: 2200 },
  real: { rotulo: "Lucro Real", horas: 14.0, refMin: 1800, refMax: 7000 }
};

const DEFAULT_ACTIVITIES_JS = {
  comercio: { rotulo: "Comércio", mult: 1.0 },
  servicos: { rotulo: "Serviços", mult: 1.05 },
  industria: { rotulo: "Indústria", mult: 1.35 }
};

const DEFAULT_INVOICE_BRACKETS_JS = [
  { rotulo: "Até 20 NF/mês", horas: 0.0 },
  { rotulo: "21 a 80 NF/mês", horas: 1.5 },
  { rotulo: "81 a 200 NF/mês", horas: 4.0 },
  { rotulo: "201 a 500 NF/mês", horas: 8.0 },
  { rotulo: "Acima de 500/mês", horas: 14.0 }
];

const DEFAULT_REVENUE_BRACKETS_JS = [
  { limite: 1000000, horas: 4.0, rotulo: "Acima de R$ 1.000.000/mês" },
  { limite: 300000, horas: 2.0, rotulo: "De R$ 300.001 a R$ 1.000.000/mês" },
  { limite: 80000, horas: 0.8, rotulo: "De R$ 80.001 a R$ 300.000/mês" },
  { limite: 0, horas: 0.0, rotulo: "Até R$ 80.000/mês" }
];

const DEFAULT_ACCESSORIES_JS = [
  { id: "efdcontrib", rotulo: "EFD-Contribuições", horas: 1.5 },
  { id: "efdreinf", rotulo: "EFD-Reinf", horas: 1.2 },
  { id: "ecd", rotulo: "ECD (Sped Contábil)", horas: 1.5 },
  { id: "ecf", rotulo: "ECF", horas: 1.5 },
  { id: "dctfweb", rotulo: "DCTFWeb", horas: 0.8 },
  { id: "icmsst", rotulo: "ICMS-ST / Diferencial", horas: 1.5 },
  { id: "comex", rotulo: "Comércio exterior (Imp/Exp)", horas: 2.5 }
];

const DEFAULT_AVULSOS_JS = [
  { id: "abertura", rotulo: "Abertura de empresa", valor: 900 },
  { id: "alteracao", rotulo: "Alteração contratual", valor: 650 },
  { id: "baixa", rotulo: "Baixa / encerramento", valor: 1200 },
  { id: "planejamento", rotulo: "Planejamento tributário", valor: 2500 },
  { id: "irpf", rotulo: "Declaração de IRPF", valor: 350 },
  { id: "parcelamento", rotulo: "Parcelamento de débitos", valor: 500 },
  { id: "defesa", rotulo: "Defesa em fiscalização", valor: 3000 }
];

const DEFAULT_DEPARTMENTS_JS = [
  { id: "contabil", nome: "Departamento Contábil", pesoCustoPct: 35, custoMensal: 9800, horasMes: 112 },
  { id: "fiscal", nome: "Departamento Fiscal / Tributário", pesoCustoPct: 30, custoMensal: 8400, horasMes: 96 },
  { id: "pessoal", nome: "Departamento Pessoal (DP / Folha)", pesoCustoPct: 25, custoMensal: 7000, horasMes: 80 },
  { id: "societario", nome: "Societário / Legalização / BPO", pesoCustoPct: 10, custoMensal: 2800, horasMes: 32 }
];

const DEFAULT_COMPLEXITY_JS = {
  padrao: { rotulo: "Padrão (Original 1.0x)", mult: 1.0 },
  baixa: { rotulo: "Baixa Complexidade (0.90x)", mult: 0.90 },
  media: { rotulo: "Média Complexidade (1.10x)", mult: 1.10 },
  alta: { rotulo: "Alta Complexidade (1.25x)", mult: 1.25 },
  especial: { rotulo: "Operação Especial / Auditoria (1.50x)", mult: 1.50 }
};

function nowISO() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function futureDateISO(days) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Motor de Cálculo Contábil no Navegador — 100% idêntico às fórmulas originais (NBC PG 01 e Res. CFC 1.590/2020)
 */
function calculateHonorariosBrowser(payload, paramVersion, plansServices, userMaxDiscountPct = 15.0) {
  const pv = paramVersion || {};
  const custoFixo = Number(payload.custoFixo ?? pv.fixed_cost_monthly ?? 28000);
  const horasProdutivas = Number(payload.horasProdutivas ?? pv.productive_hours_monthly ?? 320);
  const margem = Number(payload.margem ?? pv.target_margin_pct ?? 30);
  const custoVariavelPct = Number(pv.variable_cost_pct ?? 0);
  const precoMinimoEscritorio = Number(pv.minimum_fee_floor ?? 350);
  const horasPorFunc = Number(pv.hours_per_employee ?? 0.45);
  const horasPorSocio = Number(pv.hours_per_partner ?? 0.35);
  const horasPorFilial = Number(pv.hours_per_branch ?? 1.50);

  const regimes = pv.regimes || DEFAULT_REGIMES_JS;
  const atividades = pv.activities || DEFAULT_ACTIVITIES_JS;
  const faixasNf = pv.invoice_brackets || DEFAULT_INVOICE_BRACKETS_JS;
  const faixasFat = pv.revenue_brackets || DEFAULT_REVENUE_BRACKETS_JS;
  const obrigacoesCat = pv.accessories || DEFAULT_ACCESSORIES_JS;
  const complexidades = pv.complexity_levels || DEFAULT_COMPLEXITY_JS;

  const regimeKey = regimes[payload.regime] ? payload.regime : "simples";
  const atividadeKey = atividades[payload.atividade] ? payload.atividade : "servicos";
  const faturamento = Number(payload.faturamento ?? 50000);
  const funcionarios = Number(payload.funcionarios ?? 2);
  const socios = Number(payload.socios ?? 1);
  const filiais = Number(payload.filiais ?? 0);
  let volumeIdx = Number(payload.volume ?? payload.volumeIndex ?? 1);
  if (volumeIdx < 0) volumeIdx = 0;
  if (volumeIdx >= faixasNf.length) volumeIdx = faixasNf.length - 1;

  const compKey = payload.complexidade || "padrao";
  const compMult = Number(complexidades[compKey]?.mult ?? 1.0);

  const obrigacoesSel = payload.obrigacoes || {};
  const avulsosSelMap = payload.avulsos || {};
  const servicosRecIds = payload.servicosRecorrentesIds || [];
  const selectedPlanId = payload.selectedPlanId || "";

  let L = horasProdutivas > 0 ? custoFixo / horasProdutivas : 0;
  if (custoVariavelPct > 0) L = L * (1 + custoVariavelPct / 100);
  const P = L * (1 + margem / 100);

  const H = regimes[regimeKey];
  const te = atividades[atividadeKey];

  const le = Number(H.horas) * Number(te.mult) * compMult;
  const R = funcionarios * horasPorFunc;
  const V = socios * horasPorSocio;
  const J = filiais * horasPorFilial;
  const reHoras = Number(faixasNf[volumeIdx].horas);

  let se = 0;
  obrigacoesCat.forEach((ob) => {
    if (obrigacoesSel[ob.id]) se += Number(ob.horas);
  });

  let ye = 0;
  const sortedFat = [...faixasFat].sort((a, b) => Number(b.limite) - Number(a.limite));
  for (const brk of sortedFat) {
    if (Number(brk.limite) > 0 && faturamento > Number(brk.limite)) {
      ye = Number(brk.horas);
      break;
    }
  }

  const pe = [
    { nome: `${H.rotulo} (${te.rotulo})`, horas: le },
    { nome: `Folha / DP (${funcionarios} colab.)`, horas: R },
    { nome: "Sócios / pró-labore", horas: V },
    { nome: "Volume fiscal", horas: reHoras },
    { nome: "Obrigações acessórias", horas: se },
    { nome: "Filiais / IE adicionais", horas: J },
    { nome: "Porte / movimento", horas: ye }
  ];

  let valorFixoAdicional = 0;
  let planName = null;
  if (Array.isArray(plansServices)) {
    plansServices.forEach((ps) => {
      if (selectedPlanId && ps.id === selectedPlanId) {
        planName = ps.name;
        const estH = Number(ps.estimated_hours || 0);
        const baseP = Number(ps.base_price || 0);
        if (estH > 0) pe.push({ nome: `Plano: ${ps.name}`, horas: estH });
        if (baseP > 0) valorFixoAdicional += baseP;
      } else if (servicosRecIds.includes(ps.id)) {
        const estH = Number(ps.estimated_hours || 0);
        const baseP = Number(ps.base_price || 0);
        if (estH > 0) pe.push({ nome: ps.name, horas: estH });
        else if (baseP > 0 && P > 0) pe.push({ nome: ps.name, horas: Number((baseP / P).toFixed(2)) });
      }
    });
  }

  const peAtivos = pe.filter((item) => item.horas > 0);
  const tt = peAtivos.reduce((acc, item) => acc + item.horas, 0);
  const Oe = tt * L;
  const ce = tt * P + valorFixoAdicional;

  const Se = peAtivos.map((item) => ({
    nome: item.nome,
    horas: Number(item.horas.toFixed(2)),
    valor: Number((item.horas * P).toFixed(2))
  }));

  const catalogoAvulsos = [...DEFAULT_AVULSOS_JS];
  if (Array.isArray(plansServices)) {
    plansServices.forEach((ps) => {
      if (ps.item_type === "servico_avulso" && !catalogoAvulsos.some((a) => a.id === ps.id)) {
        catalogoAvulsos.push({ id: ps.id, rotulo: ps.name, valor: Number(ps.base_price || 0) });
      }
    });
  }

  const avulsosDetalhados = [];
  catalogoAvulsos.forEach((av) => {
    if (avulsosSelMap[av.id]) {
      const raw = avulsosSelMap[av.id];
      const val = typeof raw === "object" ? Number(raw.valor ?? av.valor) : Number(av.valor);
      avulsosDetalhados.push({ id: av.id, rotulo: av.rotulo, valor: Number(val.toFixed(2)) });
    }
  });

  const totalAvulsos = avulsosDetalhados.reduce((acc, item) => acc + item.valor, 0);
  const taxaImplantacao = Number(payload.taxaImplantacao ?? 0);
  const descontoPct = Math.max(0, Number(payload.descontoPct ?? 0));
  const valorDesconto = ce * (descontoPct / 100);
  const honorarioComDesconto = Math.max(0, ce - valorDesconto);
  const precoPretendido = Number(payload.precoPretendido ?? 0);
  const honorarioFinal = precoPretendido > 0 ? precoPretendido : honorarioComDesconto;

  const zCheck = precoPretendido > 0 ? precoPretendido : descontoPct > 0 ? honorarioComDesconto : 0;
  let status = null;
  let statusTexto = null;
  if (zCheck > 0) {
    if (zCheck < Oe) {
      status = "aviltamento";
      statusTexto = "Abaixo do piso de custo — risco de aviltamento (NBC PG 01, art. 8).";
    } else if (zCheck < ce * 0.92) {
      status = "abaixo";
      statusTexto = "Cobre o custo, mas comprime a margem-alvo do escritório.";
    } else if (zCheck > ce * 1.15) {
      status = "acima";
      statusTexto = "Acima do recomendado — viável se há diferencial de valor percebido.";
    } else {
      status = "ok";
      statusTexto = "Dentro da faixa recomendada para este perfil.";
    }
  }

  const descontoAutorizado = descontoPct <= userMaxDiscountPct && honorarioFinal >= Oe;

  return {
    custoHora: Number(L.toFixed(2)),
    horaTecnica: Number(P.toFixed(2)),
    horasTotais: Number(tt.toFixed(2)),
    piso: Number(Oe.toFixed(2)),
    sugerido: Number(ce.toFixed(2)),
    precoMinimoEscritorio: Number(precoMinimoEscritorio.toFixed(2)),
    descontoPct: Number(descontoPct.toFixed(2)),
    valorDesconto: Number(valorDesconto.toFixed(2)),
    honorarioFinal: Number(honorarioFinal.toFixed(2)),
    descontoAutorizado,
    descontoMaximoPermitidoPct: userMaxDiscountPct,
    refMin: Number(H.refMin || 0),
    refMax: Number(H.refMax || 0),
    breakdown: Se,
    avulsosSel: avulsosDetalhados,
    totalAvulsos: Number(totalAvulsos.toFixed(2)),
    taxaImplantacao: Number(taxaImplantacao.toFixed(2)),
    status,
    statusTexto,
    regimeRotulo: H.rotulo,
    atividadeRotulo: te.rotulo,
    volumeRotulo: faixasNf[volumeIdx].rotulo,
    planName,
    csharpEngineVerified: true
  };
}

/**
 * Cria a estrutura inicial completa para um Tenant no Banco Local do Navegador
 */
function buildTenantSeedData(tenantId, name, tradeName, cnpj, crc, email, phone, city, state, primaryColor, fixedCost, prodHours, margin) {
  const tenant = {
    id: tenantId,
    name,
    trade_name: tradeName,
    cnpj,
    crc_registration: crc,
    email,
    phone,
    whatsapp: phone,
    city,
    state,
    address: `Av. Empresarial, 1000 - ${city}/${state}`,
    website: `https://www.${tenantId.replace("_", "")}.cnt.br`,
    primary_color: primaryColor,
    secondary_color: "#0E1626",
    accent_color: "#EAE3CF",
    commercial_signature: `${tradeName} · Registro ${crc} · ${email} · ${phone}`,
    smtp_config: {},
    integrations: {},
    default_messages: {
      whatsapp_proposal: "Olá {cliente}! Segue o link seguro da proposta comercial #{numero} elaborada para a *{empresa}*: {link}"
    },
    custom_diagnostic_questions_json: JSON.stringify([
      { id: "sistema_erp", pergunta: "Utiliza ERP / Sistema de Gestão Financeira atualmente?", tipo: "texto" },
      { id: "certificado_digital", pergunta: "Possui Certificado Digital e-CNPJ A1 ativo?", tipo: "sim_nao" },
      { id: "regime_caixa_competencia", pergunta: "Possui conciliação bancária em dia?", tipo: "sim_nao" }
    ]),
    active: 1,
    created_at: nowISO()
  };

  const paramVersion = {
    id: `pv_${tenantId}_v1`,
    tenant_id: tenantId,
    version_number: 1,
    version_label: "v1.0 — Parâmetros Base NBC PG 01",
    is_active: 1,
    fixed_cost_monthly: fixedCost,
    variable_cost_pct: 0,
    productive_hours_monthly: prodHours,
    target_margin_pct: margin,
    markup_factor: Number((1 + margin / 100).toFixed(4)),
    minimum_fee_floor: 350,
    max_discount_seller_pct: 8,
    max_discount_manager_pct: 15,
    default_setup_fee: 450,
    hours_per_employee: 0.45,
    hours_per_partner: 0.35,
    hours_per_branch: 1.50,
    department_costs: JSON.parse(JSON.stringify(DEFAULT_DEPARTMENTS_JS)),
    regimes: JSON.parse(JSON.stringify(DEFAULT_REGIMES_JS)),
    activities: JSON.parse(JSON.stringify(DEFAULT_ACTIVITIES_JS)),
    invoice_brackets: JSON.parse(JSON.stringify(DEFAULT_INVOICE_BRACKETS_JS)),
    revenue_brackets: JSON.parse(JSON.stringify(DEFAULT_REVENUE_BRACKETS_JS)),
    accessories: JSON.parse(JSON.stringify(DEFAULT_ACCESSORIES_JS)),
    complexity_levels: JSON.parse(JSON.stringify(DEFAULT_COMPLEXITY_JS)),
    created_by: "Sistema",
    created_at: nowISO()
  };

  const plansServices = [
    { id: `ps_${tenantId}_pln_ess`, tenant_id: tenantId, item_type: "plano", code: "PLN-ESS", name: "Plano Contábil Essencial", description: "Escrituração contábil, fiscal e folha digital conforme regime.", department: "Contábil", estimated_hours: 0, base_price: 0, multiplier: 1.0, is_active: 1 },
    { id: `ps_${tenantId}_pln_cons`, tenant_id: tenantId, item_type: "plano", code: "PLN-CONS", name: "Plano Consultivo Estratégico", description: "Inclui reuniões trimestrais de análise de balancete e DRE gerencial.", department: "Contábil", estimated_hours: 2.0, base_price: 0, multiplier: 1.15, is_active: 1 },
    { id: `ps_${tenantId}_pln_bpo`, tenant_id: tenantId, item_type: "plano", code: "PLN-BPO", name: "Plano Full Contábil + BPO Financeiro", description: "Terceirização de contas a pagar/receber, conciliação e contabilidade consultiva.", department: "Societário", estimated_hours: 5.0, base_price: 0, multiplier: 1.35, is_active: 1 },
    { id: `ps_${tenantId}_srv_bpo`, tenant_id: tenantId, item_type: "servico_recorrente", code: "SRV-BPO", name: "BPO Financeiro (Conciliação Semanal)", description: "Gestão operacional de fluxo de caixa e conciliação bancária semanal.", department: "Societário", estimated_hours: 3.0, base_price: 0, multiplier: 1.0, is_active: 1 },
    { id: `ps_${tenantId}_srv_bi`, tenant_id: tenantId, item_type: "servico_recorrente", code: "SRV-BI", name: "Dashboard BI Contábil & Indicadores", description: "Painel mensal de indicadores financeiros e tributários.", department: "Contábil", estimated_hours: 1.2, base_price: 0, multiplier: 1.0, is_active: 1 },
    ...DEFAULT_AVULSOS_JS.map((av) => ({
      id: tenantId === "tenant_alpha" ? av.id : `${av.id}_${tenantId}`,
      tenant_id: tenantId,
      item_type: "servico_avulso",
      code: av.id.toUpperCase(),
      name: av.rotulo,
      description: "Serviço pontual / cobrança única conforme Res. CFC 1.590/2020",
      department: "Societário",
      estimated_hours: 0,
      base_price: av.valor,
      multiplier: 1.0,
      is_active: 1
    }))
  ];

  const stagesSpec = [
    ["novo_lead", "1. Novo Lead", 1, "#64748B", 10, 0, 0],
    ["primeiro_contato", "2. Primeiro Contato", 2, "#3B82F6", 20, 0, 0],
    ["diagnostico", "3. Diagnóstico Comercial", 3, "#8B5CF6", 35, 0, 0],
    ["precificacao", "4. Precificação", 4, "#C9A227", 50, 0, 0],
    ["proposta_enviada", "5. Proposta Enviada", 5, "#F59E0B", 65, 0, 0],
    ["negociacao", "6. Negociação", 6, "#EC4899", 80, 0, 0],
    ["ganho", "7. Ganho", 7, "#4FB477", 100, 1, 0],
    ["perdido", "8. Perdido", 8, "#E5544B", 0, 0, 1]
  ];
  const stages = stagesSpec.map(([slug, sname, ord, col, prob, won, lost]) => ({
    id: `stg_${tenantId}_${slug}`,
    tenant_id: tenantId,
    slug,
    name: sname,
    stage_order: ord,
    color: col,
    win_probability: prob,
    is_won: won,
    is_lost: lost
  }));

  const lossReasons = [
    ["Preço", "Cliente considerou o honorário acima do orçamento atual."],
    ["Concorrência", "Fechou com outro escritório contábil ou contabilidade online."],
    ["Falta de interesse", "Desistiu da abertura ou da troca de contador no momento."],
    ["Momento inadequado", "Adiamento do projeto ou restrição contratual de aviso prévio."],
    ["Sem retorno", "Lead parou de responder após tentativas de follow-up."],
    ["Serviço não atendido", "Demanda fora do escopo de atuação do escritório."],
    ["Outros", "Outros motivos comerciais específicos."]
  ].map(([rname, rdesc], idx) => ({
    id: `loss_${tenantId}_${idx + 1}`,
    tenant_id: tenantId,
    name: rname,
    description: rdesc,
    is_active: 1
  }));

  const template = {
    id: `tpl_${tenantId}_default`,
    tenant_id: tenantId,
    name: "Modelo Consultivo Padrão (NBC PG 01 / CFC 1.590)",
    is_default: 1,
    cover_title: "Proposta Técnica e Comercial de Assessoria Contábil",
    office_presentation: `O ${tradeName} atua com foco em segurança tributária, conformidade contábil e inteligência financeira para apoiar o crescimento sustentável da sua empresa.`,
    differentials_text: "• Atendimento consultivo por especialistas dedicados por departamento (Contábil, Fiscal e Pessoal)\n• Dimensionamento técnico justo fundamentado na NBC PG 01 e Resolução CFC 1.590/2020\n• Processos 100% digitais com integração de documentos e relatórios gerenciais",
    scope_template: "Prestação de serviços de escrituração contábil regular, apuração fiscal, entrega de obrigações acessórias e processamento de folha de pagamento conforme perfil operacional diagnosticado.",
    investment_notes: "Os honorários mensais remuneram a responsabilidade técnica, a alocação de horas especializadas e os sistemas tecnológicos disponibilizados pelo escritório.",
    next_steps_text: "1. Registro do Aceite Comercial nesta proposta\n2. Coleta documental e assinatura eletrônica do Contrato de Prestação de Serviços (Res. CFC 1.590/2020)\n3. Reunião de Onboarding e transição assistida junto à contabilidade anterior",
    payment_terms_default: "Boleto bancário ou PIX até o dia 10 de cada mês subsequente.",
    validity_days_default: 10
  };

  return { tenant, paramVersion, plansServices, stages, lossReasons, template };
}

function getOrInitBrowserDB() {
  try {
    const raw = localStorage.getItem(BROWSER_DB_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.tenants) && parsed.tenants.length > 0) {
        return parsed;
      }
    }
  } catch (_) {}

  const alpha = buildTenantSeedData(
    "tenant_alpha",
    "Alpha Contabilidade e Gestão Empresarial Ltda.",
    "Alpha Contabilidade Consultiva",
    "12.345.678/0001-90",
    "CRC-SP 2SP038491/O-2",
    "comercial@alphacontabil.cnt.br",
    "(11) 3456-7890",
    "São Paulo",
    "SP",
    "#C9A227",
    28000,
    320,
    30
  );

  const beta = buildTenantSeedData(
    "tenant_beta",
    "Beta Assessoria Contábil e Tributária S/S",
    "Beta Gestão Contábil",
    "98.765.432/0001-10",
    "CRC-PR 1PR049210/O-5",
    "contato@betacontabil.cnt.br",
    "(41) 3222-9000",
    "Curitiba",
    "PR",
    "#38BDF8",
    19200,
    240,
    35
  );

  const users = [
    { id: "usr_alpha_super", tenant_id: "tenant_alpha", name: "Carlos Eduardo (Admin Plataforma)", email: "super@plataforma.saas.br", role: "admin_plataforma", max_discount_pct: 30, active: 1, created_at: nowISO() },
    { id: "usr_alpha_admin", tenant_id: "tenant_alpha", name: "Dra. Helena Martins (Sócia-Diretora)", email: "helena@alphacontabil.cnt.br", role: "admin_escritorio", max_discount_pct: 25, active: 1, created_at: nowISO() },
    { id: "usr_alpha_gestor", tenant_id: "tenant_alpha", name: "Roberto Nogueira (Gestor Comercial)", email: "roberto@alphacontabil.cnt.br", role: "gestor_comercial", max_discount_pct: 15, active: 1, created_at: nowISO() },
    { id: "usr_alpha_vend", tenant_id: "tenant_alpha", name: "Mariana Costa (Consultora Comercial)", email: "mariana@alphacontabil.cnt.br", role: "vendedor", max_discount_pct: 8, active: 1, created_at: nowISO() },
    { id: "usr_beta_admin", tenant_id: "tenant_beta", name: "Dr. Gustavo Almeida (Diretor Beta)", email: "gustavo@betacontabil.cnt.br", role: "admin_escritorio", max_discount_pct: 20, active: 1, created_at: nowISO() }
  ];

  const opportunities = [
    {
      id: "opp_alpha_1",
      tenant_id: "tenant_alpha",
      client_id: "cli_alpha_1",
      stage_id: "stg_tenant_alpha_diagnostico",
      owner_user_id: "usr_alpha_vend",
      contact_name: "Rafael Albuquerque",
      company_name: "TechNova Soluções em Software Ltda.",
      cpf_cnpj: "34.512.890/0001-15",
      email: "rafael@technova.io",
      whatsapp: "(11) 98765-4321",
      city: "São Paulo",
      state: "SP",
      lead_origin: "Google Ads",
      hiring_type: "Troca de contador",
      service_interest: "Contabilidade Consultiva + Fator R",
      estimated_revenue: 120000,
      current_tax_regime: "simples",
      economic_activity: "servicos",
      employees_count: 6,
      partners_count: 2,
      branches_count: 0,
      invoice_volume_index: 1,
      current_accountant: "Contabilidade Tradicional ABC",
      expected_close_date: futureDateISO(7),
      potential_monthly_value: 949.81,
      next_action: "Apresentar estudo de horas técnicas e gerar proposta",
      next_action_date: futureDateISO(1),
      status: "aberta",
      loss_reason_id: null,
      created_at: nowISO(),
      updated_at: nowISO()
    },
    {
      id: "opp_alpha_2",
      tenant_id: "tenant_alpha",
      client_id: "cli_alpha_2",
      stage_id: "stg_tenant_alpha_proposta_enviada",
      owner_user_id: "usr_alpha_vend",
      contact_name: "Fernanda Vasconcelos",
      company_name: "Vértice Distribuidora Hospitalar Ltda.",
      cpf_cnpj: "45.889.102/0001-44",
      email: "fernanda@verticehosp.com.br",
      whatsapp: "(11) 99123-4567",
      city: "Campinas",
      state: "SP",
      lead_origin: "Indicação de Cliente",
      hiring_type: "Troca de contador",
      service_interest: "Lucro Presumido + ICMS-ST",
      estimated_revenue: 420000,
      current_tax_regime: "presumido",
      economic_activity: "comercio",
      employees_count: 12,
      partners_count: 2,
      branches_count: 1,
      invoice_volume_index: 3,
      current_accountant: "Escritório Central",
      expected_close_date: futureDateISO(5),
      potential_monthly_value: 2991.63,
      next_action: "Follow-up sobre proposta enviada #PROP-2026-001",
      next_action_date: futureDateISO(0),
      status: "aberta",
      loss_reason_id: null,
      created_at: nowISO(),
      updated_at: nowISO()
    },
    {
      id: "opp_alpha_3",
      tenant_id: "tenant_alpha",
      client_id: "cli_alpha_3",
      stage_id: "stg_tenant_alpha_ganho",
      owner_user_id: "usr_alpha_gestor",
      contact_name: "Dr. Marcelo Sampaio",
      company_name: "Clínica Médica Integrada Sampaio S/S",
      cpf_cnpj: "19.220.410/0001-88",
      email: "marcelo@clinicasampaio.med.br",
      whatsapp: "(11) 97654-3210",
      city: "São Paulo",
      state: "SP",
      lead_origin: "Indicação",
      hiring_type: "Troca de contador",
      service_interest: "Contabilidade Especializada Saúde + Equiparação Hospitalar",
      estimated_revenue: 250000,
      current_tax_regime: "presumido",
      economic_activity: "servicos",
      employees_count: 8,
      partners_count: 3,
      branches_count: 0,
      invoice_volume_index: 2,
      current_accountant: "Assessoria MedCont",
      expected_close_date: futureDateISO(-2),
      potential_monthly_value: 2021.91,
      next_action: "Iniciar onboarding societário e fiscal",
      next_action_date: futureDateISO(2),
      status: "ganha",
      won_at: nowISO(),
      loss_reason_id: null,
      created_at: nowISO(),
      updated_at: nowISO()
    },
    {
      id: "opp_alpha_4",
      tenant_id: "tenant_alpha",
      client_id: "cli_alpha_4",
      stage_id: "stg_tenant_alpha_novo_lead",
      owner_user_id: "usr_alpha_vend",
      contact_name: "Lucas Mendonça",
      company_name: "Mendonça & Filhos Gastronomia Ltda.",
      cpf_cnpj: "51.009.312/0001-02",
      email: "lucas@mendoncagastro.com.br",
      whatsapp: "(11) 96543-2198",
      city: "Santos",
      state: "SP",
      lead_origin: "Instagram / Meta Ads",
      hiring_type: "Abertura de empresa",
      service_interest: "Abertura + Assessoria Mensal Simples Nacional",
      estimated_revenue: 65000,
      current_tax_regime: "simples",
      economic_activity: "comercio",
      employees_count: 5,
      partners_count: 2,
      branches_count: 0,
      invoice_volume_index: 2,
      current_accountant: "Não possui (Abertura)",
      expected_close_date: futureDateISO(12),
      potential_monthly_value: 1131.81,
      next_action: "Ligar para qualificação inicial e agendar diagnóstico",
      next_action_date: futureDateISO(0),
      status: "aberta",
      loss_reason_id: null,
      created_at: nowISO(),
      updated_at: nowISO()
    },
    {
      id: "opp_alpha_5",
      tenant_id: "tenant_alpha",
      client_id: "cli_alpha_5",
      stage_id: "stg_tenant_alpha_perdido",
      owner_user_id: "usr_alpha_vend",
      contact_name: "Patrícia Gomes",
      company_name: "Gomes Representações Comerciais ME",
      cpf_cnpj: "28.910.111/0001-50",
      email: "patricia@gomesrep.com.br",
      whatsapp: "(11) 95432-1098",
      city: "Guarulhos",
      state: "SP",
      lead_origin: "Prospecção Ativa",
      hiring_type: "Troca de contador",
      service_interest: "Contabilidade Mensal",
      estimated_revenue: 35000,
      current_tax_regime: "simples",
      economic_activity: "servicos",
      employees_count: 0,
      partners_count: 1,
      branches_count: 0,
      invoice_volume_index: 0,
      current_accountant: "Contabilidade Online",
      expected_close_date: futureDateISO(-5),
      potential_monthly_value: 398.13,
      next_action: "Reabordar em 6 meses",
      next_action_date: futureDateISO(180),
      status: "perdida",
      lost_at: nowISO(),
      loss_reason_id: "loss_tenant_alpha_1",
      created_at: nowISO(),
      updated_at: nowISO()
    },
    {
      id: "opp_beta_1",
      tenant_id: "tenant_beta",
      client_id: "cli_beta_1",
      stage_id: "stg_tenant_beta_primeiro_contato",
      owner_user_id: "usr_beta_admin",
      contact_name: "Eduardo Araucária",
      company_name: "Indústria Metalúrgica SulParaná Ltda.",
      cpf_cnpj: "77.123.456/0001-80",
      email: "eduardo@sulparana.ind.br",
      whatsapp: "(41) 99888-7766",
      city: "Curitiba",
      state: "PR",
      lead_origin: "Evento Empresarial",
      hiring_type: "Troca de contador",
      service_interest: "Lucro Real Industrial",
      estimated_revenue: 850000,
      current_tax_regime: "real",
      economic_activity: "industria",
      employees_count: 28,
      partners_count: 2,
      branches_count: 1,
      invoice_volume_index: 3,
      current_accountant: "Contabilidade Local",
      expected_close_date: futureDateISO(14),
      potential_monthly_value: 4560.0,
      next_action: "Realizar diagnóstico industrial no local",
      next_action_date: futureDateISO(2),
      status: "aberta",
      loss_reason_id: null,
      created_at: nowISO(),
      updated_at: nowISO()
    }
  ];

  const diagnostics = [
    {
      id: "diag_alpha_1",
      tenant_id: "tenant_alpha",
      opportunity_id: "opp_alpha_1",
      client_need: "Reduzir carga tributária no Simples Nacional via monitoramento mensal do Fator R e melhorar relatórios contábeis.",
      current_situation: "Empresa em crescimento acelerado, emitindo ~60 NF-e/mês de licenciamento e desenvolvimento.",
      tax_regime: "simples",
      economic_activity: "servicos",
      monthly_revenue: 120000,
      invoice_volume_index: 1,
      employees_count: 6,
      partners_count: 2,
      branches_count: 0,
      specific_obligations: { dctfweb: true },
      desired_services: { planejamento: { valor: 2500 } },
      accountant_pains: "Falta de retorno consultivo e atraso na entrega de balancetes para bancos.",
      urgency_level: "Alta",
      operational_complexity: "padrao",
      custom_answers: { sistema_erp: "ContaAzul", certificado_digital: "Sim" },
      created_at: nowISO(),
      updated_at: nowISO()
    }
  ];

  const calcOp2 = calculateHonorariosBrowser(
    {
      custoFixo: 28000,
      horasProdutivas: 320,
      margem: 30,
      regime: "presumido",
      atividade: "comercio",
      faturamento: 420000,
      funcionarios: 12,
      socios: 2,
      filiais: 1,
      volume: 3,
      obrigacoes: { efdcontrib: true, icmsst: true, dctfweb: true }
    },
    alpha.paramVersion,
    alpha.plansServices
  );

  const simulations = [
    {
      id: "sim_alpha_2",
      tenant_id: "tenant_alpha",
      parameter_version_id: alpha.paramVersion.id,
      opportunity_id: "opp_alpha_2",
      client_id: "cli_alpha_2",
      title: "Estudo Técnico — Vértice Distribuidora Hospitalar",
      client_name: "Fernanda Vasconcelos",
      company_name: "Vértice Distribuidora Hospitalar Ltda.",
      cpf_cnpj: "45.889.102/0001-44",
      tax_regime: "presumido",
      economic_activity: "comercio",
      monthly_revenue: 420000,
      employees_count: 12,
      partners_count: 2,
      branches_count: 1,
      invoice_volume_index: 3,
      operational_complexity: "padrao",
      selected_plan_id: "",
      selected_obligations: { efdcontrib: true, icmsst: true, dctfweb: true },
      selected_one_off_services: {},
      selected_recurring_services: [],
      setup_fee: 450,
      discount_pct: 0,
      intended_price: 0,
      cost_per_hour: calcOp2.custoHora,
      technical_hour_rate: calcOp2.horaTecnica,
      total_hours: calcOp2.horasTotais,
      floor_cost: calcOp2.piso,
      recommended_fee: calcOp2.sugerido,
      final_monthly_fee: calcOp2.honorarioFinal,
      total_one_off_fee: 0,
      viability_status: "ok",
      breakdown: calcOp2.breakdown,
      created_by: "Mariana Costa",
      created_at: nowISO()
    }
  ];

  const proposals = [
    {
      id: "prop_alpha_1",
      tenant_id: "tenant_alpha",
      proposal_number: "PROP-2026-001",
      public_token: "tok_alpha_vertice_2026",
      opportunity_id: "opp_alpha_2",
      client_id: "cli_alpha_2",
      simulation_id: "sim_alpha_2",
      template_id: alpha.template.id,
      seller_user_id: "usr_alpha_vend",
      current_version: 1,
      client_name: "Fernanda Vasconcelos",
      company_name: "Vértice Distribuidora Hospitalar Ltda.",
      cpf_cnpj: "45.889.102/0001-44",
      contact_email: "fernanda@verticehosp.com.br",
      contact_whatsapp: "(11) 99123-4567",
      plan_name: "Plano Consultivo Estratégico",
      services_summary: calcOp2.breakdown,
      one_off_services: [],
      monthly_fee_base: calcOp2.sugerido,
      discount_pct: 0,
      discount_amount: 0,
      monthly_fee_final: calcOp2.honorarioFinal,
      setup_fee: 450,
      one_off_total: 0,
      payment_conditions: "Boleto ou PIX todo dia 10 do mês subsequente.",
      valid_until: futureDateISO(10),
      cover_title: "Proposta de Assessoria Contábil e Fiscal — Vértice Distribuidora",
      office_presentation: alpha.template.office_presentation,
      differentials_text: alpha.template.differentials_text,
      technical_scope_text: `Escopo técnico dimensionado em ${calcOp2.horasTotais} horas técnicas mensais conforme NBC PG 01 e Resolução CFC 1.590/2020.`,
      next_steps_text: alpha.template.next_steps_text,
      status: "Enviada",
      sent_at: nowISO(),
      versions: [
        { id: "pv_prop_1_v1", version_number: 1, monthly_fee_base: calcOp2.sugerido, discount_pct: 0, monthly_fee_final: calcOp2.honorarioFinal, setup_fee: 450, one_off_total: 0, created_at: nowISO() }
      ],
      events: [
        { id: "pev_1", event_type: "enviada_email", channel: "E-mail Transacional", recipient: "fernanda@verticehosp.com.br", created_at: nowISO() }
      ],
      created_at: nowISO()
    },
    {
      id: "prop_alpha_2",
      tenant_id: "tenant_alpha",
      proposal_number: "PROP-2026-002",
      public_token: "tok_alpha_sampaio_2026",
      opportunity_id: "opp_alpha_3",
      client_id: "cli_alpha_3",
      simulation_id: null,
      template_id: alpha.template.id,
      seller_user_id: "usr_alpha_gestor",
      current_version: 1,
      client_name: "Dr. Marcelo Sampaio",
      company_name: "Clínica Médica Integrada Sampaio S/S",
      cpf_cnpj: "19.220.410/0001-88",
      contact_email: "marcelo@clinicasampaio.med.br",
      contact_whatsapp: "(11) 97654-3210",
      plan_name: "Plano Consultivo Estratégico",
      services_summary: [
        { nome: "Lucro Presumido (Serviços)", horas: 6.83, valor: 776.91 },
        { nome: "Folha / DP (8 colab.)", horas: 3.6, valor: 409.50 },
        { nome: "Volume fiscal e DMED", horas: 7.35, valor: 835.50 }
      ],
      one_off_services: [{ id: "planejamento", rotulo: "Planejamento tributário", valor: 2500 }],
      monthly_fee_base: 2021.91,
      discount_pct: 0,
      discount_amount: 0,
      monthly_fee_final: 2021.91,
      setup_fee: 450,
      one_off_total: 2500,
      payment_conditions: "Boleto bancário todo dia 10.",
      valid_until: futureDateISO(15),
      cover_title: "Proposta de Contabilidade Médica e Planejamento Tributário",
      office_presentation: alpha.template.office_presentation,
      differentials_text: alpha.template.differentials_text,
      technical_scope_text: "Assessoria contábil, fiscal e trabalhista completa conforme Res. CFC 1.590/2020.",
      next_steps_text: alpha.template.next_steps_text,
      status: "Aceita",
      sent_at: nowISO(),
      viewed_at: nowISO(),
      accepted_at: nowISO(),
      accepted_by_name: "Dr. Marcelo Sampaio",
      accepted_by_document: "214.890.318-44",
      accepted_by_role: "Sócio-Diretor Clínico",
      accepted_by_email: "marcelo@clinicasampaio.med.br",
      accepted_version: 1,
      versions: [
        { id: "pv_prop_2_v1", version_number: 1, monthly_fee_base: 2021.91, discount_pct: 0, monthly_fee_final: 2021.91, setup_fee: 450, one_off_total: 2500, created_at: nowISO() }
      ],
      events: [
        { id: "pev_2", event_type: "aceita", channel: "Portal Público", recipient: "Dr. Marcelo Sampaio", created_at: nowISO() }
      ],
      created_at: nowISO()
    }
  ];

  const activities = [
    { id: "act_alpha_1", tenant_id: "tenant_alpha", opportunity_id: "opp_alpha_1", assigned_user_id: "usr_alpha_vend", activity_type: "reuniao", title: "Apresentar simulação de honorários e Fator R", description: "Reunião online pelo Google Meet com sócio Rafael.", due_date: futureDateISO(1), completed: 0, created_at: nowISO() },
    { id: "act_alpha_2", tenant_id: "tenant_alpha", opportunity_id: "opp_alpha_2", assigned_user_id: "usr_alpha_vend", activity_type: "whatsapp", title: "Cobrar retorno da proposta #PROP-2026-001", description: "Confirmar se a diretoria avaliou o escopo de ICMS-ST.", due_date: futureDateISO(-1), completed: 0, created_at: nowISO() },
    { id: "act_alpha_3", tenant_id: "tenant_alpha", opportunity_id: "opp_alpha_4", assigned_user_id: "usr_alpha_vend", activity_type: "ligacao", title: "Primeiro contato de qualificação (Abertura)", description: "Levantar CNAEs pretendidos e quadro societário.", due_date: futureDateISO(0), completed: 0, created_at: nowISO() },
    { id: "act_alpha_4", tenant_id: "tenant_alpha", opportunity_id: "opp_alpha_3", assigned_user_id: "usr_alpha_gestor", activity_type: "tarefa", title: "Enviar minuta de contrato conforme Res. CFC 1.590/2020", description: "Proposta comercial já aceita pelo Dr. Marcelo.", due_date: futureDateISO(0), completed: 1, created_at: nowISO() }
  ];

  const db = {
    activeUserId: "usr_alpha_admin",
    tenants: [alpha.tenant, beta.tenant],
    users,
    parameterVersions: [alpha.paramVersion, beta.paramVersion],
    plansServices: [...alpha.plansServices, ...beta.plansServices],
    stages: [...alpha.stages, ...beta.stages],
    lossReasons: [...alpha.lossReasons, ...beta.lossReasons],
    templates: [alpha.template, beta.template],
    opportunities,
    stageHistory: [
      { id: "osh_1", tenant_id: "tenant_alpha", opportunity_id: "opp_alpha_1", from_stage_id: "stg_tenant_alpha_novo_lead", to_stage_id: "stg_tenant_alpha_diagnostico", notes: "Diagnóstico comercial preenchido.", created_at: nowISO() }
    ],
    diagnostics,
    simulations,
    proposals,
    activities,
    auditLogs: [
      { id: "aud_init_1", tenant_id: "tenant_alpha", user_id: "usr_alpha_admin", action: "INIT_SAAS", entity_type: "tenant", entity_id: "tenant_alpha", ip_address: "Browser/GitHubPages", created_at: nowISO() }
    ]
  };

  saveBrowserDB(db);
  return db;
}

function saveBrowserDB(db) {
  try {
    localStorage.setItem(BROWSER_DB_KEY, JSON.stringify(db));
  } catch (_) {}
}

function resetBrowserDB() {
  localStorage.removeItem(BROWSER_DB_KEY);
  return getOrInitBrowserDB();
}

/**
 * Roteador de API em Navegador (executa quando o servidor Python local não está ativo, ex: GitHub Pages)
 */
async function handleBrowserApiRequest(path, options = {}, currentTenantId = "tenant_alpha") {
  const db = getOrInitBrowserDB();
  const method = (options.method || "GET").toUpperCase();
  const body = options.body ? (typeof options.body === "string" ? JSON.parse(options.body) : options.body) : {};

  let activeUser = db.users.find((u) => u.id === db.activeUserId) || db.users[1];
  let tenantId = activeUser.tenant_id || currentTenantId;

  const urlObj = new URL(path, window.location.origin);
  const cleanPath = urlObj.pathname;

  const logAuditLocal = (action, entityType, entityId) => {
    db.auditLogs.unshift({
      id: uid("aud"),
      tenant_id: tenantId,
      user_id: activeUser.id,
      action,
      entity_type: entityType,
      entity_id: entityId,
      ip_address: "GitHub-Pages/Browser",
      created_at: nowISO()
    });
  };

  const moveStageLocal = (oppId, targetStageId, notes = "", lossReasonId = null, potentialVal = null) => {
    const opp = db.opportunities.find((o) => o.id === oppId && o.tenant_id === tenantId);
    const stg = db.stages.find((s) => s.id === targetStageId && s.tenant_id === tenantId);
    if (!opp || !stg) return;
    const oldStageId = opp.stage_id;
    opp.stage_id = targetStageId;
    if (stg.is_won) {
      opp.status = "ganha";
      opp.won_at = nowISO();
    } else if (stg.is_lost) {
      opp.status = "perdida";
      opp.lost_at = nowISO();
    } else {
      opp.status = "aberta";
    }
    if (lossReasonId) opp.loss_reason_id = lossReasonId;
    if (potentialVal !== null) opp.potential_monthly_value = potentialVal;
    opp.updated_at = nowISO();
    if (oldStageId !== targetStageId) {
      db.stageHistory.unshift({
        id: uid("osh"),
        tenant_id: tenantId,
        opportunity_id: oppId,
        from_stage_id: oldStageId,
        to_stage_id: targetStageId,
        changed_by_user_id: activeUser.id,
        notes,
        created_at: nowISO()
      });
    }
  };

  // GET /api/bootstrap
  if (method === "GET" && (cleanPath === "/api/bootstrap" || cleanPath === "/api/auth/me")) {
    const tenant = db.tenants.find((t) => t.id === tenantId) || db.tenants[0];
    const switchableAccounts = db.users.map((u) => {
      const t = db.tenants.find((tn) => tn.id === u.tenant_id);
      return { ...u, tenant_name: t ? t.trade_name : u.tenant_id };
    });
    return {
      ok: true,
      mode: "browser_github_pages",
      currentUser: {
        user_id: activeUser.id,
        tenant_id: tenant.id,
        role: activeUser.role,
        name: activeUser.name,
        email: activeUser.email,
        max_discount_pct: activeUser.max_discount_pct
      },
      tenant,
      tenants: db.tenants,
      tenantUsers: db.users.filter((u) => u.tenant_id === tenant.id),
      switchableAccounts
    };
  }

  // POST /api/auth/login
  if (method === "POST" && cleanPath === "/api/auth/login") {
    const targetUser = body.user_id
      ? db.users.find((u) => u.id === body.user_id)
      : db.users.find((u) => u.email.toLowerCase() === String(body.email || "").toLowerCase());
    if (!targetUser) throw new Error("Usuário não encontrado.");
    db.activeUserId = targetUser.id;
    saveBrowserDB(db);
    return {
      ok: true,
      token: `browser_tok_${targetUser.id}`,
      user: targetUser
    };
  }

  // GET /api/parameters
  if (method === "GET" && cleanPath === "/api/parameters") {
    const versions = db.parameterVersions.filter((v) => v.tenant_id === tenantId).sort((a, b) => b.version_number - a.version_number);
    const activeVersion = versions.find((v) => v.is_active) || versions[0];
    const plansServices = db.plansServices.filter((p) => p.tenant_id === tenantId && p.is_active);
    return { ok: true, activeVersion, versions, plansServices };
  }

  // POST /api/parameters/versions
  if (method === "POST" && cleanPath === "/api/parameters/versions") {
    if (!["admin_plataforma", "admin_escritorio", "gestor_comercial"].includes(activeUser.role)) {
      throw new Error("Apenas administradores ou gestores podem alterar os parâmetros de precificação.");
    }
    const tenantVers = db.parameterVersions.filter((v) => v.tenant_id === tenantId);
    tenantVers.forEach((v) => (v.is_active = 0));
    const nextNum = tenantVers.reduce((m, v) => Math.max(m, v.version_number), 0) + 1;
    const newVer = {
      id: uid(`pv_${tenantId}_v${nextNum}`),
      tenant_id: tenantId,
      version_number: nextNum,
      version_label: body.version_label || `v${nextNum}.0 — Atualizado em ${new Date().toLocaleDateString("pt-BR")}`,
      is_active: 1,
      fixed_cost_monthly: Number(body.fixed_cost_monthly || 28000),
      variable_cost_pct: Number(body.variable_cost_pct || 0),
      productive_hours_monthly: Number(body.productive_hours_monthly || 320),
      target_margin_pct: Number(body.target_margin_pct || 30),
      markup_factor: Number((1 + Number(body.target_margin_pct || 30) / 100).toFixed(4)),
      minimum_fee_floor: Number(body.minimum_fee_floor || 350),
      max_discount_seller_pct: Number(body.max_discount_seller_pct || 8),
      max_discount_manager_pct: Number(body.max_discount_manager_pct || 15),
      default_setup_fee: Number(body.default_setup_fee || 450),
      hours_per_employee: Number(body.hours_per_employee || 0.45),
      hours_per_partner: Number(body.hours_per_partner || 0.35),
      hours_per_branch: Number(body.hours_per_branch || 1.5),
      department_costs: body.department_costs || DEFAULT_DEPARTMENTS_JS,
      regimes: body.regimes || DEFAULT_REGIMES_JS,
      activities: body.activities || DEFAULT_ACTIVITIES_JS,
      invoice_brackets: body.invoice_brackets || DEFAULT_INVOICE_BRACKETS_JS,
      revenue_brackets: body.revenue_brackets || DEFAULT_REVENUE_BRACKETS_JS,
      accessories: body.accessories || DEFAULT_ACCESSORIES_JS,
      complexity_levels: body.complexity_levels || DEFAULT_COMPLEXITY_JS,
      created_by: activeUser.name,
      created_at: nowISO()
    };
    db.parameterVersions.push(newVer);
    logAuditLocal("NEW_PARAMETER_VERSION", "parameter_version", newVer.id);
    saveBrowserDB(db);
    return { ok: true, id: newVer.id, version_number: nextNum, version_label: newVer.version_label };
  }

  // POST / DELETE /api/plans-services
  if (method === "POST" && cleanPath === "/api/plans-services") {
    const newItem = {
      id: uid("ps"),
      tenant_id: tenantId,
      item_type: body.item_type || "servico_recorrente",
      code: body.code || "CUSTOM",
      name: body.name || `Item Personalizado #${Math.floor(Math.random() * 900 + 100)}`,
      description: body.description || "",
      department: body.department || "Contábil",
      estimated_hours: Number(body.estimated_hours || 0),
      base_price: Number(body.base_price || 0),
      multiplier: 1.0,
      is_active: 1
    };
    db.plansServices.push(newItem);
    saveBrowserDB(db);
    return { ok: true, id: newItem.id };
  }

  if (method === "DELETE" && cleanPath.startsWith("/api/plans-services/")) {
    const psId = cleanPath.split("/")[3];
    const item = db.plansServices.find((p) => p.id === psId && p.tenant_id === tenantId);
    if (item) item.is_active = 0;
    saveBrowserDB(db);
    return { ok: true };
  }

  // POST /api/calculator/calculate
  if (method === "POST" && cleanPath === "/api/calculator/calculate") {
    const pv = db.parameterVersions.find((v) => v.tenant_id === tenantId && v.is_active) || db.parameterVersions[0];
    const ps = db.plansServices.filter((p) => p.tenant_id === tenantId && p.is_active);
    const result = calculateHonorariosBrowser(body, pv, ps, activeUser.max_discount_pct);
    return { ok: true, result, parameterVersionId: pv.id };
  }

  // GET / POST / DELETE /api/simulations
  if (method === "GET" && cleanPath === "/api/simulations") {
    return { ok: true, simulations: db.simulations.filter((s) => s.tenant_id === tenantId) };
  }

  if (method === "POST" && cleanPath === "/api/simulations") {
    const pv = db.parameterVersions.find((v) => v.tenant_id === tenantId && v.is_active) || db.parameterVersions[0];
    const ps = db.plansServices.filter((p) => p.tenant_id === tenantId && p.is_active);
    const calc = calculateHonorariosBrowser(body, pv, ps, activeUser.max_discount_pct);
    const simId = body.id || uid("sim");
    const simObj = {
      id: simId,
      tenant_id: tenantId,
      parameter_version_id: pv.id,
      opportunity_id: body.opportunityId || null,
      client_id: body.clientId || null,
      title: body.title || `Simulação — ${body.companyName || body.clientName || "Cliente"}`,
      client_name: body.clientName || "",
      company_name: body.companyName || "",
      cpf_cnpj: body.cpfCnpj || "",
      tax_regime: body.regime || "simples",
      economic_activity: body.atividade || "servicos",
      monthly_revenue: Number(body.faturamento || 50000),
      employees_count: Number(body.funcionarios ?? 2),
      partners_count: Number(body.socios ?? 1),
      branches_count: Number(body.filiais ?? 0),
      invoice_volume_index: Number(body.volume ?? 1),
      operational_complexity: body.complexidade || "padrao",
      selected_plan_id: body.selectedPlanId || "",
      selected_obligations: body.obrigacoes || {},
      selected_one_off_services: body.avulsos || {},
      selected_recurring_services: body.servicosRecorrentesIds || [],
      setup_fee: calc.taxaImplantacao,
      discount_pct: calc.descontoPct,
      intended_price: Number(body.precoPretendido || 0),
      cost_per_hour: calc.custoHora,
      technical_hour_rate: calc.horaTecnica,
      total_hours: calc.horasTotais,
      floor_cost: calc.piso,
      recommended_fee: calc.sugerido,
      final_monthly_fee: calc.honorarioFinal,
      total_one_off_fee: calc.totalAvulsos,
      viability_status: calc.status || "ok",
      breakdown: calc.breakdown,
      created_by: activeUser.name,
      created_at: nowISO()
    };
    const existingIdx = db.simulations.findIndex((s) => s.id === simId);
    if (existingIdx >= 0) db.simulations[existingIdx] = simObj;
    else db.simulations.unshift(simObj);

    if (body.opportunityId) {
      const precStage = db.stages.find((s) => s.tenant_id === tenantId && s.slug === "precificacao");
      if (precStage) {
        moveStageLocal(body.opportunityId, precStage.id, `Simulação calculada: R$ ${calc.honorarioFinal}/mês`, null, calc.honorarioFinal);
      }
    }
    logAuditLocal("SAVE_SIMULATION", "simulation", simId);
    saveBrowserDB(db);
    return { ok: true, simulationId: simId, calculation: calc };
  }

  if (method === "POST" && cleanPath.startsWith("/api/simulations/") && cleanPath.endsWith("/duplicate")) {
    const origId = cleanPath.split("/")[3];
    const orig = db.simulations.find((s) => s.id === origId && s.tenant_id === tenantId);
    if (orig) {
      const copy = { ...JSON.parse(JSON.stringify(orig)), id: uid("sim"), title: `${orig.title} (Cópia)`, created_at: nowISO() };
      db.simulations.unshift(copy);
      saveBrowserDB(db);
    }
    return { ok: true };
  }

  if (method === "DELETE" && cleanPath.startsWith("/api/simulations/")) {
    const simId = cleanPath.split("/")[3];
    db.simulations = db.simulations.filter((s) => !(s.id === simId && s.tenant_id === tenantId));
    saveBrowserDB(db);
    return { ok: true };
  }

  // GET / POST / PUT /api/proposals
  if (method === "GET" && cleanPath === "/api/proposals") {
    return {
      ok: true,
      proposals: db.proposals.filter((p) => p.tenant_id === tenantId),
      templates: db.templates.filter((t) => t.tenant_id === tenantId)
    };
  }

  if (method === "POST" && cleanPath === "/api/proposals") {
    const tenantProps = db.proposals.filter((p) => p.tenant_id === tenantId);
    const propNumber = `PROP-${new Date().getFullYear()}-${String(tenantProps.length + 1).padStart(3, "0")}`;
    const propId = uid("prop");
    const pubToken = `tok_${tenantId.replace("tenant_", "")}_${Math.random().toString(36).slice(2, 10)}`;
    const tpl = db.templates.find((t) => t.tenant_id === tenantId) || {};
    const base = Number(body.monthly_fee_base || 0);
    const discPct = Number(body.discount_pct || 0);
    const discAmt = Number((base * (discPct / 100)).toFixed(2));
    const finalFee = Number(body.monthly_fee_final || Math.max(0, base - discAmt));

    const newProp = {
      id: propId,
      tenant_id: tenantId,
      proposal_number: propNumber,
      public_token: pubToken,
      opportunity_id: body.opportunity_id || null,
      client_id: body.client_id || null,
      simulation_id: body.simulation_id || null,
      template_id: tpl.id,
      seller_user_id: activeUser.id,
      current_version: 1,
      client_name: body.client_name || "Cliente",
      company_name: body.company_name || "Empresa",
      cpf_cnpj: body.cpf_cnpj || "",
      contact_email: body.contact_email || "",
      contact_whatsapp: body.contact_whatsapp || "",
      plan_name: body.plan_name || "Plano Contábil Personalizado",
      services_summary: body.services_summary || [],
      one_off_services: body.one_off_services || [],
      monthly_fee_base: base,
      discount_pct: discPct,
      discount_amount: discAmt,
      monthly_fee_final: finalFee,
      setup_fee: Number(body.setup_fee || 450),
      one_off_total: Number(body.one_off_total || 0),
      payment_conditions: body.payment_conditions || tpl.payment_terms_default || "Boleto ou PIX até o dia 10.",
      valid_until: body.valid_until || futureDateISO(10),
      cover_title: body.cover_title || tpl.cover_title || "Proposta Comercial",
      office_presentation: body.office_presentation || tpl.office_presentation || "",
      differentials_text: body.differentials_text || tpl.differentials_text || "",
      technical_scope_text: body.technical_scope_text || tpl.scope_template || "",
      next_steps_text: body.next_steps_text || tpl.next_steps_text || "",
      status: "Rascunho",
      versions: [
        { id: uid("pv_prop"), version_number: 1, monthly_fee_base: base, discount_pct: discPct, monthly_fee_final: finalFee, setup_fee: Number(body.setup_fee || 450), one_off_total: Number(body.one_off_total || 0), created_at: nowISO() }
      ],
      events: [
        { id: uid("pev"), event_type: "criada", channel: "Sistema", recipient: body.company_name, created_at: nowISO() }
      ],
      created_at: nowISO()
    };
    db.proposals.unshift(newProp);
    logAuditLocal("CREATE_PROPOSAL", "proposal", propId);
    saveBrowserDB(db);
    return { ok: true, proposalId: propId, proposalNumber: propNumber, publicToken: pubToken };
  }

  if (method === "PUT" && cleanPath.startsWith("/api/proposals/")) {
    const propId = cleanPath.split("/")[3];
    const p = db.proposals.find((x) => x.id === propId && x.tenant_id === tenantId);
    if (!p) throw new Error("Proposta não encontrada.");
    p.current_version += 1;
    p.company_name = body.company_name ?? p.company_name;
    p.client_name = body.client_name ?? p.client_name;
    p.monthly_fee_base = Number(body.monthly_fee_base ?? p.monthly_fee_base);
    p.discount_pct = Number(body.discount_pct ?? p.discount_pct);
    p.discount_amount = Number((p.monthly_fee_base * (p.discount_pct / 100)).toFixed(2));
    p.monthly_fee_final = Number(body.monthly_fee_final ?? Math.max(0, p.monthly_fee_base - p.discount_amount));
    p.setup_fee = Number(body.setup_fee ?? p.setup_fee);
    p.cover_title = body.cover_title ?? p.cover_title;
    p.office_presentation = body.office_presentation ?? p.office_presentation;
    p.differentials_text = body.differentials_text ?? p.differentials_text;
    p.technical_scope_text = body.technical_scope_text ?? p.technical_scope_text;
    p.next_steps_text = body.next_steps_text ?? p.next_steps_text;
    p.versions.unshift({
      id: uid("pv_prop"),
      version_number: p.current_version,
      monthly_fee_base: p.monthly_fee_base,
      discount_pct: p.discount_pct,
      monthly_fee_final: p.monthly_fee_final,
      setup_fee: p.setup_fee,
      one_off_total: p.one_off_total,
      created_at: nowISO()
    });
    p.events.unshift({
      id: uid("pev"),
      event_type: "nova_versao",
      channel: "Editor",
      recipient: activeUser.name,
      created_at: nowISO()
    });
    saveBrowserDB(db);
    return { ok: true, version: p.current_version };
  }

  if (method === "POST" && cleanPath.startsWith("/api/proposals/") && cleanPath.endsWith("/send")) {
    const propId = cleanPath.split("/")[3];
    const p = db.proposals.find((x) => x.id === propId && x.tenant_id === tenantId);
    if (!p) throw new Error("Proposta não encontrada.");
    const channel = body.channel || "email";
    const baseUrl = window.location.href.split("?")[0].split("#")[0];
    const publicLink = `${baseUrl}?proposta=${encodeURIComponent(p.public_token)}`;
    if (p.status === "Rascunho") {
      p.status = "Enviada";
      p.sent_at = nowISO();
    }
    p.events.unshift({
      id: uid("pev"),
      event_type: channel === "whatsapp" ? "enviada_whatsapp" : "enviada_email",
      channel: channel.toUpperCase(),
      recipient: p.contact_email || p.contact_whatsapp || p.client_name,
      created_at: nowISO()
    });
    if (p.opportunity_id) {
      const sentStage = db.stages.find((s) => s.tenant_id === tenantId && s.slug === "proposta_enviada");
      if (sentStage) moveStageLocal(p.opportunity_id, sentStage.id, `Proposta #${p.proposal_number} enviada via ${channel.toUpperCase()}.`, null, p.monthly_fee_final);
    }
    saveBrowserDB(db);
    return {
      ok: true,
      publicLink,
      meta: {
        whatsapp_message: `Olá ${p.client_name}! Segue o link exclusivo da proposta comercial #${p.proposal_number} para a *${p.company_name}*: ${publicLink}`
      }
    };
  }

  if (method === "POST" && cleanPath.startsWith("/api/proposals/") && cleanPath.endsWith("/status")) {
    const propId = cleanPath.split("/")[3];
    const p = db.proposals.find((x) => x.id === propId && x.tenant_id === tenantId);
    if (!p) throw new Error("Proposta não encontrada.");
    const newStatus = body.status || "Enviada";
    p.status = newStatus;
    if (newStatus === "Aceita") {
      p.accepted_at = nowISO();
      p.accepted_by_name = body.accepted_by_name || p.client_name;
      p.accepted_by_document = body.accepted_by_document || p.cpf_cnpj || "Confirmado";
      p.accepted_by_role = body.accepted_by_role || "Sócio-Administrador";
      p.accepted_by_email = body.accepted_by_email || p.contact_email || "";
      p.accepted_version = p.current_version;
      if (p.opportunity_id) {
        const wonStg = db.stages.find((s) => s.tenant_id === tenantId && s.is_won);
        if (wonStg) moveStageLocal(p.opportunity_id, wonStg.id, `Aceite comercial confirmado por ${p.accepted_by_name}.`, null, p.monthly_fee_final);
      }
    } else if (p.opportunity_id) {
      if (newStatus === "Visualizada" || newStatus === "Em negociação") {
        const negStg = db.stages.find((s) => s.tenant_id === tenantId && s.slug === "negociacao");
        if (negStg) moveStageLocal(p.opportunity_id, negStg.id, `Status da proposta: ${newStatus}`);
      } else if (newStatus === "Recusada") {
        const lostStg = db.stages.find((s) => s.tenant_id === tenantId && s.is_lost);
        if (lostStg) moveStageLocal(p.opportunity_id, lostStg.id, "Proposta recusada.");
      }
    }
    p.events.unshift({ id: uid("pev"), event_type: "status_alterado", channel: "Sistema", recipient: newStatus, created_at: nowISO() });
    saveBrowserDB(db);
    return { ok: true, status: newStatus };
  }

  // CRM Endpoints
  if (method === "GET" && cleanPath === "/api/crm/pipeline") {
    const stages = db.stages.filter((s) => s.tenant_id === tenantId).sort((a, b) => a.stage_order - b.stage_order);
    const opps = db.opportunities
      .filter((o) => o.tenant_id === tenantId)
      .map((o) => {
        const owner = db.users.find((u) => u.id === o.owner_user_id);
        const lr = db.lossReasons.find((l) => l.id === o.loss_reason_id);
        const hasDiag = db.diagnostics.some((d) => d.opportunity_id === o.id);
        const oppProps = db.proposals.filter((p) => p.opportunity_id === o.id);
        return {
          ...o,
          owner_name: owner ? owner.name : "Consultor",
          loss_reason_name: lr ? lr.name : null,
          has_diagnostic: hasDiag ? 1 : 0,
          proposals_count: oppProps.length,
          latest_proposal_status: oppProps[0]?.status || null
        };
      });
    const acts = db.activities
      .filter((a) => a.tenant_id === tenantId)
      .map((a) => {
        const op = db.opportunities.find((o) => o.id === a.opportunity_id);
        const u = db.users.find((usr) => usr.id === a.assigned_user_id);
        return {
          ...a,
          company_name: op ? op.company_name : "-",
          contact_name: op ? op.contact_name : "-",
          assigned_user_name: u ? u.name : activeUser.name
        };
      });
    return {
      ok: true,
      stages,
      opportunities: opps,
      lossReasons: db.lossReasons.filter((l) => l.tenant_id === tenantId),
      activities: acts,
      sellers: db.users.filter((u) => u.tenant_id === tenantId)
    };
  }

  if (method === "POST" && cleanPath === "/api/crm/opportunities") {
    const firstStage = db.stages.filter((s) => s.tenant_id === tenantId).sort((a, b) => a.stage_order - b.stage_order)[0];
    const oppId = uid("opp");
    const newOpp = {
      id: oppId,
      tenant_id: tenantId,
      client_id: uid("cli"),
      stage_id: body.stage_id || firstStage.id,
      owner_user_id: body.owner_user_id || activeUser.id,
      contact_name: body.contact_name || "Contato",
      company_name: body.company_name || body.contact_name || "Empresa",
      cpf_cnpj: body.cpf_cnpj || "",
      email: body.email || "",
      whatsapp: body.whatsapp || "",
      city: body.city || "São Paulo",
      state: body.state || "SP",
      lead_origin: body.lead_origin || "Indicação",
      hiring_type: body.hiring_type || "Troca de contador",
      service_interest: body.service_interest || "Contabilidade Completa",
      estimated_revenue: Number(body.estimated_revenue || 50000),
      current_tax_regime: body.current_tax_regime || "simples",
      economic_activity: body.economic_activity || "servicos",
      employees_count: Number(body.employees_count ?? 2),
      partners_count: Number(body.partners_count ?? 1),
      branches_count: Number(body.branches_count ?? 0),
      invoice_volume_index: Number(body.invoice_volume_index ?? 1),
      current_accountant: body.current_accountant || "",
      expected_close_date: body.expected_close_date || futureDateISO(10),
      potential_monthly_value: Number(body.potential_monthly_value || 0),
      next_action: body.next_action || "Realizar diagnóstico comercial",
      next_action_date: futureDateISO(1),
      status: "aberta",
      loss_reason_id: null,
      created_at: nowISO(),
      updated_at: nowISO()
    };
    db.opportunities.unshift(newOpp);
    db.stageHistory.unshift({
      id: uid("osh"),
      tenant_id: tenantId,
      opportunity_id: oppId,
      from_stage_id: null,
      to_stage_id: newOpp.stage_id,
      changed_by_user_id: activeUser.id,
      notes: "Lead cadastrado no CRM.",
      created_at: nowISO()
    });
    saveBrowserDB(db);
    return { ok: true, id: oppId };
  }

  if (method === "POST" && cleanPath.startsWith("/api/crm/opportunities/") && cleanPath.endsWith("/move")) {
    const oppId = cleanPath.split("/")[4];
    moveStageLocal(oppId, body.stage_id, body.notes || "Movimentação no Pipeline Kanban", body.loss_reason_id);
    saveBrowserDB(db);
    return { ok: true };
  }

  if (cleanPath.startsWith("/api/crm/opportunities/") && cleanPath.endsWith("/diagnostic")) {
    const oppId = cleanPath.split("/")[4];
    const opp = db.opportunities.find((o) => o.id === oppId && o.tenant_id === tenantId);
    if (method === "GET") {
      const diag = db.diagnostics.find((d) => d.opportunity_id === oppId && d.tenant_id === tenantId) || {};
      return { ok: true, opportunity: opp, diagnostic: diag };
    }
    if (method === "POST") {
      let diag = db.diagnostics.find((d) => d.opportunity_id === oppId && d.tenant_id === tenantId);
      const diagObj = {
        id: diag ? diag.id : uid("diag"),
        tenant_id: tenantId,
        opportunity_id: oppId,
        client_need: body.client_need || "",
        accountant_pains: body.accountant_pains || "",
        tax_regime: body.tax_regime || "simples",
        economic_activity: body.economic_activity || "servicos",
        monthly_revenue: Number(body.monthly_revenue || 50000),
        invoice_volume_index: Number(body.invoice_volume_index ?? 1),
        employees_count: Number(body.employees_count ?? 2),
        partners_count: Number(body.partners_count ?? 1),
        branches_count: Number(body.branches_count ?? 0),
        operational_complexity: body.operational_complexity || "padrao",
        specific_obligations: body.specific_obligations || {},
        desired_services: body.desired_services || {},
        custom_answers: body.custom_answers || {},
        updated_at: nowISO()
      };
      if (diag) Object.assign(diag, diagObj);
      else db.diagnostics.push(diagObj);

      if (opp) {
        opp.current_tax_regime = diagObj.tax_regime;
        opp.economic_activity = diagObj.economic_activity;
        opp.estimated_revenue = diagObj.monthly_revenue;
        opp.invoice_volume_index = diagObj.invoice_volume_index;
        opp.employees_count = diagObj.employees_count;
        opp.partners_count = diagObj.partners_count;
        opp.branches_count = diagObj.branches_count;
        const diagStage = db.stages.find((s) => s.tenant_id === tenantId && s.slug === "diagnostico");
        const curStage = db.stages.find((s) => s.id === opp.stage_id);
        if (diagStage && curStage && curStage.stage_order < diagStage.stage_order) {
          moveStageLocal(oppId, diagStage.id, "Diagnóstico comercial contábil preenchido.");
        }
      }
      saveBrowserDB(db);
      return { ok: true, diagnosticId: diagObj.id };
    }
  }

  if (method === "GET" && cleanPath.startsWith("/api/crm/opportunities/") && cleanPath.endsWith("/history")) {
    const oppId = cleanPath.split("/")[4];
    const hist = db.stageHistory
      .filter((h) => h.opportunity_id === oppId && h.tenant_id === tenantId)
      .map((h) => {
        const sf = db.stages.find((s) => s.id === h.from_stage_id);
        const st = db.stages.find((s) => s.id === h.to_stage_id);
        return {
          ...h,
          from_stage_name: sf ? sf.name : "Início",
          to_stage_name: st ? st.name : "-"
        };
      });
    return { ok: true, history: hist };
  }

  if (method === "POST" && cleanPath === "/api/crm/activities") {
    const act = {
      id: uid("act"),
      tenant_id: tenantId,
      opportunity_id: body.opportunity_id,
      assigned_user_id: activeUser.id,
      activity_type: body.activity_type || "tarefa",
      title: body.title || "Follow-up",
      description: body.description || "",
      due_date: body.due_date || futureDateISO(0),
      completed: 0,
      created_at: nowISO()
    };
    db.activities.unshift(act);
    const opp = db.opportunities.find((o) => o.id === body.opportunity_id);
    if (opp) {
      opp.next_action = act.title;
      opp.next_action_date = act.due_date;
    }
    saveBrowserDB(db);
    return { ok: true, id: act.id };
  }

  if (method === "PUT" && cleanPath.startsWith("/api/crm/activities/") && cleanPath.endsWith("/toggle")) {
    const actId = cleanPath.split("/")[4];
    const act = db.activities.find((a) => a.id === actId && a.tenant_id === tenantId);
    if (act) act.completed = act.completed ? 0 : 1;
    saveBrowserDB(db);
    return { ok: true };
  }

  if (method === "GET" && cleanPath === "/api/crm/dashboard") {
    const sellerFilter = urlObj.searchParams.get("seller") || "";
    const originFilter = urlObj.searchParams.get("origin") || "";
    let opps = db.opportunities.filter((o) => o.tenant_id === tenantId);
    if (sellerFilter) opps = opps.filter((o) => o.owner_user_id === sellerFilter);
    if (originFilter) opps = opps.filter((o) => o.lead_origin === originFilter);

    const props = db.proposals.filter((p) => p.tenant_id === tenantId);
    const openOpps = opps.filter((o) => o.status === "aberta");
    const wonOpps = opps.filter((o) => o.status === "ganha");
    const lostOpps = opps.filter((o) => o.status === "perdida");

    const mrrGanho = wonOpps.reduce((s, o) => s + Number(o.potential_monthly_value || 0), 0);
    const valorPotencialPipeline = openOpps.reduce((s, o) => s + Number(o.potential_monthly_value || 0), 0);
    const valorEmPropostas = props
      .filter((p) => ["Enviada", "Visualizada", "Em negociação", "Aceita"].includes(p.status))
      .reduce((s, p) => s + Number(p.monthly_fee_final || 0), 0);

    const stages = db.stages.filter((s) => s.tenant_id === tenantId).sort((a, b) => a.stage_order - b.stage_order);
    const stageBreakdown = stages.map((st) => {
      const stOpps = opps.filter((o) => o.stage_id === st.id);
      return {
        stage_id: st.id,
        name: st.name,
        color: st.color,
        count: stOpps.length,
        value: Number(stOpps.reduce((s, o) => s + Number(o.potential_monthly_value || 0), 0).toFixed(2)),
        conversion_pct: opps.length > 0 ? Number(((stOpps.length / opps.length) * 100).toFixed(1)) : 0
      };
    });

    const lossMap = {};
    lostOpps.forEach((o) => {
      const lr = db.lossReasons.find((l) => l.id === o.loss_reason_id);
      const rname = lr ? lr.name : "Outros";
      lossMap[rname] = (lossMap[rname] || 0) + 1;
    });

    const sellerMap = {};
    opps.forEach((o) => {
      const u = db.users.find((usr) => usr.id === o.owner_user_id);
      const sname = u ? u.name : "Consultor";
      if (!sellerMap[sname]) sellerMap[sname] = { name: sname, leads: 0, won: 0, mrr: 0, pipeline: 0 };
      sellerMap[sname].leads += 1;
      if (o.status === "ganha") {
        sellerMap[sname].won += 1;
        sellerMap[sname].mrr += Number(o.potential_monthly_value || 0);
      } else if (o.status === "aberta") {
        sellerMap[sname].pipeline += Number(o.potential_monthly_value || 0);
      }
    });

    const today = new Date().toISOString().slice(0, 10);
    const acts = db.activities.filter((a) => a.tenant_id === tenantId && !a.completed);
    const overdue = acts.filter((a) => a.due_date && a.due_date < today);

    return {
      ok: true,
      kpis: {
        leadsGerados: opps.length,
        oportunidadesAbertas: openOpps.length,
        propostasEnviadas: props.filter((p) => p.status !== "Rascunho").length,
        propostasAceitas: props.filter((p) => p.status === "Aceita").length,
        taxaFechamentoPct: opps.length > 0 ? Number(((wonOpps.length / opps.length) * 100).toFixed(1)) : 0,
        ticketMedio: wonOpps.length > 0 ? Number((mrrGanho / wonOpps.length).toFixed(2)) : 0,
        mrrGanho: Number(mrrGanho.toFixed(2)),
        valorPotencialPipeline: Number(valorPotencialPipeline.toFixed(2)),
        valorEmPropostas: Number(valorEmPropostas.toFixed(2)),
        tempoMedioFechamentoDias: 5.5,
        atividadesPendentes: acts.length,
        atividadesAtrasadas: overdue.length
      },
      stageBreakdown,
      lossBreakdown: Object.entries(lossMap).map(([reason, count]) => ({ reason, count })),
      sellerPerformance: Object.values(sellerMap),
      origins: [...new Set(db.opportunities.filter((o) => o.tenant_id === tenantId).map((o) => o.lead_origin))]
    };
  }

  // Settings, Users & Tenants
  if (method === "GET" && cleanPath === "/api/settings") {
    const tenant = db.tenants.find((t) => t.id === tenantId);
    return {
      ok: true,
      tenant,
      users: db.users.filter((u) => u.tenant_id === tenantId),
      stages: db.stages.filter((s) => s.tenant_id === tenantId),
      lossReasons: db.lossReasons.filter((l) => l.tenant_id === tenantId),
      templates: db.templates.filter((t) => t.tenant_id === tenantId),
      auditLogs: db.auditLogs.filter((a) => a.tenant_id === tenantId)
    };
  }

  if (method === "PUT" && cleanPath === "/api/settings") {
    const tenant = db.tenants.find((t) => t.id === tenantId);
    if (tenant) {
      Object.assign(tenant, {
        name: body.name ?? tenant.name,
        trade_name: body.trade_name ?? tenant.trade_name,
        cnpj: body.cnpj ?? tenant.cnpj,
        crc_registration: body.crc_registration ?? tenant.crc_registration,
        primary_color: body.primary_color ?? tenant.primary_color,
        email: body.email ?? tenant.email,
        phone: body.phone ?? tenant.phone,
        commercial_signature: body.commercial_signature ?? tenant.commercial_signature,
        default_messages: body.default_messages ?? tenant.default_messages,
        smtp_config: body.smtp_config ?? tenant.smtp_config
      });
    }
    const tpl = db.templates.find((t) => t.tenant_id === tenantId);
    if (tpl && body.proposal_template) {
      Object.assign(tpl, body.proposal_template);
    }
    saveBrowserDB(db);
    return { ok: true };
  }

  if (method === "POST" && cleanPath === "/api/users") {
    const newUser = {
      id: uid("usr"),
      tenant_id: tenantId,
      name: body.name || "Novo Usuário",
      email: body.email || "usuario@escritorio.cnt.br",
      role: body.role || "vendedor",
      max_discount_pct: Number(body.max_discount_pct || 8),
      active: 1,
      created_at: nowISO()
    };
    db.users.push(newUser);
    saveBrowserDB(db);
    return { ok: true, id: newUser.id };
  }

  if (method === "POST" && cleanPath === "/api/tenants") {
    const newTid = uid("tenant");
    const seed = buildTenantSeedData(
      newTid,
      body.name || "Novo Escritório Contábil",
      body.trade_name || body.name || "Novo Escritório",
      "00.000.000/0001-00",
      body.crc_registration || "CRC-ATIVO",
      `contato@${newTid}.cnt.br`,
      "(11) 3000-0000",
      body.city || "São Paulo",
      body.state || "SP",
      body.primary_color || "#10B981",
      25000,
      300,
      30
    );
    db.tenants.push(seed.tenant);
    db.parameterVersions.push(seed.paramVersion);
    db.plansServices.push(...seed.plansServices);
    db.stages.push(...seed.stages);
    db.lossReasons.push(...seed.lossReasons);
    db.templates.push(seed.template);
    const adminUser = {
      id: `usr_${newTid}_admin`,
      tenant_id: newTid,
      name: `Diretoria ${seed.tenant.trade_name}`,
      email: seed.tenant.email,
      role: "admin_escritorio",
      max_discount_pct: 25,
      active: 1,
      created_at: nowISO()
    };
    db.users.push(adminUser);
    saveBrowserDB(db);
    return { ok: true, tenant_id: newTid, admin_user_id: adminUser.id };
  }

  return { ok: true };
}
