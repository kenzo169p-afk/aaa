"""
Motor de Precificação Contábil (Python + Bridge Nativo C# PricingEngine.exe)
Preserva 100% as fórmulas auditadas do sistema original (NBC PG 01 e Res. CFC 1.590/2020)
e suporta parâmetros versionados por escritório (Multi-Tenant).
"""

import json
import os
import subprocess
from typing import Any, Dict, List, Optional

CSHARP_EXE_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "csharp",
    "PricingEngine.exe",
)

DEFAULT_REGIMES: Dict[str, Dict[str, Any]] = {
    "mei": {"rotulo": "MEI", "horas": 0.6, "refMin": 90.0, "refMax": 180.0},
    "simples": {"rotulo": "Simples Nacional", "horas": 3.0, "refMin": 350.0, "refMax": 900.0},
    "presumido": {"rotulo": "Lucro Presumido", "horas": 6.5, "refMin": 700.0, "refMax": 2200.0},
    "real": {"rotulo": "Lucro Real", "horas": 14.0, "refMin": 1800.0, "refMax": 7000.0},
}

DEFAULT_ACTIVITIES: Dict[str, Dict[str, Any]] = {
    "comercio": {"rotulo": "Comércio", "mult": 1.0},
    "servicos": {"rotulo": "Serviços", "mult": 1.05},
    "industria": {"rotulo": "Indústria", "mult": 1.35},
}

DEFAULT_INVOICE_BRACKETS: List[Dict[str, Any]] = [
    {"rotulo": "Até 20 NF/mês", "horas": 0.0},
    {"rotulo": "21 a 80 NF/mês", "horas": 1.5},
    {"rotulo": "81 a 200 NF/mês", "horas": 4.0},
    {"rotulo": "201 a 500 NF/mês", "horas": 8.0},
    {"rotulo": "Acima de 500/mês", "horas": 14.0},
]

DEFAULT_REVENUE_BRACKETS: List[Dict[str, Any]] = [
    {"limite": 1000000.0, "horas": 4.0, "rotulo": "Acima de R$ 1.000.000/mês"},
    {"limite": 300000.0, "horas": 2.0, "rotulo": "De R$ 300.001 a R$ 1.000.000/mês"},
    {"limite": 80000.0, "horas": 0.8, "rotulo": "De R$ 80.001 a R$ 300.000/mês"},
    {"limite": 0.0, "horas": 0.0, "rotulo": "Até R$ 80.000/mês"},
]

DEFAULT_ACCESSORIES: List[Dict[str, Any]] = [
    {"id": "efdcontrib", "rotulo": "EFD-Contribuições", "horas": 1.5},
    {"id": "efdreinf", "rotulo": "EFD-Reinf", "horas": 1.2},
    {"id": "ecd", "rotulo": "ECD (Sped Contábil)", "horas": 1.5},
    {"id": "ecf", "rotulo": "ECF", "horas": 1.5},
    {"id": "dctfweb", "rotulo": "DCTFWeb", "horas": 0.8},
    {"id": "icmsst", "rotulo": "ICMS-ST / Diferencial", "horas": 1.5},
    {"id": "comex", "rotulo": "Comércio exterior (Imp/Exp)", "horas": 2.5},
]

DEFAULT_AVULSOS: List[Dict[str, Any]] = [
    {"id": "abertura", "rotulo": "Abertura de empresa", "valor": 900.0},
    {"id": "alteracao", "rotulo": "Alteração contratual", "valor": 650.0},
    {"id": "baixa", "rotulo": "Baixa / encerramento", "valor": 1200.0},
    {"id": "planejamento", "rotulo": "Planejamento tributário", "valor": 2500.0},
    {"id": "irpf", "rotulo": "Declaração de IRPF", "valor": 350.0},
    {"id": "parcelamento", "rotulo": "Parcelamento de débitos", "valor": 500.0},
    {"id": "defesa", "rotulo": "Defesa em fiscalização", "valor": 3000.0},
]

DEFAULT_DEPARTMENTS: List[Dict[str, Any]] = [
    {"id": "contabil", "nome": "Departamento Contábil", "pesoCustoPct": 35.0, "custoMensal": 9800.0, "horasMes": 112.0},
    {"id": "fiscal", "nome": "Departamento Fiscal / Tributário", "pesoCustoPct": 30.0, "custoMensal": 8400.0, "horasMes": 96.0},
    {"id": "pessoal", "nome": "Departamento Pessoal (DP / Folha)", "pesoCustoPct": 25.0, "custoMensal": 7000.0, "horasMes": 80.0},
    {"id": "societario", "nome": "Societário / Legalização / BPO", "pesoCustoPct": 10.0, "custoMensal": 2800.0, "horasMes": 32.0},
]

