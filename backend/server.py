"""
Servidor Principal SaaS Multi-Tenant (Python HTTP/REST API + Servico de Propostas Publicas & PDF)
Integra:
1. Parametros Versionados por Escritorio
2. Calculadora de Honorarios (NBC PG 01 / Res. CFC 1.590/2020 + Motor C# PricingEngine.exe)
3. Propostas Comerciais (Editor, Modelos, Versoes, PDF, Envio E-mail/WhatsApp, Links Exclusivos e Aceite)
4. CRM de Vendas Contabil (Pipeline Kanban, Leads/Oportunidades, Diagnostico, Atividades, Motivos de Perda e Indicadores)
5. Configuracoes Multi-Tenant, RBAC, LGPD e Auditoria
"""

import json
import mimetypes
import os
import secrets
import smtplib
import sys
from datetime import datetime, timedelta
from email.message import EmailMessage
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlparse

# Garante importacao do pacote backend
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from backend.database import (
    create_auth_token,
    get_connection,
    hash_password,
    init_db,
    log_audit,
    seed_tenant_defaults,
    verify_auth_token,
    verify_password,
)
from backend.pricing_engine import calculate_honorarios

FRONTEND_DIR = os.path.join(ROOT_DIR, "frontend")


def row_to_dict(row: Any) -> Dict[str, Any]:
    if row is None:
        return {}
    return dict(row)


def rows_to_list(rows: List[Any]) -> List[Dict[str, Any]]:
    return [dict(r) for r in rows]


def parse_json_field(val: Any, default: Any) -> Any:
    if val is None or val == "":
        return default
    if isinstance(val, (dict, list)):
        return val
    try:
        return json.loads(val)
    except Exception:
        return default


def get_stage_by_slug(conn: Any, tenant_id: str, slug: str) -> Optional[Dict[str, Any]]:
    row = conn.execute(
        "SELECT * FROM pipeline_stages WHERE tenant_id = ? AND slug = ? LIMIT 1",
        (tenant_id, slug),
    ).fetchone()
    return dict(row) if row else None


def move_opportunity_stage_internal(
    conn: Any,
    tenant_id: str,
    opportunity_id: str,
    target_stage_id: str,
    user_id: Optional[str],
    notes: str = "",
    loss_reason_id: Optional[str] = None,
    potential_value: Optional[float] = None,
) -> None:
    opp = conn.execute(
        "SELECT * FROM opportunities WHERE id = ? AND tenant_id = ?",
        (opportunity_id, tenant_id),
    ).fetchone()
    if not opp:
        return

    stage = conn.execute(
        "SELECT * FROM pipeline_stages WHERE id = ? AND tenant_id = ?",
        (target_stage_id, tenant_id),
    ).fetchone()
    if not stage:
        return

    old_stage_id = opp["stage_id"]
    new_status = "aberta"
    won_at = opp["won_at"]
    lost_at = opp["lost_at"]

    if stage["is_won"]:
        new_status = "ganha"
        won_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    elif stage["is_lost"]:
        new_status = "perdida"
        lost_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    val_to_set = potential_value if potential_value is not None else opp["potential_monthly_value"]

    conn.execute(
        """
        UPDATE opportunities
        SET stage_id = ?,
            status = ?,
            potential_monthly_value = ?,
            loss_reason_id = COALESCE(?, loss_reason_id),
            won_at = ?,
            lost_at = ?,
            updated_at = datetime('now')
        WHERE id = ? AND tenant_id = ?
        """,
        (
            target_stage_id,
            new_status,
            val_to_set,
            loss_reason_id,
            won_at,
            lost_at,
            opportunity_id,
            tenant_id,
        ),
    )

    if old_stage_id != target_stage_id:
        hist_id = f"osh_{secrets.token_hex(6)}"
        conn.execute(
            """
            INSERT INTO opportunity_stage_history (id, tenant_id, opportunity_id, from_stage_id, to_stage_id, changed_by_user_id, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (hist_id, tenant_id, opportunity_id, old_stage_id, target_stage_id, user_id, notes),
        )


def render_public_proposal_html(proposal: Dict[str, Any], tenant: Dict[str, Any], events: List[Dict[str, Any]]) -> str:
    """
    Gera a pagina publica / PDF profissional da proposta comercial com identidade visual do escritorio,
    escopo tecnico conforme Res. CFC 1.590/2020 e formulario de Aceite Comercial.
    """
    primary = tenant.get("primary_color") or "#C9A227"
    services = parse_json_field(proposal.get("services_summary_json"), [])
    avulsos = parse_json_field(proposal.get("one_off_services_json"), [])

    services_rows = ""
    for item in services:
        nome = item.get("nome", "Serviço Contábil")
        horas = float(item.get("horas", 0))
        valor = float(item.get("valor", 0))
        services_rows += f"""
        <tr>
            <td>{nome}</td>
            <td style="text-align:center">{horas:.1f} h/mês</td>
            <td style="text-align:right;font-weight:600">R$ {valor:,.2f}</td>
        </tr>
        """

    avulsos_html = ""
    if avulsos:
        rows_av = "".join(
            f"<tr><td>{a.get('rotulo', a.get('nome', 'Serviço'))}</td><td style='text-align:right;font-weight:600'>R$ {float(a.get('valor', 0)):,.2f}</td></tr>"
            for a in avulsos
        )
        avulsos_html = f"""
        <div class="section">
            <h3>Serviços Pontuais / Avulsos (Cobrança Única)</h3>
            <table class="table">
                <thead><tr><th>Descrição do Serviço</th><th style="text-align:right">Investimento Único</th></tr></thead>
                <tbody>{rows_av}</tbody>
            </table>
        </div>
        """

    status = proposal.get("status", "Enviada")
    is_accepted = status == "Aceita"
    is_rejected = status in ("Recusada", "Cancelada", "Expirada")

    acceptance_block = ""
    if is_accepted:
        acceptance_block = f"""
        <div class="accepted-banner">
            <h3>✓ Aceite Comercial Registrado</h3>
            <p><strong>Responsável:</strong> {proposal.get('accepted_by_name')} ({proposal.get('accepted_by_role') or 'Representante Legal'})</p>
            <p><strong>CPF/Documento:</strong> {proposal.get('accepted_by_document')} · <strong>E-mail:</strong> {proposal.get('accepted_by_email') or '-'}</p>
            <p><strong>Data/Hora do Aceite:</strong> {proposal.get('accepted_at')} · <strong>Versão Aceita:</strong> v{proposal.get('accepted_version') or proposal.get('current_version')} · <strong>IP:</strong> {proposal.get('accepted_ip') or 'Registrado'}</p>
        </div>
        """
    elif not is_rejected:
        acceptance_block = f"""
        <div class="accept-box no-print" id="accept-section">
            <h3>Formalizar Aceite Comercial desta Proposta</h3>
            <p style="font-size:13px;color:#9AA6B8;margin-bottom:14px">
                Preencha os dados do responsável abaixo para aprovar comercialmente esta proposta (Versão v{proposal.get('current_version', 1)}).
            </p>
            <form id="accept-form" onsubmit="submitAccept(event)">
                <div class="form-grid">
                    <div>
                        <label>Nome Completo do Responsável *</label>
                        <input type="text" id="acc_name" required value="{proposal.get('client_name', '')}" />
                    </div>
                    <div>
                        <label>CPF ou CNPJ do Responsável *</label>
                        <input type="text" id="acc_doc" required placeholder="000.000.000-00" value="{proposal.get('cpf_cnpj', '')}" />
                    </div>
                    <div>
                        <label>Cargo / Função na Empresa</label>
                        <input type="text" id="acc_role" value="Sócio-Administrador" />
                    </div>
                    <div>
                        <label>E-mail Corporativo *</label>
                        <input type="email" id="acc_email" required value="{proposal.get('contact_email', '')}" />
                    </div>
                </div>
                <label class="checkbox-line">
                    <input type="checkbox" id="acc_terms" required />
                    <span>Concordo com os valores, condições de pagamento e escopo descritos nesta Proposta Comercial #{proposal.get('proposal_number')} (v{proposal.get('current_version', 1)}). Estou ciente de que este aceite comercial dá início à elaboração do Contrato de Prestação de Serviços Contábeis (Res. CFC 1.590/2020), não substituindo automaticamente sua assinatura eletrônica.</span>
                </label>
                <div class="btn-row">
                    <button type="submit" class="btn-accept" id="btn-submit-accept">✓ CONFIRMAR ACEITE COMERCIAL</button>
                    <button type="button" class="btn-reject" onclick="submitReject()">Solicitar Revisão / Recusar</button>
                </div>
                <div id="accept-feedback" style="margin-top:12px;font-size:13px"></div>
            </form>
        </div>
        """

    return f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Proposta {proposal.get('proposal_number')} — {tenant.get('trade_name') or tenant.get('name')}</title>
    <link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {{
            --primary: {primary};
            --bg: #0A0F1C;
            --card: #0E1626;
            --card2: #121C30;
            --line: #243049;
            --text: #EAE3CF;
            --muted: #9AA6B8;
        }}
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        body {{ font-family: 'DM Sans', system-ui, sans-serif; background: var(--bg); color: var(--text); padding: 28px 16px 60px; line-height: 1.55; }}
        .wrapper {{ max-width: 900px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; }}
        .top-actions {{ display: flex; justify-content: space-between; align-items: center; background: var(--card); border: 1px solid var(--line); padding: 12px 18px; border-radius: 12px; }}
        .btn-print {{ background: var(--primary); color: #1a1408; border: 0; border-radius: 8px; padding: 9px 16px; font-weight: 700; cursor: pointer; font-family: inherit; }}
        .doc {{ background: var(--card); border: 1px solid var(--line); border-radius: 18px; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,0.45); }}
        .cover {{ padding: 36px 36px 28px; background: linear-gradient(135deg, rgba(201,162,39,0.14), rgba(14,22,38,0.95)); border-bottom: 1px solid var(--line); }}
        .badge {{ display: inline-block; padding: 5px 12px; border-radius: 999px; background: var(--primary); color: #1a1408; font-weight: 700; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 12px; }}
        .cover h1 {{ font-family: 'Syne', sans-serif; font-size: 26px; margin-bottom: 8px; }}
        .meta-grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-top: 20px; padding-top: 18px; border-top: 1px solid var(--line); font-size: 13px; }}
        .meta-grid div span {{ display: block; font-size: 11px; color: var(--muted); text-transform: uppercase; }}
        .section {{ padding: 24px 36px; border-bottom: 1px solid var(--line); }}
        .section h3 {{ font-family: 'Syne', sans-serif; font-size: 16px; color: var(--primary); margin-bottom: 10px; }}
        .section p {{ font-size: 14px; color: #D4DCEA; white-space: pre-line; }}
        .table {{ width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13.5px; }}
        .table th, .table td {{ padding: 10px 12px; border-bottom: 1px solid var(--line); text-align: left; }}
        .table th {{ color: var(--muted); font-size: 11.5px; text-transform: uppercase; background: var(--card2); }}
        .inv-cards {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; margin-top: 12px; }}
        .inv-card {{ background: var(--card2); border: 1px solid var(--line); border-radius: 12px; padding: 16px; }}
        .inv-card.highlight {{ border-color: var(--primary); background: rgba(201,162,39,0.08); }}
        .inv-card span {{ font-size: 11.5px; color: var(--muted); display: block; }}
        .inv-card strong {{ font-family: 'Syne', sans-serif; font-size: 24px; color: var(--primary); display: block; margin-top: 4px; }}
        .accept-box {{ padding: 28px 36px; background: var(--card2); }}
        .accept-box h3 {{ font-family: 'Syne', sans-serif; margin-bottom: 6px; color: var(--primary); }}
        .form-grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }}
        .form-grid label {{ display: block; font-size: 12px; color: var(--muted); margin-bottom: 5px; }}
        .form-grid input {{ width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--bg); color: var(--text); font-family: inherit; }}
        .checkbox-line {{ display: flex; gap: 10px; align-items: flex-start; font-size: 12.5px; color: #D4DCEA; margin: 14px 0 18px; cursor: pointer; }}
        .checkbox-line input {{ margin-top: 3px; }}
        .btn-row {{ display: flex; gap: 12px; flex-wrap: wrap; }}
        .btn-accept {{ background: #4FB477; color: #081c10; border: 0; border-radius: 10px; padding: 12px 22px; font-weight: 700; cursor: pointer; font-family: inherit; font-size: 14px; }}
        .btn-reject {{ background: transparent; color: #E5544B; border: 1px solid #E5544B; border-radius: 10px; padding: 12px 18px; font-weight: 600; cursor: pointer; font-family: inherit; font-size: 13px; }}
        .accepted-banner {{ margin: 24px 36px; padding: 20px; border-radius: 12px; background: rgba(79,180,119,0.12); border: 1px solid #4FB477; }}
        .accepted-banner h3 {{ color: #4FB477; margin-bottom: 8px; }}
        .sig-footer {{ padding: 20px 36px; font-size: 12px; color: var(--muted); text-align: center; background: var(--bg); }}
        @media print {{
            body {{ background: #fff; color: #111; padding: 0; }}
            .doc {{ box-shadow: none; border: 1px solid #ccc; background: #fff; color: #111; }}
            .section p, .table td, .table th {{ color: #111; }}
            .no-print {{ display: none !important; }}
        }}
    </style>
</head>
<body>
    <div class="wrapper">
        <div class="top-actions no-print">
            <div>
                <strong>{tenant.get('trade_name') or tenant.get('name')}</strong>
                <span style="font-size:12px;color:var(--muted);margin-left:8px">Proposta #{proposal.get('proposal_number')} · Versão v{proposal.get('current_version', 1)}</span>
            </div>
            <button class="btn-print" onclick="window.print()">🖨️ Baixar / Imprimir PDF Profissional</button>
        </div>

        <div class="doc">
            <div class="cover">
                <span class="badge">Status: {status} · v{proposal.get('current_version', 1)}</span>
                <h1>{proposal.get('cover_title') or 'Proposta Técnica e Comercial de Assessoria Contábil'}</h1>
                <p style="color:var(--muted);font-size:14px">Elaborada exclusivamente para <strong>{proposal.get('company_name')}</strong></p>
                <div class="meta-grid">
                    <div><span>Cliente / Empresa</span><strong>{proposal.get('company_name')}</strong> ({proposal.get('cpf_cnpj') or 'Em abertura'})</div>
                    <div><span>A/C Responsável</span><strong>{proposal.get('client_name')}</strong></div>
                    <div><span>Escritório Contábil</span><strong>{tenant.get('trade_name') or tenant.get('name')}</strong> ({tenant.get('crc_registration') or 'CRC Ativo'})</div>
                    <div><span>Validade da Proposta</span><strong>{proposal.get('valid_until')}</strong></div>
                </div>
            </div>

            <div class="section">
                <h3>1. Apresentação do Escritório</h3>
                <p>{proposal.get('office_presentation') or ''}</p>
            </div>

            <div class="section">
                <h3>2. Diferenciais do Atendimento</h3>
                <p>{proposal.get('differentials_text') or ''}</p>
            </div>

            <div class="section">
                <h3>3. Escopo Técnico Discriminado (Res. CFC 1.590/2020 e NBC PG 01)</h3>
                <p style="margin-bottom:12px">{proposal.get('technical_scope_text') or ''}</p>
                {f'<p style="margin-bottom:10px"><strong>Plano Selecionado:</strong> {proposal.get("plan_name")}</p>' if proposal.get("plan_name") else ''}
                <table class="table">
                    <thead>
                        <tr>
                            <th>Departamento / Atividade Técnica</th>
                            <th style="text-align:center">Alocação Estimada</th>
                            <th style="text-align:right">Composição Mensal</th>
                        </tr>
                    </thead>
                    <tbody>
                        {services_rows}
                    </tbody>
                </table>
            </div>

            {avulsos_html}

            <div class="section">
                <h3>4. Investimento e Condições Comerciais</h3>
                <div class="inv-cards">
                    <div class="inv-card">
                        <span>Honorário Técnico Base</span>
                        <strong style="color:var(--text);font-size:20px">R$ {float(proposal.get('monthly_fee_base', 0)):,.2f}</strong>
                    </div>
                    {f'<div class="inv-card"><span>Desconto Comercial ({float(proposal.get("discount_pct", 0)):.1f}%)</span><strong style="color:#4FB477;font-size:20px">- R$ {float(proposal.get("discount_amount", 0)):,.2f}</strong></div>' if float(proposal.get('discount_pct', 0)) > 0 else ''}
                    <div class="inv-card highlight">
                        <span>Honorário Mensal Final</span>
                        <strong>R$ {float(proposal.get('monthly_fee_final', 0)):,.2f}/mês</strong>
                    </div>
                    <div class="inv-card">
                        <span>Taxa de Implantação / Onboarding</span>
                        <strong style="color:var(--text);font-size:20px">R$ {float(proposal.get('setup_fee', 0)):,.2f}</strong>
                    </div>
                </div>
                <p style="margin-top:14px"><strong>Condições de Pagamento:</strong> {proposal.get('payment_conditions')}</p>
            </div>

            <div class="section">
                <h3>5. Próximos Passos</h3>
                <p>{proposal.get('next_steps_text') or ''}</p>
            </div>

            {acceptance_block}

            <div class="sig-footer">
                <p><strong>{tenant.get('commercial_signature') or tenant.get('name')}</strong></p>
                <p style="margin-top:6px">Nota Legal: O aceite comercial registra a concordância com os termos comerciais desta proposta (v{proposal.get('current_version', 1)}) e não substitui automaticamente o Contrato de Prestação de Serviços Contábeis assinado eletronicamente (Res. CFC 1.590/2020).</p>
            </div>
        </div>
    </div>

    <script>
        async function submitAccept(e) {{
            e.preventDefault();
            const btn = document.getElementById('btn-submit-accept');
            const fb = document.getElementById('accept-feedback');
            btn.disabled = true;
            btn.textContent = 'Registrando aceite...';
            try {{
                const res = await fetch('/api/public/proposals/{proposal.get("public_token")}/accept', {{
                    method: 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify({{
                        accepted_by_name: document.getElementById('acc_name').value,
                        accepted_by_document: document.getElementById('acc_doc').value,
                        accepted_by_role: document.getElementById('acc_role').value,
                        accepted_by_email: document.getElementById('acc_email').value
                    }})
                }});
                const data = await res.json();
                if (res.ok && data.ok) {{
                    window.location.reload();
                }} else {{
                    fb.style.color = '#E5544B';
                    fb.textContent = data.error || 'Erro ao registrar aceite.';
                    btn.disabled = false;
                }}
            }} catch (err) {{
                fb.style.color = '#E5544B';
                fb.textContent = 'Falha de conexão.';
                btn.disabled = false;
            }}
        }}

        async function submitReject() {{
            const reason = prompt('Informe o motivo da recusa ou observação para revisão comercial:');
            if (!reason) return;
            await fetch('/api/public/proposals/{proposal.get("public_token")}/reject', {{
                method: 'POST',
                headers: {{ 'Content-Type': 'application/json' }},
                body: JSON.stringify({{ reason }})
            }});
            window.location.reload();
        }}
    </script>
</body>
</html>"""


class SaaSContabilRequestHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format_str: str, *args: Any) -> None:
        # Log conciso
        pass

    def _send_json(self, status_code: int, payload: Any) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Tenant-ID")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def _send_html(self, status_code: int, html: str) -> None:
        body = html.encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        try:
            return json.loads(raw)
        except Exception:
            return {}

    def _get_client_ip(self) -> str:
        forwarded = self.headers.get("X-Forwarded-For", "")
        if forwarded:
            return forwarded.split(",")[0].strip()
        real_ip = self.headers.get("X-Real-IP", "")
        if real_ip:
            return real_ip.strip()
        return self.client_address[0] if self.client_address else "127.0.0.1"

    def _get_auth_context(self, conn: Any) -> Dict[str, Any]:
        """
        Extrai o usuário autenticado via Bearer Token.
        Caso nenhum token seja enviado em ambiente local, utiliza o usuário administrador
        do tenant solicitado via X-Tenant-ID (ou tenant_alpha) para facilitar uso imediato,
        mas preserva validação estrita quando Authorization está presente.
        """
        auth_header = self.headers.get("Authorization", "")
        tenant_override = self.headers.get("X-Tenant-ID", "")

        if auth_header.startswith("Bearer "):
            token = auth_header[7:].strip()
            claims = verify_auth_token(token)
            if claims:
                # Se for admin_plataforma e enviou X-Tenant-ID, permite inspecionar aquele escritório
                effective_tenant = claims["tenant_id"]
                if claims.get("role") == "admin_plataforma" and tenant_override:
                    effective_tenant = tenant_override
                return {
                    "user_id": claims["sub"],
                    "tenant_id": effective_tenant,
                    "role": claims["role"],
                    "name": claims["name"],
                    "email": claims["email"],
                    "max_discount_pct": float(claims.get("max_discount_pct", 15.0)),
                }

        target_tenant = tenant_override or "tenant_alpha"
        user_row = conn.execute(
            "SELECT * FROM users WHERE tenant_id = ? AND active = 1 ORDER BY CASE role WHEN 'admin_escritorio' THEN 1 WHEN 'admin_plataforma' THEN 2 ELSE 3 END LIMIT 1",
            (target_tenant,),
        ).fetchone()
        if not user_row:
            user_row = conn.execute("SELECT * FROM users WHERE active = 1 LIMIT 1").fetchone()

        return {
            "user_id": user_row["id"],
            "tenant_id": user_row["tenant_id"],
            "role": user_row["role"],
            "name": user_row["name"],
            "email": user_row["email"],
            "max_discount_pct": float(user_row["max_discount_pct"]),
        }

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Tenant-ID")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        # Endpoint de Healthcheck para Hostinger VPS (Docker / Nginx / EasyPanel / Coolify)
        if path in ("/api/health", "/healthz"):
            self._send_json(
                200,
                {
                    "ok": True,
                    "status": "healthy",
                    "service": "saas-contabil-vps",
                    "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                },
            )
            return

        # Link exclusivo e seguro de proposta pública (/p/<token>)
        if path.startswith("/p/"):
            public_token = path[3:].strip("/")
            conn = get_connection()
            try:
                prop = conn.execute(
                    "SELECT * FROM proposals WHERE public_token = ? LIMIT 1",
                    (public_token,),
                ).fetchone()
                if not prop:
                    self._send_html(404, "<h2>Proposta não encontrada ou link expirado.</h2>")
                    return
                prop_dict = dict(prop)
                tenant = dict(
                    conn.execute("SELECT * FROM tenants WHERE id = ?", (prop_dict["tenant_id"],)).fetchone()
                )
                # Se estava Enviada, registra visualização e sincroniza CRM para Negociação
                if prop_dict["status"] == "Enviada":
                    conn.execute(
                        "UPDATE proposals SET status = 'Visualizada', viewed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
                        (prop_dict["id"],),
                    )
                    conn.execute(
                        """
                        INSERT INTO proposal_events (id, tenant_id, proposal_id, event_type, channel, recipient, metadata_json)
                        VALUES (?, ?, ?, 'visualizada', 'Link Público', ?, '{}')
                        """,
                        (f"pev_{secrets.token_hex(6)}", prop_dict["tenant_id"], prop_dict["id"], prop_dict["client_name"]),
                    )
                    if prop_dict.get("opportunity_id"):
                        neg_stage = get_stage_by_slug(conn, prop_dict["tenant_id"], "negociacao")
                        if neg_stage:
                            move_opportunity_stage_internal(
                                conn,
                                prop_dict["tenant_id"],
                                prop_dict["opportunity_id"],
                                neg_stage["id"],
                                None,
                                "Proposta visualizada pelo cliente no link exclusivo.",
                            )
                    conn.commit()
                    prop_dict["status"] = "Visualizada"

                events = rows_to_list(
                    conn.execute(
                        "SELECT * FROM proposal_events WHERE proposal_id = ? ORDER BY created_at DESC",
                        (prop_dict["id"],),
                    ).fetchall()
                )
                html = render_public_proposal_html(prop_dict, tenant, events)
                self._send_html(200, html)
            finally:
                conn.close()
            return

        if path.startswith("/api/"):
            self._handle_api_get(path, query)
            return

        # Servir arquivos estáticos (planilha Excel original, favicon, frontend SPA)
        if path == "/Calculadora_de_Honorarios.xlsx":
            xlsx_path = os.path.join(ROOT_DIR, "Calculadora_de_Honorarios.xlsx")
            if os.path.exists(xlsx_path):
                with open(xlsx_path, "rb") as f:
                    data = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
                self.send_header("Content-Disposition", 'attachment; filename="Calculadora_de_Honorarios.xlsx"')
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return

        if path == "/favicon.svg":
            fav_path = os.path.join(ROOT_DIR, "favicon.svg")
            if os.path.exists(fav_path):
                with open(fav_path, "rb") as f:
                    data = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "image/svg+xml")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return

        # Servir arquivos estáticos priorizando ROOT_DIR (sempre sincronizado) e fallback em FRONTEND_DIR
        rel_path = path.lstrip("/") or "index.html"
        safe_rel = os.path.normpath(rel_path).lstrip("\\/")
        candidate_root = os.path.join(ROOT_DIR, safe_rel)
        candidate_front = os.path.join(FRONTEND_DIR, safe_rel)

        if os.path.isfile(candidate_root) and safe_rel in ("index.html", "404.html", "styles.css", "app.js", "browser_engine.js", "favicon.svg"):
            full_path = candidate_root
        elif os.path.isfile(candidate_front):
            full_path = candidate_front
        else:
            full_path = os.path.join(ROOT_DIR, "index.html")
            if not os.path.isfile(full_path):
                full_path = os.path.join(FRONTEND_DIR, "index.html")

        if os.path.isfile(full_path):
            mime, _ = mimetypes.guess_type(full_path)
            with open(full_path, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", f"{mime or 'text/html'}; charset=utf-8")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        else:
            self._send_html(404, "<h1>404 - Arquivo não encontrado</h1>")

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        self._handle_api_post(parsed.path)

    def do_PUT(self) -> None:
        parsed = urlparse(self.path)
        self._handle_api_put(parsed.path)

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        self._handle_api_delete(parsed.path)

    # =========================================================================
    # HANDLERS GET DA API
    # =========================================================================
    def _handle_api_get(self, path: str, query: Dict[str, List[str]]) -> None:
        conn = get_connection()
        try:
            ctx = self._get_auth_context(conn)
            tenant_id = ctx["tenant_id"]

            if path == "/api/bootstrap" or path == "/api/auth/me":
                tenant = row_to_dict(conn.execute("SELECT * FROM tenants WHERE id = ?", (tenant_id,)).fetchone())
                tenants_list = rows_to_list(conn.execute("SELECT id, name, trade_name, city, state, primary_color, crc_registration FROM tenants WHERE active = 1 ORDER BY name").fetchall())
                users_list = rows_to_list(conn.execute("SELECT id, tenant_id, name, email, role, max_discount_pct, active, created_at FROM users WHERE tenant_id = ? ORDER BY name", (tenant_id,)).fetchall())
                all_users_switch = rows_to_list(conn.execute("SELECT u.id, u.tenant_id, u.name, u.email, u.role, u.max_discount_pct, t.trade_name AS tenant_name FROM users u JOIN tenants t ON t.id = u.tenant_id WHERE u.active = 1").fetchall())
                self._send_json(
                    200,
                    {
                        "ok": True,
                        "currentUser": ctx,
                        "tenant": tenant,
                        "tenants": tenants_list,
                        "tenantUsers": users_list,
                        "switchableAccounts": all_users_switch,
                    },
                )
                return

            if path == "/api/parameters":
                active_pv = row_to_dict(
                    conn.execute(
                        "SELECT * FROM parameter_versions WHERE tenant_id = ? AND is_active = 1 ORDER BY version_number DESC LIMIT 1",
                        (tenant_id,),
                    ).fetchone()
                )
                if active_pv:
                    active_pv["department_costs"] = parse_json_field(active_pv.get("department_costs_json"), [])
                    active_pv["regimes"] = parse_json_field(active_pv.get("regimes_json"), {})
                    active_pv["activities"] = parse_json_field(active_pv.get("activities_json"), {})
                    active_pv["invoice_brackets"] = parse_json_field(active_pv.get("invoice_brackets_json"), [])
                    active_pv["revenue_brackets"] = parse_json_field(active_pv.get("revenue_brackets_json"), [])
                    active_pv["accessories"] = parse_json_field(active_pv.get("accessories_json"), [])
                    active_pv["complexity_levels"] = parse_json_field(active_pv.get("complexity_levels_json"), {})

                versions = rows_to_list(
                    conn.execute(
                        "SELECT id, version_number, version_label, is_active, fixed_cost_monthly, productive_hours_monthly, target_margin_pct, minimum_fee_floor, created_by, created_at FROM parameter_versions WHERE tenant_id = ? ORDER BY version_number DESC",
                        (tenant_id,),
                    ).fetchall()
                )
                plans_services = rows_to_list(
                    conn.execute(
                        "SELECT * FROM plans_services WHERE tenant_id = ? AND is_active = 1 ORDER BY item_type, name",
                        (tenant_id,),
                    ).fetchall()
                )
                for ps in plans_services:
                    ps["included_features"] = parse_json_field(ps.get("included_features_json"), [])

                self._send_json(
                    200,
                    {
                        "ok": True,
                        "activeVersion": active_pv,
                        "versions": versions,
                        "plansServices": plans_services,
                    },
                )
                return

            if path == "/api/simulations":
                sims = rows_to_list(
                    conn.execute(
                        "SELECT * FROM simulations WHERE tenant_id = ? ORDER BY created_at DESC",
                        (tenant_id,),
                    ).fetchall()
                )
                for s in sims:
                    s["breakdown"] = parse_json_field(s.get("calculation_breakdown_json"), [])
                    s["selected_obligations"] = parse_json_field(s.get("selected_obligations_json"), {})
                    s["selected_one_off_services"] = parse_json_field(s.get("selected_one_off_services_json"), {})
                    s["selected_recurring_services"] = parse_json_field(s.get("selected_recurring_services_json"), [])
                self._send_json(200, {"ok": True, "simulations": sims})
                return

            if path == "/api/proposals":
                props = rows_to_list(
                    conn.execute(
                        "SELECT * FROM proposals WHERE tenant_id = ? ORDER BY created_at DESC",
                        (tenant_id,),
                    ).fetchall()
                )
                for p in props:
                    p["services_summary"] = parse_json_field(p.get("services_summary_json"), [])
                    p["one_off_services"] = parse_json_field(p.get("one_off_services_json"), [])
                    p["versions"] = rows_to_list(
                        conn.execute(
                            "SELECT id, version_number, monthly_fee_base, discount_pct, monthly_fee_final, setup_fee, one_off_total, created_at FROM proposal_versions WHERE proposal_id = ? AND tenant_id = ? ORDER BY version_number DESC",
                            (p["id"], tenant_id),
                        ).fetchall()
                    )
                    p["events"] = rows_to_list(
                        conn.execute(
                            "SELECT * FROM proposal_events WHERE proposal_id = ? AND tenant_id = ? ORDER BY created_at DESC",
                            (p["id"], tenant_id),
                        ).fetchall()
                    )
                templates = rows_to_list(
                    conn.execute("SELECT * FROM proposal_templates WHERE tenant_id = ? ORDER BY is_default DESC, name", (tenant_id,)).fetchall()
                )
                self._send_json(200, {"ok": True, "proposals": props, "templates": templates})
                return

            if path == "/api/crm/pipeline":
                stages = rows_to_list(
                    conn.execute(
                        "SELECT * FROM pipeline_stages WHERE tenant_id = ? ORDER BY stage_order ASC",
                        (tenant_id,),
                    ).fetchall()
                )
                opps = rows_to_list(
                    conn.execute(
                        """
                        SELECT o.*, u.name AS owner_name, lr.name AS loss_reason_name,
                               (SELECT COUNT(*) FROM commercial_diagnostics cd WHERE cd.opportunity_id = o.id) AS has_diagnostic,
                               (SELECT COUNT(*) FROM proposals pr WHERE pr.opportunity_id = o.id) AS proposals_count,
                               (SELECT status FROM proposals pr WHERE pr.opportunity_id = o.id ORDER BY created_at DESC LIMIT 1) AS latest_proposal_status
                        FROM opportunities o
                        LEFT JOIN users u ON u.id = o.owner_user_id
                        LEFT JOIN loss_reasons lr ON lr.id = o.loss_reason_id
                        WHERE o.tenant_id = ?
                        ORDER BY o.updated_at DESC
                        """,
                        (tenant_id,),
                    ).fetchall()
                )
                loss_reasons = rows_to_list(
                    conn.execute("SELECT * FROM loss_reasons WHERE tenant_id = ? AND is_active = 1", (tenant_id,)).fetchall()
                )
                activities = rows_to_list(
                    conn.execute(
                        """
                        SELECT a.*, o.company_name, o.contact_name, u.name AS assigned_user_name
                        FROM crm_activities a
                        JOIN opportunities o ON o.id = a.opportunity_id
                        LEFT JOIN users u ON u.id = a.assigned_user_id
                        WHERE a.tenant_id = ?
                        ORDER BY a.completed ASC, a.due_date ASC
                        """,
                        (tenant_id,),
                    ).fetchall()
                )
                users = rows_to_list(
                    conn.execute("SELECT id, name, email, role FROM users WHERE tenant_id = ? AND active = 1", (tenant_id,)).fetchall()
                )
                self._send_json(
                    200,
                    {
                        "ok": True,
                        "stages": stages,
                        "opportunities": opps,
                        "lossReasons": loss_reasons,
                        "activities": activities,
                        "sellers": users,
                    },
                )
                return

            if path.startswith("/api/crm/opportunities/") and path.endswith("/diagnostic"):
                opp_id = path.split("/")[4]
                diag = conn.execute(
                    "SELECT * FROM commercial_diagnostics WHERE opportunity_id = ? AND tenant_id = ? ORDER BY updated_at DESC LIMIT 1",
                    (opp_id, tenant_id),
                ).fetchone()
                opp = conn.execute(
                    "SELECT * FROM opportunities WHERE id = ? AND tenant_id = ?",
                    (opp_id, tenant_id),
                ).fetchone()
                if not opp:
                    self._send_json(404, {"ok": False, "error": "Oportunidade não encontrada."})
                    return
                diag_dict = row_to_dict(diag) if diag else {}
                if diag_dict:
                    diag_dict["specific_obligations"] = parse_json_field(diag_dict.get("specific_obligations_json"), {})
                    diag_dict["desired_services"] = parse_json_field(diag_dict.get("desired_services_json"), {})
                    diag_dict["custom_answers"] = parse_json_field(diag_dict.get("custom_answers_json"), {})
                self._send_json(200, {"ok": True, "opportunity": row_to_dict(opp), "diagnostic": diag_dict})
                return

            if path.startswith("/api/crm/opportunities/") and path.endswith("/history"):
                opp_id = path.split("/")[4]
                hist = rows_to_list(
                    conn.execute(
                        """
                        SELECT h.*, sf.name AS from_stage_name, st.name AS to_stage_name, u.name AS user_name
                        FROM opportunity_stage_history h
                        LEFT JOIN pipeline_stages sf ON sf.id = h.from_stage_id
                        LEFT JOIN pipeline_stages st ON st.id = h.to_stage_id
                        LEFT JOIN users u ON u.id = h.changed_by_user_id
                        WHERE h.opportunity_id = ? AND h.tenant_id = ?
                        ORDER BY h.created_at DESC
                        """,
                        (opp_id, tenant_id),
                    ).fetchall()
                )
                self._send_json(200, {"ok": True, "history": hist})
                return

            if path == "/api/crm/dashboard":
                seller_filter = query.get("seller", [""])[0]
                origin_filter = query.get("origin", [""])[0]
                period_days = int(query.get("days", ["90"])[0] or 90)

                where_clauses = ["o.tenant_id = ?"]
                params: List[Any] = [tenant_id]
                if seller_filter:
                    where_clauses.append("o.owner_user_id = ?")
                    params.append(seller_filter)
                if origin_filter:
                    where_clauses.append("o.lead_origin = ?")
                    params.append(origin_filter)
                if period_days > 0:
                    where_clauses.append(f"o.created_at >= datetime('now', '-{period_days} days')")

                where_sql = " AND ".join(where_clauses)
                opps = rows_to_list(
                    conn.execute(
                        f"""
                        SELECT o.*, s.name AS stage_name, s.stage_order, u.name AS owner_name, lr.name AS loss_reason_name
                        FROM opportunities o
                        JOIN pipeline_stages s ON s.id = o.stage_id
                        LEFT JOIN users u ON u.id = o.owner_user_id
                        LEFT JOIN loss_reasons lr ON lr.id = o.loss_reason_id
                        WHERE {where_sql}
                        """,
                        params,
                    ).fetchall()
                )

                props = rows_to_list(
                    conn.execute(
                        "SELECT * FROM proposals WHERE tenant_id = ?",
                        (tenant_id,),
                    ).fetchall()
                )

                total_leads = len(opps)
                open_opps = [o for o in opps if o["status"] == "aberta"]
                won_opps = [o for o in opps if o["status"] == "ganha"]
                lost_opps = [o for o in opps if o["status"] == "perdida"]

                mrr_ganho = sum(float(o.get("potential_monthly_value") or 0) for o in won_opps)
                pipeline_potencial = sum(float(o.get("potential_monthly_value") or 0) for o in open_opps)
                receita_proposta = sum(
                    float(p.get("monthly_fee_final") or 0)
                    for p in props
                    if p["status"] in ("Enviada", "Visualizada", "Em negociação", "Aceita")
                )

                propostas_enviadas = len([p for p in props if p["status"] != "Rascunho"])
                propostas_aceitas = len([p for p in props if p["status"] == "Aceita"])

                taxa_fechamento = (len(won_opps) / total_leads * 100.0) if total_leads > 0 else 0.0
                ticket_medio = (mrr_ganho / len(won_opps)) if len(won_opps) > 0 else 0.0

                # Tempo médio de fechamento em dias
                closing_days = []
                for o in won_opps:
                    try:
                        c_dt = datetime.strptime(o["created_at"][:19], "%Y-%m-%d %H:%M:%S")
                        w_dt = datetime.strptime((o["won_at"] or o["updated_at"])[:19], "%Y-%m-%d %H:%M:%S")
                        closing_days.append(max(1, (w_dt - c_dt).days))
                    except Exception:
                        closing_days.append(4)
                tempo_medio_fechamento = round(sum(closing_days) / len(closing_days), 1) if closing_days else 0.0

                # Conversão por etapa
                stages = rows_to_list(
                    conn.execute("SELECT * FROM pipeline_stages WHERE tenant_id = ? ORDER BY stage_order ASC", (tenant_id,)).fetchall()
                )
                stage_stats = []
                for st in stages:
                    st_opps = [o for o in opps if o["stage_id"] == st["id"]]
                    stage_stats.append(
                        {
                            "stage_id": st["id"],
                            "name": st["name"],
                            "color": st["color"],
                            "count": len(st_opps),
                            "value": round(sum(float(o.get("potential_monthly_value") or 0) for o in st_opps), 2),
                            "conversion_pct": round((len(st_opps) / total_leads * 100.0) if total_leads > 0 else 0.0, 1),
                        }
                    )

                # Motivos de perda
                loss_map: Dict[str, int] = {}
                for o in lost_opps:
                    rname = o.get("loss_reason_name") or "Outros"
                    loss_map[rname] = loss_map.get(rname, 0) + 1
                loss_breakdown = [{"reason": k, "count": v} for k, v in loss_map.items()]

                # Desempenho por vendedor
                seller_map: Dict[str, Dict[str, Any]] = {}
                for o in opps:
                    sname = o.get("owner_name") or "Sem responsável"
                    if sname not in seller_map:
                        seller_map[sname] = {"name": sname, "leads": 0, "won": 0, "mrr": 0.0, "pipeline": 0.0}
                    seller_map[sname]["leads"] += 1
                    if o["status"] == "ganha":
                        seller_map[sname]["won"] += 1
                        seller_map[sname]["mrr"] += float(o.get("potential_monthly_value") or 0)
                    elif o["status"] == "aberta":
                        seller_map[sname]["pipeline"] += float(o.get("potential_monthly_value") or 0)

                today_str = datetime.now().strftime("%Y-%m-%d")
                pending_acts = conn.execute(
                    "SELECT COUNT(*) AS c FROM crm_activities WHERE tenant_id = ? AND completed = 0",
                    (tenant_id,),
                ).fetchone()["c"]
                overdue_acts = conn.execute(
                    "SELECT COUNT(*) AS c FROM crm_activities WHERE tenant_id = ? AND completed = 0 AND due_date < ?",
                    (tenant_id, today_str),
                ).fetchone()["c"]

                origins_rows = conn.execute(
                    "SELECT DISTINCT lead_origin FROM opportunities WHERE tenant_id = ? AND lead_origin IS NOT NULL",
                    (tenant_id,),
                ).fetchall()

                self._send_json(
                    200,
                    {
                        "ok": True,
                        "kpis": {
                            "leadsGerados": total_leads,
                            "oportunidadesAbertas": len(open_opps),
                            "propostasEnviadas": propostas_enviadas,
                            "propostasAceitas": propostas_aceitas,
                            "taxaFechamentoPct": round(taxa_fechamento, 1),
                            "ticketMedio": round(ticket_medio, 2),
                            "mrrGanho": round(mrr_ganho, 2),
                            "valorPotencialPipeline": round(pipeline_potencial, 2),
                            "valorEmPropostas": round(receita_proposta, 2),
                            "tempoMedioFechamentoDias": tempo_medio_fechamento,
                            "atividadesPendentes": pending_acts,
                            "atividadesAtrasadas": overdue_acts,
                        },
                        "stageBreakdown": stage_stats,
                        "lossBreakdown": loss_breakdown,
                        "sellerPerformance": list(seller_map.values()),
                        "origins": [r["lead_origin"] for r in origins_rows if r["lead_origin"]],
                    },
                )
                return

            if path == "/api/settings":
                tenant = row_to_dict(conn.execute("SELECT * FROM tenants WHERE id = ?", (tenant_id,)).fetchone())
                tenant["smtp_config"] = parse_json_field(tenant.get("smtp_config_json"), {})
                tenant["integrations"] = parse_json_field(tenant.get("integrations_json"), {})
                tenant["default_messages"] = parse_json_field(tenant.get("default_messages_json"), {})
                tenant["custom_diagnostic_questions"] = parse_json_field(tenant.get("custom_diagnostic_questions_json"), [])

                users = rows_to_list(
                    conn.execute("SELECT id, tenant_id, name, email, role, phone, max_discount_pct, active, created_at FROM users WHERE tenant_id = ? ORDER BY name", (tenant_id,)).fetchall()
                )
                stages = rows_to_list(
                    conn.execute("SELECT * FROM pipeline_stages WHERE tenant_id = ? ORDER BY stage_order ASC", (tenant_id,)).fetchall()
                )
                loss_reasons = rows_to_list(
                    conn.execute("SELECT * FROM loss_reasons WHERE tenant_id = ? ORDER BY id ASC", (tenant_id,)).fetchall()
                )
                templates = rows_to_list(
                    conn.execute("SELECT * FROM proposal_templates WHERE tenant_id = ? ORDER BY is_default DESC", (tenant_id,)).fetchall()
                )
                audit_logs = rows_to_list(
                    conn.execute("SELECT * FROM audit_logs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 40", (tenant_id,)).fetchall()
                )
                self._send_json(
                    200,
                    {
                        "ok": True,
                        "tenant": tenant,
                        "users": users,
                        "stages": stages,
                        "lossReasons": loss_reasons,
                        "templates": templates,
                        "auditLogs": audit_logs,
                    },
                )
                return

            self._send_json(404, {"ok": False, "error": f"Endpoint GET não encontrado: {path}"})
        finally:
            conn.close()

    # =========================================================================
    # HANDLERS POST DA API
    # =========================================================================
    def _handle_api_post(self, path: str) -> None:
        body = self._read_json_body()
        conn = get_connection()
        try:
            # 1. Login / Troca rápida de usuário/tenant
            if path == "/api/auth/login":
                email = str(body.get("email", "")).strip().lower()
                password = str(body.get("password", ""))
                user_id = body.get("user_id")

                if user_id:
                    user_row = conn.execute("SELECT * FROM users WHERE id = ? AND active = 1", (user_id,)).fetchone()
                else:
                    user_row = conn.execute("SELECT * FROM users WHERE lower(email) = ? AND active = 1", (email,)).fetchone()

                if not user_row:
                    self._send_json(401, {"ok": False, "error": "Usuário não encontrado ou inativo."})
                    return

                user_dict = dict(user_row)
                if not user_id and password and not verify_password(password, user_dict["password_hash"]):
                    self._send_json(401, {"ok": False, "error": "Senha incorreta."})
                    return

                token = create_auth_token(user_dict)
                log_audit(conn, user_dict["tenant_id"], user_dict["id"], "LOGIN", "user", user_dict["id"], {"email": user_dict["email"]})
                conn.commit()
                self._send_json(
                    200,
                    {
                        "ok": True,
                        "token": token,
                        "user": {
                            "id": user_dict["id"],
                            "tenant_id": user_dict["tenant_id"],
                            "name": user_dict["name"],
                            "email": user_dict["email"],
                            "role": user_dict["role"],
                            "max_discount_pct": user_dict["max_discount_pct"],
                        },
                    },
                )
                return

            # 2. Aceite Comercial Público (/api/public/proposals/<token>/accept)
            if path.startswith("/api/public/proposals/") and path.endswith("/accept"):
                public_token = path.split("/")[4]
                prop = conn.execute("SELECT * FROM proposals WHERE public_token = ? LIMIT 1", (public_token,)).fetchone()
                if not prop:
                    self._send_json(404, {"ok": False, "error": "Proposta não encontrada."})
                    return
                prop_dict = dict(prop)
                resp_name = str(body.get("accepted_by_name", "")).strip()
                resp_doc = str(body.get("accepted_by_document", "")).strip()
                resp_role = str(body.get("accepted_by_role", "Representante Legal")).strip()
                resp_email = str(body.get("accepted_by_email", "")).strip()
                client_ip = self.client_address[0] if self.client_address else "127.0.0.1"

                if not resp_name or not resp_doc:
                    self._send_json(400, {"ok": False, "error": "Informe o nome completo e CPF/CNPJ do responsável pelo aceite."})
                    return

                snapshot_terms = json.dumps(
                    {
                        "proposal_number": prop_dict["proposal_number"],
                        "version": prop_dict["current_version"],
                        "monthly_fee_final": prop_dict["monthly_fee_final"],
                        "setup_fee": prop_dict["setup_fee"],
                        "payment_conditions": prop_dict["payment_conditions"],
                        "disclaimer": "Aceite comercial não substitui automaticamente o contrato assinado eletronicamente (Res. CFC 1.590/2020).",
                    },
                    ensure_ascii=False,
                )

                conn.execute(
                    """
                    UPDATE proposals
                    SET status = 'Aceita',
                        accepted_at = datetime('now'),
                        accepted_by_name = ?,
                        accepted_by_document = ?,
                        accepted_by_role = ?,
                        accepted_by_email = ?,
                        accepted_ip = ?,
                        accepted_version = current_version,
                        accepted_terms_snapshot = ?,
                        updated_at = datetime('now')
                    WHERE id = ?
                    """,
                    (resp_name, resp_doc, resp_role, resp_email, client_ip, snapshot_terms, prop_dict["id"]),
                )

                conn.execute(
                    """
                    INSERT INTO proposal_events (id, tenant_id, proposal_id, event_type, channel, recipient, metadata_json)
                    VALUES (?, ?, ?, 'aceita', 'Portal Público', ?, ?)
                    """,
                    (
                        f"pev_{secrets.token_hex(6)}",
                        prop_dict["tenant_id"],
                        prop_dict["id"],
                        resp_name,
                        snapshot_terms,
                    ),
                )

                # Sincroniza automaticamente a oportunidade no CRM para 'Ganho'
                if prop_dict.get("opportunity_id"):
                    won_stage = get_stage_by_slug(conn, prop_dict["tenant_id"], "ganho")
                    if won_stage:
                        move_opportunity_stage_internal(
                            conn,
                            prop_dict["tenant_id"],
                            prop_dict["opportunity_id"],
                            won_stage["id"],
                            None,
                            f"Proposta #{prop_dict['proposal_number']} aceita comercialmente por {resp_name} ({resp_doc}).",
                            potential_value=float(prop_dict["monthly_fee_final"]),
                        )

                log_audit(conn, prop_dict["tenant_id"], None, "PROPOSAL_ACCEPTED", "proposal", prop_dict["id"], {"accepted_by": resp_name, "doc": resp_doc}, client_ip)
                conn.commit()
                self._send_json(200, {"ok": True, "status": "Aceita"})
                return

            if path.startswith("/api/public/proposals/") and path.endswith("/reject"):
                public_token = path.split("/")[4]
                prop = conn.execute("SELECT * FROM proposals WHERE public_token = ? LIMIT 1", (public_token,)).fetchone()
                if not prop:
                    self._send_json(404, {"ok": False, "error": "Proposta não encontrada."})
                    return
                prop_dict = dict(prop)
                reason = str(body.get("reason", "Solicitada revisão comercial")).strip()
                conn.execute(
                    "UPDATE proposals SET status = 'Recusada', rejected_reason = ?, updated_at = datetime('now') WHERE id = ?",
                    (reason, prop_dict["id"]),
                )
                conn.execute(
                    """
                    INSERT INTO proposal_events (id, tenant_id, proposal_id, event_type, channel, recipient, metadata_json)
                    VALUES (?, ?, ?, 'recusada', 'Portal Público', ?, ?)
                    """,
                    (f"pev_{secrets.token_hex(6)}", prop_dict["tenant_id"], prop_dict["id"], prop_dict["client_name"], json.dumps({"reason": reason}, ensure_ascii=False)),
                )
                conn.commit()
                self._send_json(200, {"ok": True, "status": "Recusada"})
                return

            # Contexto autenticado do escritório
            ctx = self._get_auth_context(conn)
            tenant_id = ctx["tenant_id"]
            user_id = ctx["user_id"]
            user_role = ctx["role"]

            # 3. Criar Novo Escritório (Multi-Tenant Onboarding)
            if path == "/api/tenants":
                if user_role not in ("admin_plataforma", "admin_escritorio"):
                    self._send_json(403, {"ok": False, "error": "Sem permissão para criar novo escritório."})
                    return
                new_tid = f"tenant_{secrets.token_hex(4)}"
                name = str(body.get("name", "Novo Escritório Contábil Ltda.")).strip()
                trade = str(body.get("trade_name", name)).strip()
                cnpj = str(body.get("cnpj", "00.000.000/0001-00")).strip()
                crc = str(body.get("crc_registration", "CRC-00000/O")).strip()
                email = str(body.get("email", f"contato@{new_tid}.cnt.br")).strip()
                phone = str(body.get("phone", "(11) 3000-0000")).strip()
                city = str(body.get("city", "São Paulo")).strip()
                state = str(body.get("state", "SP")).strip()
                color = str(body.get("primary_color", "#C9A227")).strip()

                seed_tenant_defaults(conn, new_tid, name, trade, cnpj, crc, email, phone, city, state, color)
                admin_uid = f"usr_{new_tid}_admin"
                conn.execute(
                    """
                    INSERT INTO users (id, tenant_id, name, email, password_hash, role, max_discount_pct, lgpd_consent_at, active)
                    VALUES (?, ?, ?, ?, ?, 'admin_escritorio', 25.0, datetime('now'), 1)
                    """,
                    (admin_uid, new_tid, f"Diretoria {trade}", email, hash_password("admin123")),
                )
                log_audit(conn, new_tid, user_id, "CREATE_TENANT", "tenant", new_tid, {"name": name})
                conn.commit()
                self._send_json(201, {"ok": True, "tenant_id": new_tid, "admin_user_id": admin_uid})
                return

            # 4. Salvar Nova Versão de Parâmetros (Versionamento Imutável)
            if path == "/api/parameters/versions":
                if user_role not in ("admin_plataforma", "admin_escritorio", "gestor_comercial"):
                    self._send_json(403, {"ok": False, "error": "Apenas administradores ou gestores podem alterar os parâmetros de precificação."})
                    return

                last_v = conn.execute(
                    "SELECT COALESCE(MAX(version_number), 0) AS mv FROM parameter_versions WHERE tenant_id = ?",
                    (tenant_id,),
                ).fetchone()["mv"]
                next_v = int(last_v) + 1
                new_pv_id = f"pv_{tenant_id}_v{next_v}_{secrets.token_hex(3)}"

                conn.execute("UPDATE parameter_versions SET is_active = 0 WHERE tenant_id = ?", (tenant_id,))

                fixed_cost = float(body.get("fixed_cost_monthly", 28000.0))
                var_cost = float(body.get("variable_cost_pct", 0.0))
                prod_hours = float(body.get("productive_hours_monthly", 320.0))
                margin = float(body.get("target_margin_pct", 30.0))
                markup = round(1.0 + margin / 100.0, 4)
                min_floor = float(body.get("minimum_fee_floor", 350.0))
                max_disc_seller = float(body.get("max_discount_seller_pct", 8.0))
                max_disc_mgr = float(body.get("max_discount_manager_pct", 15.0))
                setup_fee = float(body.get("default_setup_fee", 450.0))
                h_emp = float(body.get("hours_per_employee", 0.45))
                h_part = float(body.get("hours_per_partner", 0.35))
                h_branch = float(body.get("hours_per_branch", 1.50))
                label = str(body.get("version_label") or f"v{next_v}.0 — Atualizado em {datetime.now().strftime('%d/%m/%Y %H:%M')}")

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
                    ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        new_pv_id,
                        tenant_id,
                        next_v,
                        label,
                        fixed_cost,
                        var_cost,
                        prod_hours,
                        margin,
                        markup,
                        min_floor,
                        max_disc_seller,
                        max_disc_mgr,
                        setup_fee,
                        h_emp,
                        h_part,
                        h_branch,
                        json.dumps(body.get("department_costs") or [], ensure_ascii=False),
                        json.dumps(body.get("regimes") or {}, ensure_ascii=False),
                        json.dumps(body.get("activities") or {}, ensure_ascii=False),
                        json.dumps(body.get("invoice_brackets") or [], ensure_ascii=False),
                        json.dumps(body.get("revenue_brackets") or [], ensure_ascii=False),
                        json.dumps(body.get("accessories") or [], ensure_ascii=False),
                        json.dumps(body.get("complexity_levels") or {}, ensure_ascii=False),
                        ctx["name"],
                    ),
                )
                log_audit(conn, tenant_id, user_id, "NEW_PARAMETER_VERSION", "parameter_version", new_pv_id, {"version": next_v, "label": label})
                conn.commit()
                self._send_json(201, {"ok": True, "id": new_pv_id, "version_number": next_v, "version_label": label})
                return

            # 5. Cadastrar Plano ou Serviço (Recorrente, Avulso, Implantação — permite sem nome/preço fixo imposto)
            if path == "/api/plans-services":
                ps_id = f"ps_{secrets.token_hex(6)}"
                item_type = str(body.get("item_type", "servico_recorrente"))
                name = str(body.get("name") or f"Item Personalizado #{secrets.token_hex(2).upper()}").strip()
                code = str(body.get("code") or name[:8].upper().replace(" ", "-"))
                desc = str(body.get("description", ""))
                dept = str(body.get("department", "Contábil"))
                est_hours = float(body.get("estimated_hours") or 0.0)
                base_price = float(body.get("base_price") or 0.0)
                mult = float(body.get("multiplier") or 1.0)
                feats = body.get("included_features") or []

                conn.execute(
                    """
                    INSERT INTO plans_services (
                        id, tenant_id, item_type, code, name, description, department,
                        estimated_hours, base_price, multiplier, included_features_json, is_active
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                    """,
                    (ps_id, tenant_id, item_type, code, name, desc, dept, est_hours, base_price, mult, json.dumps(feats, ensure_ascii=False)),
                )
                log_audit(conn, tenant_id, user_id, "CREATE_PLAN_SERVICE", "plans_services", ps_id, {"name": name, "type": item_type})
                conn.commit()
                self._send_json(201, {"ok": True, "id": ps_id})
                return

            # 6. Calcular Honorários (Motor Oficial NBC PG 01 + C# PricingEngine.exe)
            if path == "/api/calculator/calculate":
                active_pv = row_to_dict(
                    conn.execute(
                        "SELECT * FROM parameter_versions WHERE tenant_id = ? AND is_active = 1 ORDER BY version_number DESC LIMIT 1",
                        (tenant_id,),
                    ).fetchone()
                )
                plans_services = rows_to_list(
                    conn.execute("SELECT * FROM plans_services WHERE tenant_id = ? AND is_active = 1", (tenant_id,)).fetchall()
                )
                result = calculate_honorarios(
                    body,
                    param_version=active_pv,
                    plans_services=plans_services,
                    user_max_discount_pct=ctx["max_discount_pct"],
                    use_csharp_engine=bool(body.get("verifyWithCSharp", False)),
                )
                self._send_json(200, {"ok": True, "result": result, "parameterVersionId": active_pv.get("id")})
                return

            # 7. Salvar Simulação na Calculadora (e sincronizar com CRM se vinculada a oportunidade)
            if path == "/api/simulations":
                active_pv = row_to_dict(
                    conn.execute(
                        "SELECT * FROM parameter_versions WHERE tenant_id = ? AND is_active = 1 ORDER BY version_number DESC LIMIT 1",
                        (tenant_id,),
                    ).fetchone()
                )
                plans_services = rows_to_list(
                    conn.execute("SELECT * FROM plans_services WHERE tenant_id = ? AND is_active = 1", (tenant_id,)).fetchall()
                )
                calc = calculate_honorarios(body, param_version=active_pv, plans_services=plans_services, user_max_discount_pct=ctx["max_discount_pct"])

                sim_id = body.get("id") or f"sim_{secrets.token_hex(6)}"
                opp_id = body.get("opportunityId") or None
                client_id = body.get("clientId") or None
                title = str(body.get("title") or f"Simulação — {body.get('companyName') or body.get('clientName') or 'Cliente'}")

                conn.execute(
                    """
                    INSERT OR REPLACE INTO simulations (
                        id, tenant_id, parameter_version_id, opportunity_id, client_id,
                        title, client_name, company_name, cpf_cnpj, tax_regime,
                        economic_activity, monthly_revenue, employees_count, partners_count,
                        branches_count, invoice_volume_index, operational_complexity,
                        selected_plan_id, selected_obligations_json, selected_one_off_services_json,
                        selected_recurring_services_json, setup_fee, discount_pct, intended_price,
                        cost_per_hour, technical_hour_rate, total_hours, floor_cost,
                        recommended_fee, final_monthly_fee, total_one_off_fee, viability_status,
                        calculation_breakdown_json, created_by, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                    """,
                    (
                        sim_id,
                        tenant_id,
                        active_pv["id"],
                        opp_id,
                        client_id,
                        title,
                        str(body.get("clientName", "")),
                        str(body.get("companyName", "")),
                        str(body.get("cpfCnpj", "")),
                        str(body.get("regime", "simples")),
                        str(body.get("atividade", "servicos")),
                        float(body.get("faturamento", 50000.0)),
                        int(body.get("funcionarios", 2)),
                        int(body.get("socios", 1)),
                        int(body.get("filiais", 0)),
                        int(body.get("volume", 1)),
                        str(body.get("complexidade", "padrao")),
                        body.get("selectedPlanId"),
                        json.dumps(body.get("obrigacoes") or {}, ensure_ascii=False),
                        json.dumps(body.get("avulsos") or {}, ensure_ascii=False),
                        json.dumps(body.get("servicosRecorrentesIds") or [], ensure_ascii=False),
                        calc["taxaImplantacao"],
                        calc["descontoPct"],
                        float(body.get("precoPretendido", 0.0)),
                        calc["custoHora"],
                        calc["horaTecnica"],
                        calc["horasTotais"],
                        calc["piso"],
                        calc["sugerido"],
                        calc["honorarioFinal"],
                        calc["totalAvulsos"],
                        calc["status"] or "ok",
                        json.dumps(calc["breakdown"], ensure_ascii=False),
                        ctx["name"],
                    ),
                )

                # Sincroniza oportunidade no CRM para etapa 4 (Precificação) e atualiza valor potencial
                if opp_id:
                    prec_stage = get_stage_by_slug(conn, tenant_id, "precificacao")
                    opp_row = conn.execute("SELECT * FROM opportunities WHERE id = ? AND tenant_id = ?", (opp_id, tenant_id)).fetchone()
                    if opp_row and prec_stage:
                        cur_stage = conn.execute("SELECT stage_order FROM pipeline_stages WHERE id = ?", (opp_row["stage_id"],)).fetchone()
                        if cur_stage and cur_stage["stage_order"] <= prec_stage["stage_order"]:
                            move_opportunity_stage_internal(
                                conn,
                                tenant_id,
                                opp_id,
                                prec_stage["id"],
                                user_id,
                                f"Honorários calculados na simulação '{title}' (R$ {calc['honorarioFinal']:,.2f}/mês).",
                                potential_value=calc["honorarioFinal"],
                            )
                        else:
                            conn.execute(
                                "UPDATE opportunities SET potential_monthly_value = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?",
                                (calc["honorarioFinal"], opp_id, tenant_id),
                            )

                log_audit(conn, tenant_id, user_id, "SAVE_SIMULATION", "simulation", sim_id, {"title": title, "fee": calc["honorarioFinal"]})
                conn.commit()
                self._send_json(201, {"ok": True, "simulationId": sim_id, "calculation": calc})
                return

            # 8. Duplicar Simulação
            if path.startswith("/api/simulations/") and path.endswith("/duplicate"):
                orig_id = path.split("/")[3]
                orig = conn.execute("SELECT * FROM simulations WHERE id = ? AND tenant_id = ?", (orig_id, tenant_id)).fetchone()
                if not orig:
                    self._send_json(404, {"ok": False, "error": "Simulação original não encontrada."})
                    return
                new_id = f"sim_{secrets.token_hex(6)}"
                conn.execute(
                    """
                    INSERT INTO simulations (
                        id, tenant_id, parameter_version_id, opportunity_id, client_id,
                        title, client_name, company_name, cpf_cnpj, tax_regime,
                        economic_activity, monthly_revenue, employees_count, partners_count,
                        branches_count, invoice_volume_index, operational_complexity,
                        selected_plan_id, selected_obligations_json, selected_one_off_services_json,
                        selected_recurring_services_json, setup_fee, discount_pct, intended_price,
                        cost_per_hour, technical_hour_rate, total_hours, floor_cost,
                        recommended_fee, final_monthly_fee, total_one_off_fee, viability_status,
                        calculation_breakdown_json, created_by
                    )
                    SELECT ?, tenant_id, parameter_version_id, opportunity_id, client_id,
                           title || ' (Cópia)', client_name, company_name, cpf_cnpj, tax_regime,
                           economic_activity, monthly_revenue, employees_count, partners_count,
                           branches_count, invoice_volume_index, operational_complexity,
                           selected_plan_id, selected_obligations_json, selected_one_off_services_json,
                           selected_recurring_services_json, setup_fee, discount_pct, intended_price,
                           cost_per_hour, technical_hour_rate, total_hours, floor_cost,
                           recommended_fee, final_monthly_fee, total_one_off_fee, viability_status,
                           calculation_breakdown_json, ?
                    FROM simulations WHERE id = ? AND tenant_id = ?
                    """,
                    (new_id, ctx["name"], orig_id, tenant_id),
                )
                conn.commit()
                self._send_json(201, {"ok": True, "id": new_id})
                return

            # 9. Gerar / Criar Proposta Comercial (Integrada à Calculadora e ao CRM)
            if path == "/api/proposals":
                count_prop = conn.execute("SELECT COUNT(*) AS c FROM proposals WHERE tenant_id = ?", (tenant_id,)).fetchone()["c"]
                prop_number = body.get("proposal_number") or f"PROP-{datetime.now().year}-{int(count_prop) + 1:03d}"
                prop_id = f"prop_{secrets.token_hex(6)}"
                pub_token = f"tok_{tenant_id.replace('tenant_', '')}_{secrets.token_hex(8)}"

                tpl = conn.execute(
                    "SELECT * FROM proposal_templates WHERE tenant_id = ? ORDER BY is_default DESC LIMIT 1",
                    (tenant_id,),
                ).fetchone()
                tpl_dict = dict(tpl) if tpl else {}

                opp_id = body.get("opportunity_id") or None
                client_id = body.get("client_id") or None
                sim_id = body.get("simulation_id") or None

                client_name = str(body.get("client_name") or "Cliente").strip()
                company_name = str(body.get("company_name") or client_name).strip()
                cpf_cnpj = str(body.get("cpf_cnpj") or "").strip()
                contact_email = str(body.get("contact_email") or "").strip()
                contact_whatsapp = str(body.get("contact_whatsapp") or "").strip()

                # Evita duplicação de cliente: vincula ou cria cliente caso ainda não exista
                if not client_id and opp_id:
                    opp_row = conn.execute("SELECT client_id FROM opportunities WHERE id = ? AND tenant_id = ?", (opp_id, tenant_id)).fetchone()
                    if opp_row and opp_row["client_id"]:
                        client_id = opp_row["client_id"]

                if not client_id:
                    existing_cli = None
                    if cpf_cnpj:
                        existing_cli = conn.execute("SELECT id FROM clients WHERE tenant_id = ? AND cpf_cnpj = ? LIMIT 1", (tenant_id, cpf_cnpj)).fetchone()
                    if not existing_cli:
                        existing_cli = conn.execute("SELECT id FROM clients WHERE tenant_id = ? AND company_name = ? LIMIT 1", (tenant_id, company_name)).fetchone()
                    if existing_cli:
                        client_id = existing_cli["id"]
                    else:
                        client_id = f"cli_{secrets.token_hex(6)}"
                        conn.execute(
                            "INSERT INTO clients (id, tenant_id, contact_name, company_name, cpf_cnpj, email, whatsapp) VALUES (?, ?, ?, ?, ?, ?, ?)",
                            (client_id, tenant_id, client_name, company_name, cpf_cnpj, contact_email, contact_whatsapp),
                        )

                monthly_base = float(body.get("monthly_fee_base", 0.0))
                disc_pct = float(body.get("discount_pct", 0.0))
                disc_amount = round(monthly_base * (disc_pct / 100.0), 2)
                monthly_final = float(body.get("monthly_fee_final") or max(0.0, monthly_base - disc_amount))
                setup_fee = float(body.get("setup_fee", 450.0))
                one_off_total = float(body.get("one_off_total", 0.0))

                valid_until = str(body.get("valid_until") or (datetime.now() + timedelta(days=int(tpl_dict.get("validity_days_default", 10)))).strftime("%Y-%m-%d"))
                payment_cond = str(body.get("payment_conditions") or tpl_dict.get("payment_terms_default") or "Boleto ou PIX até o dia 10 do mês subsequente.")

                services_summary = body.get("services_summary") or []
                one_off_services = body.get("one_off_services") or []

                cover_title = str(body.get("cover_title") or tpl_dict.get("cover_title") or f"Proposta Comercial — {company_name}")
                office_pres = str(body.get("office_presentation") or tpl_dict.get("office_presentation") or "")
                diffs = str(body.get("differentials_text") or tpl_dict.get("differentials_text") or "")
                scope_txt = str(body.get("technical_scope_text") or tpl_dict.get("scope_template") or "")
                next_steps = str(body.get("next_steps_text") or tpl_dict.get("next_steps_text") or "")

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
                        next_steps_text, status
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Rascunho')
                    """,
                    (
                        prop_id,
                        tenant_id,
                        prop_number,
                        pub_token,
                        opp_id,
                        client_id,
                        sim_id,
                        tpl_dict.get("id"),
                        user_id,
                        client_name,
                        company_name,
                        cpf_cnpj,
                        contact_email,
                        contact_whatsapp,
                        body.get("plan_name") or "Plano Contábil Personalizado",
                        json.dumps(services_summary, ensure_ascii=False),
                        json.dumps(one_off_services, ensure_ascii=False),
                        monthly_base,
                        disc_pct,
                        disc_amount,
                        monthly_final,
                        setup_fee,
                        one_off_total,
                        payment_cond,
                        valid_until,
                        cover_title,
                        office_pres,
                        diffs,
                        scope_txt,
                        next_steps,
                    ),
                )

                # Registra versão 1 da proposta
                conn.execute(
                    """
                    INSERT INTO proposal_versions (
                        id, tenant_id, proposal_id, version_number, monthly_fee_base,
                        discount_pct, monthly_fee_final, setup_fee, one_off_total, snapshot_json, created_by
                    ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        f"pv_{prop_id}_v1",
                        tenant_id,
                        prop_id,
                        monthly_base,
                        disc_pct,
                        monthly_final,
                        setup_fee,
                        one_off_total,
                        json.dumps({"services": services_summary, "one_off": one_off_services, "scope": scope_txt}, ensure_ascii=False),
                        ctx["name"],
                    ),
                )

                conn.execute(
                    """
                    INSERT INTO proposal_events (id, tenant_id, proposal_id, event_type, channel, recipient, metadata_json)
                    VALUES (?, ?, ?, 'criada', 'Sistema', ?, '{"version": 1}')
                    """,
                    (f"pev_{secrets.token_hex(6)}", tenant_id, prop_id, company_name),
                )

                if opp_id:
                    prec_stage = get_stage_by_slug(conn, tenant_id, "precificacao")
                    if prec_stage:
                        move_opportunity_stage_internal(
                            conn,
                            tenant_id,
                            opp_id,
                            prec_stage["id"],
                            user_id,
                            f"Proposta #{prop_number} gerada em Rascunho.",
                            potential_value=monthly_final,
                        )

                log_audit(conn, tenant_id, user_id, "CREATE_PROPOSAL", "proposal", prop_id, {"number": prop_number, "fee": monthly_final})
                conn.commit()
                self._send_json(
                    201,
                    {
                        "ok": True,
                        "proposalId": prop_id,
                        "proposalNumber": prop_number,
                        "publicToken": pub_token,
                        "publicUrl": f"/p/{pub_token}",
                    },
                )
                return

            # 10. Enviar Proposta (E-mail Transacional / WhatsApp / PDF) e sincronizar CRM para 'Proposta Enviada'
            if path.startswith("/api/proposals/") and path.endswith("/send"):
                prop_id = path.split("/")[3]
                prop = conn.execute("SELECT * FROM proposals WHERE id = ? AND tenant_id = ?", (prop_id, tenant_id)).fetchone()
                if not prop:
                    self._send_json(404, {"ok": False, "error": "Proposta não encontrada."})
                    return
                prop_dict = dict(prop)
                tenant = dict(conn.execute("SELECT * FROM tenants WHERE id = ?", (tenant_id,)).fetchone())
                channel = str(body.get("channel", "email"))  # 'email', 'whatsapp', 'pdf'
                recipient = str(body.get("recipient") or prop_dict.get("contact_email") or prop_dict.get("contact_whatsapp") or prop_dict["client_name"])

                host_header = self.headers.get("Host", "localhost:8090")
                public_link = f"http://{host_header}/p/{prop_dict['public_token']}"

                event_type = "enviada_email"
                meta: Dict[str, Any] = {"link": public_link}

                if channel == "whatsapp":
                    event_type = "enviada_whatsapp"
                    msg_tpl = parse_json_field(tenant.get("default_messages_json"), {}).get(
                        "whatsapp_proposal",
                        "Olá {cliente}! Segue o link seguro da proposta comercial #{numero} para a *{empresa}*: {link}",
                    )
                    formatted_msg = (
                        msg_tpl.replace("{cliente}", prop_dict["client_name"])
                        .replace("{empresa}", prop_dict["company_name"])
                        .replace("{numero}", prop_dict["proposal_number"])
                        .replace("{escritorio}", tenant.get("trade_name") or tenant["name"])
                        .replace("{link}", public_link)
                    )
                    meta["whatsapp_message"] = formatted_msg
                elif channel == "pdf":
                    event_type = "pdf_gerado"
                else:
                    # Envio por E-mail Transacional (com suporte a SMTP real se configurado no tenant)
                    smtp_cfg = parse_json_field(tenant.get("smtp_config_json"), {})
                    if smtp_cfg.get("host") and smtp_cfg.get("user") and smtp_cfg.get("password"):
                        try:
                            msg = EmailMessage()
                            msg["Subject"] = f"Proposta Comercial #{prop_dict['proposal_number']} — {tenant.get('trade_name') or tenant['name']}"
                            msg["From"] = smtp_cfg["user"]
                            msg["To"] = recipient
                            msg.set_content(f"Olá {prop_dict['client_name']},\n\nAcesse sua proposta em: {public_link}")
                            with smtplib.SMTP(smtp_cfg["host"], int(smtp_cfg.get("port", 587)), timeout=5) as s:
                                s.starttls()
                                s.login(smtp_cfg["user"], smtp_cfg["password"])
                                s.send_message(msg)
                            meta["provider"] = "SMTP Configurado"
                        except Exception as ex:
                            event_type = "falha_envio"
                            meta["error"] = str(ex)
                    else:
                        meta["provider"] = "Disparo Transacional Registrado (Modo Simulado/Log)"

                if event_type != "falha_envio" and prop_dict["status"] == "Rascunho":
                    conn.execute(
                        "UPDATE proposals SET status = 'Enviada', sent_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
                        (prop_id,),
                    )
                    if prop_dict.get("opportunity_id"):
                        sent_stage = get_stage_by_slug(conn, tenant_id, "proposta_enviada")
                        if sent_stage:
                            move_opportunity_stage_internal(
                                conn,
                                tenant_id,
                                prop_dict["opportunity_id"],
                                sent_stage["id"],
                                user_id,
                                f"Proposta #{prop_dict['proposal_number']} enviada via {channel.upper()} para {recipient}.",
                                potential_value=float(prop_dict["monthly_fee_final"]),
                            )

                conn.execute(
                    """
                    INSERT INTO proposal_events (id, tenant_id, proposal_id, event_type, channel, recipient, metadata_json)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (f"pev_{secrets.token_hex(6)}", tenant_id, prop_id, event_type, channel.upper(), recipient, json.dumps(meta, ensure_ascii=False)),
                )
                conn.commit()
                self._send_json(200, {"ok": True, "eventType": event_type, "publicLink": public_link, "meta": meta})
                return

            # 11. Alterar Status da Proposta ou Registrar Aceite Interno
            if path.startswith("/api/proposals/") and path.endswith("/status"):
                prop_id = path.split("/")[3]
                prop = conn.execute("SELECT * FROM proposals WHERE id = ? AND tenant_id = ?", (prop_id, tenant_id)).fetchone()
                if not prop:
                    self._send_json(404, {"ok": False, "error": "Proposta não encontrada."})
                    return
                prop_dict = dict(prop)
                new_status = str(body.get("status", "Enviada"))

                if new_status == "Aceita":
                    resp_name = str(body.get("accepted_by_name") or prop_dict["client_name"])
                    resp_doc = str(body.get("accepted_by_document") or prop_dict.get("cpf_cnpj") or "Confirmado")
                    resp_role = str(body.get("accepted_by_role") or "Sócio / Administrador")
                    resp_email = str(body.get("accepted_by_email") or prop_dict.get("contact_email") or "")
                    conn.execute(
                        """
                        UPDATE proposals
                        SET status = 'Aceita', accepted_at = datetime('now'),
                            accepted_by_name = ?, accepted_by_document = ?, accepted_by_role = ?,
                            accepted_by_email = ?, accepted_ip = '127.0.0.1', accepted_version = current_version,
                            updated_at = datetime('now')
                        WHERE id = ? AND tenant_id = ?
                        """,
                        (resp_name, resp_doc, resp_role, resp_email, prop_id, tenant_id),
                    )
                    if prop_dict.get("opportunity_id"):
                        won_stage = get_stage_by_slug(conn, tenant_id, "ganho")
                        if won_stage:
                            move_opportunity_stage_internal(
                                conn,
                                tenant_id,
                                prop_dict["opportunity_id"],
                                won_stage["id"],
                                user_id,
                                f"Aceite comercial registrado na Proposta #{prop_dict['proposal_number']} ({resp_name}).",
                                potential_value=float(prop_dict["monthly_fee_final"]),
                            )
                else:
                    conn.execute(
                        "UPDATE proposals SET status = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?",
                        (new_status, prop_id, tenant_id),
                    )
                    if prop_dict.get("opportunity_id"):
                        if new_status in ("Visualizada", "Em negociação"):
                            neg_stage = get_stage_by_slug(conn, tenant_id, "negociacao")
                            if neg_stage:
                                move_opportunity_stage_internal(conn, tenant_id, prop_dict["opportunity_id"], neg_stage["id"], user_id, f"Proposta em status: {new_status}")
                        elif new_status == "Recusada":
                            lost_stage = get_stage_by_slug(conn, tenant_id, "perdido")
                            if lost_stage:
                                move_opportunity_stage_internal(conn, tenant_id, prop_dict["opportunity_id"], lost_stage["id"], user_id, "Proposta recusada pelo cliente.")

                conn.execute(
                    """
                    INSERT INTO proposal_events (id, tenant_id, proposal_id, event_type, channel, recipient, metadata_json)
                    VALUES (?, ?, ?, 'status_alterado', 'Sistema', ?, ?)
                    """,
                    (f"pev_{secrets.token_hex(6)}", tenant_id, prop_id, ctx["name"], json.dumps({"new_status": new_status}, ensure_ascii=False)),
                )
                conn.commit()
                self._send_json(200, {"ok": True, "status": new_status})
                return

            # 12. Cadastrar Lead / Oportunidade no CRM
            if path == "/api/crm/opportunities":
                opp_id = f"opp_{secrets.token_hex(6)}"
                stage_id = body.get("stage_id")
                if not stage_id:
                    first_stg = conn.execute("SELECT id FROM pipeline_stages WHERE tenant_id = ? ORDER BY stage_order ASC LIMIT 1", (tenant_id,)).fetchone()
                    stage_id = first_stg["id"]

                contact_name = str(body.get("contact_name") or "Contato").strip()
                company_name = str(body.get("company_name") or contact_name).strip()
                cpf_cnpj = str(body.get("cpf_cnpj") or "").strip()
                email = str(body.get("email") or "").strip()
                whatsapp = str(body.get("whatsapp") or "").strip()
                city = str(body.get("city") or "").strip()
                state = str(body.get("state") or "SP").strip()

                # Vincula ou cria cliente sem duplicação
                cli_row = None
                if cpf_cnpj:
                    cli_row = conn.execute("SELECT id FROM clients WHERE tenant_id = ? AND cpf_cnpj = ? LIMIT 1", (tenant_id, cpf_cnpj)).fetchone()
                if not cli_row:
                    cli_row = conn.execute("SELECT id FROM clients WHERE tenant_id = ? AND company_name = ? LIMIT 1", (tenant_id, company_name)).fetchone()

                if cli_row:
                    client_id = cli_row["id"]
                else:
                    client_id = f"cli_{secrets.token_hex(6)}"
                    conn.execute(
                        """
                        INSERT INTO clients (
                            id, tenant_id, contact_name, company_name, cpf_cnpj, email, whatsapp,
                            city, state, tax_regime, economic_activity, monthly_revenue,
                            employees_count, partners_count, branches_count, current_accountant
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            client_id,
                            tenant_id,
                            contact_name,
                            company_name,
                            cpf_cnpj,
                            email,
                            whatsapp,
                            city,
                            state,
                            str(body.get("current_tax_regime", "simples")),
                            str(body.get("economic_activity", "servicos")),
                            float(body.get("estimated_revenue", 50000.0)),
                            int(body.get("employees_count", 2)),
                            int(body.get("partners_count", 1)),
                            int(body.get("branches_count", 0)),
                            str(body.get("current_accountant", "")),
                        ),
                    )

                conn.execute(
                    """
                    INSERT INTO opportunities (
                        id, tenant_id, client_id, stage_id, owner_user_id, contact_name, company_name,
                        cpf_cnpj, email, whatsapp, city, state, lead_origin, hiring_type,
                        service_interest, estimated_revenue, current_tax_regime, economic_activity,
                        employees_count, partners_count, branches_count, invoice_volume_index,
                        current_accountant, expected_close_date, potential_monthly_value,
                        next_action, next_action_date, status, notes
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'aberta', ?)
                    """,
                    (
                        opp_id,
                        tenant_id,
                        client_id,
                        stage_id,
                        body.get("owner_user_id") or user_id,
                        contact_name,
                        company_name,
                        cpf_cnpj,
                        email,
                        whatsapp,
                        city,
                        state,
                        str(body.get("lead_origin", "Indicação")),
                        str(body.get("hiring_type", "Troca de contador")),
                        str(body.get("service_interest", "Assessoria Contábil Completa")),
                        float(body.get("estimated_revenue", 50000.0)),
                        str(body.get("current_tax_regime", "simples")),
                        str(body.get("economic_activity", "servicos")),
                        int(body.get("employees_count", 2)),
                        int(body.get("partners_count", 1)),
                        int(body.get("branches_count", 0)),
                        int(body.get("invoice_volume_index", 1)),
                        str(body.get("current_accountant", "")),
                        str(body.get("expected_close_date") or (datetime.now() + timedelta(days=10)).strftime("%Y-%m-%d")),
                        float(body.get("potential_monthly_value", 0.0)),
                        str(body.get("next_action") or "Realizar diagnóstico comercial"),
                        str(body.get("next_action_date") or (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")),
                        str(body.get("notes", "")),
                    ),
                )

                conn.execute(
                    """
                    INSERT INTO opportunity_stage_history (id, tenant_id, opportunity_id, from_stage_id, to_stage_id, changed_by_user_id, notes)
                    VALUES (?, ?, ?, NULL, ?, ?, 'Lead cadastrado no CRM.')
                    """,
                    (f"osh_{secrets.token_hex(6)}", tenant_id, opp_id, stage_id, user_id),
                )
                log_audit(conn, tenant_id, user_id, "CREATE_OPPORTUNITY", "opportunity", opp_id, {"company": company_name})
                conn.commit()
                self._send_json(201, {"ok": True, "id": opp_id, "clientId": client_id})
                return

            # 13. Mover Oportunidade no Pipeline Kanban (Drag-and-Drop)
            if path.startswith("/api/crm/opportunities/") and path.endswith("/move"):
                opp_id = path.split("/")[4]
                target_stage_id = str(body.get("stage_id", ""))
                loss_reason_id = body.get("loss_reason_id")
                notes = str(body.get("notes", "Movimentação no Pipeline Kanban"))

                move_opportunity_stage_internal(
                    conn,
                    tenant_id,
                    opp_id,
                    target_stage_id,
                    user_id,
                    notes=notes,
                    loss_reason_id=loss_reason_id,
                )
                conn.commit()
                self._send_json(200, {"ok": True})
                return

            # 14. Salvar Diagnóstico Comercial Contábil (alimenta automaticamente Oportunidade e Calculadora)
            if path.startswith("/api/crm/opportunities/") and path.endswith("/diagnostic"):
                opp_id = path.split("/")[4]
                existing = conn.execute(
                    "SELECT id FROM commercial_diagnostics WHERE opportunity_id = ? AND tenant_id = ?",
                    (opp_id, tenant_id),
                ).fetchone()
                diag_id = existing["id"] if existing else f"diag_{secrets.token_hex(6)}"

                tax_regime = str(body.get("tax_regime", "simples"))
                activity = str(body.get("economic_activity", "servicos"))
                revenue = float(body.get("monthly_revenue", 50000.0))
                vol_idx = int(body.get("invoice_volume_index", 1))
                employees = int(body.get("employees_count", 2))
                partners = int(body.get("partners_count", 1))
                branches = int(body.get("branches_count", 0))
                complexity = str(body.get("operational_complexity", "padrao"))
                obligations = body.get("specific_obligations") or {}
                desired_services = body.get("desired_services") or {}
                custom_answers = body.get("custom_answers") or {}

                conn.execute(
                    """
                    INSERT OR REPLACE INTO commercial_diagnostics (
                        id, tenant_id, opportunity_id, client_need, current_situation,
                        tax_regime, economic_activity, monthly_revenue, invoice_volume_index,
                        employees_count, partners_count, branches_count,
                        specific_obligations_json, desired_services_json,
                        accountant_pains, urgency_level, operational_complexity,
                        custom_answers_json, created_by, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                    """,
                    (
                        diag_id,
                        tenant_id,
                        opp_id,
                        str(body.get("client_need", "")),
                        str(body.get("current_situation", "")),
                        tax_regime,
                        activity,
                        revenue,
                        vol_idx,
                        employees,
                        partners,
                        branches,
                        json.dumps(obligations, ensure_ascii=False),
                        json.dumps(desired_services, ensure_ascii=False),
                        str(body.get("accountant_pains", "")),
                        str(body.get("urgency_level", "Média")),
                        complexity,
                        json.dumps(custom_answers, ensure_ascii=False),
                        ctx["name"],
                    ),
                )

                # Atualiza os dados operacionais da oportunidade e avança etapa para Diagnóstico Comercial se estava antes
                conn.execute(
                    """
                    UPDATE opportunities
                    SET current_tax_regime = ?,
                        economic_activity = ?,
                        estimated_revenue = ?,
                        invoice_volume_index = ?,
                        employees_count = ?,
                        partners_count = ?,
                        branches_count = ?,
                        updated_at = datetime('now')
                    WHERE id = ? AND tenant_id = ?
                    """,
                    (tax_regime, activity, revenue, vol_idx, employees, partners, branches, opp_id, tenant_id),
                )

                diag_stage = get_stage_by_slug(conn, tenant_id, "diagnostico")
                opp_row = conn.execute("SELECT stage_id FROM opportunities WHERE id = ? AND tenant_id = ?", (opp_id, tenant_id)).fetchone()
                if opp_row and diag_stage:
                    cur_stg = conn.execute("SELECT stage_order FROM pipeline_stages WHERE id = ?", (opp_row["stage_id"],)).fetchone()
                    if cur_stg and cur_stg["stage_order"] < diag_stage["stage_order"]:
                        move_opportunity_stage_internal(
                            conn,
                            tenant_id,
                            opp_id,
                            diag_stage["id"],
                            user_id,
                            "Diagnóstico comercial contábil preenchido.",
                        )

                conn.commit()
                self._send_json(200, {"ok": True, "diagnosticId": diag_id})
                return

            # 15. Criar Atividade / Follow-up no CRM
            if path == "/api/crm/activities":
                act_id = f"act_{secrets.token_hex(6)}"
                opp_id = str(body.get("opportunity_id", ""))
                atype = str(body.get("activity_type", "tarefa"))
                title = str(body.get("title", "Follow-up comercial")).strip()
                desc = str(body.get("description", ""))
                due_date = str(body.get("due_date") or datetime.now().strftime("%Y-%m-%d"))

                conn.execute(
                    """
                    INSERT INTO crm_activities (id, tenant_id, opportunity_id, assigned_user_id, activity_type, title, description, due_date, completed)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
                    """,
                    (act_id, tenant_id, opp_id, body.get("assigned_user_id") or user_id, atype, title, desc, due_date),
                )

                # Atualiza a próxima ação na oportunidade
                conn.execute(
                    "UPDATE opportunities SET next_action = ?, next_action_date = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?",
                    (title, due_date, opp_id, tenant_id),
                )
                conn.commit()
                self._send_json(201, {"ok": True, "id": act_id})
                return

            # 16. Cadastrar Usuário no Escritório
            if path == "/api/users":
                if user_role not in ("admin_plataforma", "admin_escritorio"):
                    self._send_json(403, {"ok": False, "error": "Sem permissão para gerenciar usuários."})
                    return
                uid = f"usr_{secrets.token_hex(5)}"
                name = str(body.get("name", "")).strip()
                email = str(body.get("email", "")).strip().lower()
                role = str(body.get("role", "vendedor"))
                max_disc = float(body.get("max_discount_pct", 8.0))
                pwd = str(body.get("password") or "mudar123")

                conn.execute(
                    """
                    INSERT INTO users (id, tenant_id, name, email, password_hash, role, max_discount_pct, lgpd_consent_at, active)
                    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), 1)
                    """,
                    (uid, tenant_id, name, email, hash_password(pwd), role, max_disc),
                )
                log_audit(conn, tenant_id, user_id, "CREATE_USER", "user", uid, {"name": name, "role": role})
                conn.commit()
                self._send_json(201, {"ok": True, "id": uid})
                return

            # 17. Cadastrar Motivo de Perda
            if path == "/api/crm/loss-reasons":
                lid = f"loss_{secrets.token_hex(5)}"
                conn.execute(
                    "INSERT INTO loss_reasons (id, tenant_id, name, description, is_active) VALUES (?, ?, ?, ?, 1)",
                    (lid, tenant_id, str(body.get("name", "")).strip(), str(body.get("description", ""))),
                )
                conn.commit()
                self._send_json(201, {"ok": True, "id": lid})
                return

            # 18. Cadastrar Etapa do Pipeline
            if path == "/api/crm/stages":
                sid = f"stg_{secrets.token_hex(5)}"
                max_ord = conn.execute("SELECT COALESCE(MAX(stage_order), 0) AS m FROM pipeline_stages WHERE tenant_id = ?", (tenant_id,)).fetchone()["m"]
                name = str(body.get("name", "Nova Etapa")).strip()
                slug = name.lower().replace(" ", "_")[:20]
                conn.execute(
                    "INSERT INTO pipeline_stages (id, tenant_id, slug, name, stage_order, color, win_probability, is_won, is_lost) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0)",
                    (sid, tenant_id, slug, name, int(max_ord) + 1, str(body.get("color", "#C9A227")), int(body.get("win_probability", 50))),
                )
                conn.commit()
                self._send_json(201, {"ok": True, "id": sid})
                return

            self._send_json(404, {"ok": False, "error": f"Endpoint POST não encontrado: {path}"})
        finally:
            conn.close()

    # =========================================================================
    # HANDLERS PUT DA API
    # =========================================================================
    def _handle_api_put(self, path: str) -> None:
        body = self._read_json_body()
        conn = get_connection()
        try:
            ctx = self._get_auth_context(conn)
            tenant_id = ctx["tenant_id"]
            user_id = ctx["user_id"]

            # 1. Atualizar Proposta Comercial (Gera Nova Versão Histórica automaticamente!)
            if path.startswith("/api/proposals/"):
                prop_id = path.split("/")[3]
                prop = conn.execute("SELECT * FROM proposals WHERE id = ? AND tenant_id = ?", (prop_id, tenant_id)).fetchone()
                if not prop:
                    self._send_json(404, {"ok": False, "error": "Proposta não encontrada."})
                    return
                prop_dict = dict(prop)
                new_ver = int(prop_dict["current_version"]) + 1

                monthly_base = float(body.get("monthly_fee_base", prop_dict["monthly_fee_base"]))
                disc_pct = float(body.get("discount_pct", prop_dict["discount_pct"]))
                disc_amount = round(monthly_base * (disc_pct / 100.0), 2)
                monthly_final = float(body.get("monthly_fee_final") or max(0.0, monthly_base - disc_amount))
                setup_fee = float(body.get("setup_fee", prop_dict["setup_fee"]))
                one_off_total = float(body.get("one_off_total", prop_dict["one_off_total"]))

                conn.execute(
                    """
                    UPDATE proposals
                    SET current_version = ?,
                        client_name = ?,
                        company_name = ?,
                        cpf_cnpj = ?,
                        contact_email = ?,
                        contact_whatsapp = ?,
                        plan_name = ?,
                        monthly_fee_base = ?,
                        discount_pct = ?,
                        discount_amount = ?,
                        monthly_fee_final = ?,
                        setup_fee = ?,
                        one_off_total = ?,
                        payment_conditions = ?,
                        valid_until = ?,
                        cover_title = ?,
                        office_presentation = ?,
                        differentials_text = ?,
                        technical_scope_text = ?,
                        next_steps_text = ?,
                        updated_at = datetime('now')
                    WHERE id = ? AND tenant_id = ?
                    """,
                    (
                        new_ver,
                        str(body.get("client_name", prop_dict["client_name"])),
                        str(body.get("company_name", prop_dict["company_name"])),
                        str(body.get("cpf_cnpj", prop_dict["cpf_cnpj"])),
                        str(body.get("contact_email", prop_dict["contact_email"])),
                        str(body.get("contact_whatsapp", prop_dict["contact_whatsapp"])),
                        str(body.get("plan_name", prop_dict["plan_name"])),
                        monthly_base,
                        disc_pct,
                        disc_amount,
                        monthly_final,
                        setup_fee,
                        one_off_total,
                        str(body.get("payment_conditions", prop_dict["payment_conditions"])),
                        str(body.get("valid_until", prop_dict["valid_until"])),
                        str(body.get("cover_title", prop_dict["cover_title"])),
                        str(body.get("office_presentation", prop_dict["office_presentation"])),
                        str(body.get("differentials_text", prop_dict["differentials_text"])),
                        str(body.get("technical_scope_text", prop_dict["technical_scope_text"])),
                        str(body.get("next_steps_text", prop_dict["next_steps_text"])),
                        prop_id,
                        tenant_id,
                    ),
                )

                conn.execute(
                    """
                    INSERT INTO proposal_versions (
                        id, tenant_id, proposal_id, version_number, monthly_fee_base,
                        discount_pct, monthly_fee_final, setup_fee, one_off_total, snapshot_json, created_by
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        f"pv_{prop_id}_v{new_ver}_{secrets.token_hex(2)}",
                        tenant_id,
                        prop_id,
                        new_ver,
                        monthly_base,
                        disc_pct,
                        monthly_final,
                        setup_fee,
                        one_off_total,
                        json.dumps(body, ensure_ascii=False),
                        ctx["name"],
                    ),
                )

                conn.execute(
                    """
                    INSERT INTO proposal_events (id, tenant_id, proposal_id, event_type, channel, recipient, metadata_json)
                    VALUES (?, ?, ?, 'nova_versao', 'Editor', ?, ?)
                    """,
                    (f"pev_{secrets.token_hex(6)}", tenant_id, prop_id, ctx["name"], json.dumps({"version": new_ver}, ensure_ascii=False)),
                )
                conn.commit()
                self._send_json(200, {"ok": True, "version": new_ver})
                return

            # 2. Concluir / Reabrir Atividade do CRM
            if path.startswith("/api/crm/activities/") and path.endswith("/toggle"):
                act_id = path.split("/")[4]
                act = conn.execute("SELECT completed FROM crm_activities WHERE id = ? AND tenant_id = ?", (act_id, tenant_id)).fetchone()
                if not act:
                    self._send_json(404, {"ok": False, "error": "Atividade não encontrada."})
                    return
                new_comp = 0 if act["completed"] else 1
                conn.execute(
                    "UPDATE crm_activities SET completed = ?, completed_at = CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END WHERE id = ? AND tenant_id = ?",
                    (new_comp, new_comp, act_id, tenant_id),
                )
                conn.commit()
                self._send_json(200, {"ok": True, "completed": bool(new_comp)})
                return

            # 3. Atualizar Oportunidade do CRM
            if path.startswith("/api/crm/opportunities/"):
                opp_id = path.split("/")[4]
                conn.execute(
                    """
                    UPDATE opportunities
                    SET contact_name = COALESCE(?, contact_name),
                        company_name = COALESCE(?, company_name),
                        cpf_cnpj = COALESCE(?, cpf_cnpj),
                        email = COALESCE(?, email),
                        whatsapp = COALESCE(?, whatsapp),
                        city = COALESCE(?, city),
                        state = COALESCE(?, state),
                        lead_origin = COALESCE(?, lead_origin),
                        hiring_type = COALESCE(?, hiring_type),
                        service_interest = COALESCE(?, service_interest),
                        estimated_revenue = COALESCE(?, estimated_revenue),
                        current_tax_regime = COALESCE(?, current_tax_regime),
                        economic_activity = COALESCE(?, economic_activity),
                        employees_count = COALESCE(?, employees_count),
                        partners_count = COALESCE(?, partners_count),
                        branches_count = COALESCE(?, branches_count),
                        current_accountant = COALESCE(?, current_accountant),
                        potential_monthly_value = COALESCE(?, potential_monthly_value),
                        next_action = COALESCE(?, next_action),
                        next_action_date = COALESCE(?, next_action_date),
                        notes = COALESCE(?, notes),
                        updated_at = datetime('now')
                    WHERE id = ? AND tenant_id = ?
                    """,
                    (
                        body.get("contact_name"),
                        body.get("company_name"),
                        body.get("cpf_cnpj"),
                        body.get("email"),
                        body.get("whatsapp"),
                        body.get("city"),
                        body.get("state"),
                        body.get("lead_origin"),
                        body.get("hiring_type"),
                        body.get("service_interest"),
                        body.get("estimated_revenue"),
                        body.get("current_tax_regime"),
                        body.get("economic_activity"),
                        body.get("employees_count"),
                        body.get("partners_count"),
                        body.get("branches_count"),
                        body.get("current_accountant"),
                        body.get("potential_monthly_value"),
                        body.get("next_action"),
                        body.get("next_action_date"),
                        body.get("notes"),
                        opp_id,
                        tenant_id,
                    ),
                )
                conn.commit()
                self._send_json(200, {"ok": True})
                return

            # 4. Atualizar Configurações do Escritório (Identidade Visual, Dados, Mensagens, E-mail, Modelo de Proposta)
            if path == "/api/settings":
                conn.execute(
                    """
                    UPDATE tenants
                    SET name = COALESCE(?, name),
                        trade_name = COALESCE(?, trade_name),
                        cnpj = COALESCE(?, cnpj),
                        crc_registration = COALESCE(?, crc_registration),
                        email = COALESCE(?, email),
                        phone = COALESCE(?, phone),
                        whatsapp = COALESCE(?, whatsapp),
                        city = COALESCE(?, city),
                        state = COALESCE(?, state),
                        address = COALESCE(?, address),
                        website = COALESCE(?, website),
                        logo_url = COALESCE(?, logo_url),
                        primary_color = COALESCE(?, primary_color),
                        secondary_color = COALESCE(?, secondary_color),
                        commercial_signature = COALESCE(?, commercial_signature),
                        smtp_config_json = COALESCE(?, smtp_config_json),
                        integrations_json = COALESCE(?, integrations_json),
                        default_messages_json = COALESCE(?, default_messages_json),
                        custom_diagnostic_questions_json = COALESCE(?, custom_diagnostic_questions_json),
                        updated_at = datetime('now')
                    WHERE id = ?
                    """,
                    (
                        body.get("name"),
                        body.get("trade_name"),
                        body.get("cnpj"),
                        body.get("crc_registration"),
                        body.get("email"),
                        body.get("phone"),
                        body.get("whatsapp"),
                        body.get("city"),
                        body.get("state"),
                        body.get("address"),
                        body.get("website"),
                        body.get("logo_url"),
                        body.get("primary_color"),
                        body.get("secondary_color"),
                        body.get("commercial_signature"),
                        json.dumps(body["smtp_config"], ensure_ascii=False) if "smtp_config" in body else None,
                        json.dumps(body["integrations"], ensure_ascii=False) if "integrations" in body else None,
                        json.dumps(body["default_messages"], ensure_ascii=False) if "default_messages" in body else None,
                        json.dumps(body["custom_diagnostic_questions"], ensure_ascii=False) if "custom_diagnostic_questions" in body else None,
                        tenant_id,
                    ),
                )
                if "proposal_template" in body and isinstance(body["proposal_template"], dict):
                    pt = body["proposal_template"]
                    conn.execute(
                        """
                        UPDATE proposal_templates
                        SET cover_title = COALESCE(?, cover_title),
                            office_presentation = COALESCE(?, office_presentation),
                            differentials_text = COALESCE(?, differentials_text),
                            scope_template = COALESCE(?, scope_template),
                            next_steps_text = COALESCE(?, next_steps_text),
                            payment_terms_default = COALESCE(?, payment_terms_default),
                            validity_days_default = COALESCE(?, validity_days_default)
                        WHERE tenant_id = ? AND is_default = 1
                        """,
                        (
                            pt.get("cover_title"),
                            pt.get("office_presentation"),
                            pt.get("differentials_text"),
                            pt.get("scope_template"),
                            pt.get("next_steps_text"),
                            pt.get("payment_terms_default"),
                            pt.get("validity_days_default"),
                            tenant_id,
                        ),
                    )
                log_audit(conn, tenant_id, user_id, "UPDATE_SETTINGS", "tenant", tenant_id, {"updated": list(body.keys())})
                conn.commit()
                self._send_json(200, {"ok": True})
                return

            self._send_json(404, {"ok": False, "error": f"Endpoint PUT não encontrado: {path}"})
        finally:
            conn.close()

    # =========================================================================
    # HANDLERS DELETE DA API
    # =========================================================================
    def _handle_api_delete(self, path: str) -> None:
        conn = get_connection()
        try:
            ctx = self._get_auth_context(conn)
            tenant_id = ctx["tenant_id"]

            if path.startswith("/api/plans-services/"):
                ps_id = path.split("/")[3]
                conn.execute("UPDATE plans_services SET is_active = 0 WHERE id = ? AND tenant_id = ?", (ps_id, tenant_id))
                conn.commit()
                self._send_json(200, {"ok": True})
                return

            if path.startswith("/api/simulations/"):
                sim_id = path.split("/")[3]
                conn.execute("DELETE FROM simulations WHERE id = ? AND tenant_id = ?", (sim_id, tenant_id))
                conn.commit()
                self._send_json(200, {"ok": True})
                return

            if path.startswith("/api/crm/opportunities/"):
                opp_id = path.split("/")[4]
                conn.execute("DELETE FROM commercial_diagnostics WHERE opportunity_id = ? AND tenant_id = ?", (opp_id, tenant_id))
                conn.execute("DELETE FROM opportunity_stage_history WHERE opportunity_id = ? AND tenant_id = ?", (opp_id, tenant_id))
                conn.execute("DELETE FROM crm_activities WHERE opportunity_id = ? AND tenant_id = ?", (opp_id, tenant_id))
                conn.execute("DELETE FROM opportunities WHERE id = ? AND tenant_id = ?", (opp_id, tenant_id))
                log_audit(conn, tenant_id, ctx["user_id"], "DELETE_LEAD", "opportunity", opp_id, {})
                conn.commit()
                self._send_json(200, {"ok": True, "deletedId": opp_id})
                return

            if path == "/api/crm/opportunities":
                conn.execute("DELETE FROM commercial_diagnostics WHERE tenant_id = ?", (tenant_id,))
                conn.execute("DELETE FROM opportunity_stage_history WHERE tenant_id = ?", (tenant_id,))
                conn.execute("DELETE FROM crm_activities WHERE tenant_id = ?", (tenant_id,))
                conn.execute("DELETE FROM opportunities WHERE tenant_id = ?", (tenant_id,))
                log_audit(conn, tenant_id, ctx["user_id"], "CLEAR_ALL_LEADS", "opportunity", tenant_id, {})
                conn.commit()
                self._send_json(200, {"ok": True})
                return

            self._send_json(404, {"ok": False, "error": f"Endpoint DELETE não encontrado: {path}"})
        finally:
            conn.close()


def run_server(port: int = 8090) -> None:
    init_db()
    server = ThreadingHTTPServer(("0.0.0.0", port), SaaSContabilRequestHandler)
    print(f"[SaaS Contabil] Plataforma rodando em http://localhost:{port}")
    server.serve_forever()


if __name__ == "__main__":
    port_arg = int(os.environ.get("PORT", "8090"))
    run_server(port_arg)