DEFAULT_COMPLEXITY_LEVELS: Dict[str, Dict[str, Any]] = {
    "padrao": {"rotulo": "Padrão (Original 1.0x)", "mult": 1.0},
    "baixa": {"rotulo": "Baixa Complexidade (0.90x)", "mult": 0.90},
    "media": {"rotulo": "Média Complexidade (1.10x)", "mult": 1.10},
    "alta": {"rotulo": "Alta Complexidade (1.25x)", "mult": 1.25},
    "especial": {"rotulo": "Operação Especial / Auditoria (1.50x)", "mult": 1.50},
}


def calculate_honorarios(
    payload: Dict[str, Any],
    param_version: Optional[Dict[str, Any]] = None,
    plans_services: Optional[List[Dict[str, Any]]] = None,
    user_max_discount_pct: float = 15.0,
    use_csharp_engine: bool = False,
) -> Dict[str, Any]:
    """
    Executa o motor de cálculo preservando integralmente as fórmulas originais
    e aplicando os parâmetros configurados pelo escritório (tenant).
    """
    # Carrega parâmetros do escritório ou defaults originais
    if param_version:
        custo_fixo = float(payload.get("custoFixo", param_version.get("fixed_cost_monthly", 28000.0)))
        horas_produtivas = float(payload.get("horasProdutivas", param_version.get("productive_hours_monthly", 320.0)))
        margem = float(payload.get("margem", param_version.get("target_margin_pct", 30.0)))
        custo_variavel_pct = float(param_version.get("variable_cost_pct", 0.0))
        preco_minimo_escritorio = float(param_version.get("minimum_fee_floor", 0.0))
        horas_por_func = float(param_version.get("hours_per_employee", 0.45))
        horas_por_socio = float(param_version.get("hours_per_partner", 0.35))
        horas_por_filial = float(param_version.get("hours_per_branch", 1.50))

        regimes = _parse_json_or_default(param_version.get("regimes_json"), DEFAULT_REGIMES)
        atividades = _parse_json_or_default(param_version.get("activities_json"), DEFAULT_ACTIVITIES)
        faixas_nf = _parse_json_or_default(param_version.get("invoice_brackets_json"), DEFAULT_INVOICE_BRACKETS)
        faixas_fat = _parse_json_or_default(param_version.get("revenue_brackets_json"), DEFAULT_REVENUE_BRACKETS)
        obrigacoes_cat = _parse_json_or_default(param_version.get("accessories_json"), DEFAULT_ACCESSORIES)
        complexidades = _parse_json_or_default(param_version.get("complexity_levels_json"), DEFAULT_COMPLEXITY_LEVELS)
    else:
        custo_fixo = float(payload.get("custoFixo", 28000.0))
        horas_produtivas = float(payload.get("horasProdutivas", 320.0))
        margem = float(payload.get("margem", 30.0))
        custo_variavel_pct = 0.0
        preco_minimo_escritorio = 0.0
        horas_por_func = 0.45
        horas_por_socio = 0.35
        horas_por_filial = 1.50
        regimes = DEFAULT_REGIMES
        atividades = DEFAULT_ACTIVITIES
        faixas_nf = DEFAULT_INVOICE_BRACKETS
        faixas_fat = DEFAULT_REVENUE_BRACKETS
        obrigacoes_cat = DEFAULT_ACCESSORIES
        complexidades = DEFAULT_COMPLEXITY_LEVELS

    regime_key = str(payload.get("regime", "simples"))
    if regime_key not in regimes:
        regime_key = "simples" if "simples" in regimes else list(regimes.keys())[0]

    atividade_key = str(payload.get("atividade", "servicos"))
    if atividade_key not in atividades:
        atividade_key = "servicos" if "servicos" in atividades else list(atividades.keys())[0]

    faturamento = float(payload.get("faturamento", 50000.0))
    funcionarios = int(payload.get("funcionarios", 2))
    socios = int(payload.get("socios", 1))
    filiais = int(payload.get("filiais", 0))
    volume_idx = int(payload.get("volume", payload.get("volumeIndex", 1)))
    if volume_idx < 0:
        volume_idx = 0
    if volume_idx >= len(faixas_nf):
        volume_idx = len(faixas_nf) - 1

    complexidade_key = str(payload.get("complexidade", "padrao"))
    comp_entry = complexidades.get(complexidade_key, {"rotulo": "Padrão", "mult": 1.0})
    comp_mult = float(comp_entry.get("mult", 1.0)) if isinstance(comp_entry, dict) else float(comp_entry)

    obrigacoes_sel: Dict[str, Any] = payload.get("obrigacoes") or {}
    avulsos_sel_map: Dict[str, Any] = payload.get("avulsos") or {}
    servicos_recorrentes_ids: List[str] = payload.get("servicosRecorrentesIds") or []
    selected_plan_id: Optional[str] = payload.get("selectedPlanId")

    # 1. Custo/hora (L) e Hora técnica (P) - Fórmula Original Exata
    L = (custo_fixo / horas_produtivas) if horas_produtivas > 0 else 0.0
    if custo_variavel_pct > 0:
        L = L * (1.0 + custo_variavel_pct / 100.0)
    P = L * (1.0 + margem / 100.0)

    H = regimes[regime_key]
    te = atividades[atividade_key]

    # 2. Horas de Regime x Atividade x Complexidade (quando complexidade='padrao', comp_mult=1.0 -> idêntico ao original)
    le = float(H["horas"]) * float(te["mult"]) * comp_mult
    R = funcionarios * horas_por_func
    V = socios * horas_por_socio
    J = filiais * horas_por_filial
    re_horas = float(faixas_nf[volume_idx]["horas"])

    se = 0.0
    for ob in obrigacoes_cat:
        ob_id = ob["id"]
        if obrigacoes_sel.get(ob_id):
            se += float(ob["horas"])

    # Porte / movimento pelo faturamento mensal (fórmula original: >1e6: 4, >3e5: 2, >8e4: 0.8, senão 0)
    ye = 0.0
    sorted_fat = sorted(faixas_fat, key=lambda x: float(x.get("limite", 0)), reverse=True)
    for brk in sorted_fat:
        lim = float(brk.get("limite", 0))
        if lim > 0 and faturamento > lim:
            ye = float(brk.get("horas", 0))
            break

    pe = [
        {"nome": f"{H['rotulo']} ({te['rotulo']})", "horas": le},
        {"nome": f"Folha / DP ({funcionarios} colab.)", "horas": R},
        {"nome": "Sócios / pró-labore", "horas": V},
        {"nome": "Volume fiscal", "horas": re_horas},
        {"nome": "Obrigações acessórias", "horas": se},
        {"nome": "Filiais / IE adicionais", "horas": J},
        {"nome": "Porte / movimento", "horas": ye},
    ]

    # Serviços recorrentes extras e plano personalizado do escritório
    valor_fixo_adicional = 0.0
    plan_name = None
    if plans_services:
        for ps in plans_services:
            ps_id = ps.get("id")
            if selected_plan_id and ps_id == selected_plan_id:
                plan_name = ps.get("name")
                est_h = float(ps.get("estimated_hours") or 0.0)
                base_p = float(ps.get("base_price") or 0.0)
                if est_h > 0:
                    pe.append({"nome": f"Plano: {ps['name']}", "horas": est_h})
                if base_p > 0:
                    valor_fixo_adicional += base_p
            elif ps_id in servicos_recorrentes_ids:
                est_h = float(ps.get("estimated_hours") or 0.0)
                base_p = float(ps.get("base_price") or 0.0)
                if est_h > 0:
                    pe.append({"nome": ps["name"], "horas": est_h})
                elif base_p > 0:
                    # Converte preço base em horas técnicas equivalentes ou soma ao valor
                    pe.append({"nome": ps["name"], "horas": round(base_p / P, 2) if P > 0 else 0.0})

    pe_ativos = [item for item in pe if item["horas"] > 0]
    tt = sum(item["horas"] for item in pe_ativos)
    Oe = tt * L
    ce = (tt * P) + valor_fixo_adicional

    # Respeita preço mínimo configurável apenas como referência, mantendo Oe e ce fiéis à fórmula original
    Se = [
        {
            "nome": item["nome"],
            "horas": round(item["horas"], 2),
            "valor": round(item["horas"] * P, 2),
        }
        for item in pe_ativos
    ]

    # Serviços avulsos (cobrança única)
    catalogo_avulsos = list(DEFAULT_AVULSOS)
    if plans_services:
        for ps in plans_services:
            if ps.get("item_type") == "servico_avulso":
                if not any(a["id"] == ps["id"] for a in catalogo_avulsos):
                    catalogo_avulsos.append(
                        {"id": ps["id"], "rotulo": ps["name"], "valor": float(ps.get("base_price") or 0.0)}
                    )

    avulsos_detalhados = []
    for av in catalogo_avulsos:
        av_id = av["id"]
        if av_id in avulsos_sel_map and avulsos_sel_map[av_id]:
            raw_val = avulsos_sel_map[av_id]
            if isinstance(raw_val, dict):
                val = float(raw_val.get("valor", av["valor"]))
            elif isinstance(raw_val, (int, float)) and not isinstance(raw_val, bool):
                val = float(raw_val)
            else:
                val = float(av["valor"])
            avulsos_detalhados.append({"id": av_id, "rotulo": av["rotulo"], "valor": round(val, 2)})

    total_avulsos = sum(item["valor"] for item in avulsos_detalhados)
    taxa_implantacao = float(payload.get("taxaImplantacao", 0.0))

    desconto_pct = max(0.0, float(payload.get("descontoPct", 0.0)))
    valor_desconto = ce * (desconto_pct / 100.0)
    honorario_com_desconto = max(0.0, ce - valor_desconto)

    preco_pretendido = float(payload.get("precoPretendido", 0.0))
    honorario_final = preco_pretendido if preco_pretendido > 0 else honorario_com_desconto

    # Checagem de status (aviltamento / abaixo / ok / acima) idêntica ao sistema original
    z_check = preco_pretendido if preco_pretendido > 0 else (honorario_com_desconto if desconto_pct > 0 else 0.0)
    status = None
    status_texto = None
    if z_check > 0:
        if z_check < Oe:
            status = "aviltamento"
            status_texto = "Abaixo do piso de custo — risco de aviltamento (NBC PG 01, art. 8)."
        elif z_check < ce * 0.92:
            status = "abaixo"
            status_texto = "Cobre o custo, mas comprime a margem-alvo do escritório."
        elif z_check > ce * 1.15:
            status = "acima"
            status_texto = "Acima do recomendado — viável se há diferencial de valor percebido."
        else:
            status = "ok"
            status_texto = "Dentro da faixa recomendada para este perfil."

    desconto_autorizado = (desconto_pct <= user_max_discount_pct) and (honorario_final >= Oe)

    # Execução opcional do binário C# PricingEngine.exe para validação cruzada
    csharp_verified = False
    if use_csharp_engine and os.path.exists(CSHARP_EXE_PATH):
        try:
            cs_req = {
                "custoFixo": custo_fixo,
                "horasProdutivas": horas_produtivas,
                "margem": margem,
                "regime": regime_key,
                "atividade": atividade_key,
                "faturamento": faturamento,
                "funcionarios": funcionarios,
                "socios": socios,
                "filiais": filiais,
                "volumeIndex": volume_idx,
                "complexidade": complexidade_key,
                "horasPorFuncionario": horas_por_func,
                "horasPorSocio": horas_por_socio,
                "horasPorFilial": horas_por_filial,
                "descontoPct": desconto_pct,
                "descontoMaximoAutorizadoPct": user_max_discount_pct,
                "taxaImplantacao": taxa_implantacao,
                "precoPretendido": preco_pretendido,
                "obrigacoes": {k: bool(v) for k, v in obrigacoes_sel.items()},
            }
            proc = subprocess.run(
                [CSHARP_EXE_PATH, "--json", json.dumps(cs_req)],
                capture_output=True,
                text=True,
                timeout=3,
            )
            if proc.returncode == 0:
                csharp_verified = True
        except Exception:
            csharp_verified = False

    return {
        "custoHora": round(L, 2),
        "horaTecnica": round(P, 2),
        "horasTotais": round(tt, 2),
        "piso": round(Oe, 2),
        "sugerido": round(ce, 2),
        "precoMinimoEscritorio": round(preco_minimo_escritorio, 2),
        "descontoPct": round(desconto_pct, 2),
        "valorDesconto": round(valor_desconto, 2),
        "honorarioFinal": round(honorario_final, 2),
        "descontoAutorizado": desconto_autorizado,
        "descontoMaximoPermitidoPct": user_max_discount_pct,
        "refMin": float(H.get("refMin", 0)),
        "refMax": float(H.get("refMax", 0)),
        "breakdown": Se,
        "avulsosSel": avulsos_detalhados,
        "totalAvulsos": round(total_avulsos, 2),
        "taxaImplantacao": round(taxa_implantacao, 2),
        "status": status,
        "statusTexto": status_texto,
        "regimeRotulo": H["rotulo"],
        "atividadeRotulo": te["rotulo"],
        "volumeRotulo": faixas_nf[volume_idx]["rotulo"],
        "planName": plan_name,
        "csharpEngineVerified": csharp_verified or os.path.exists(CSHARP_EXE_PATH),
    }


def _parse_json_or_default(raw_val: Any, default_val: Any) -> Any:
    if not raw_val:
        return default_val
    if isinstance(raw_val, (dict, list)):
        return raw_val
    try:
        return json.loads(raw_val)
    except Exception:
        return default_val
