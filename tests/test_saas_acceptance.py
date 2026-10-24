"""
Suíte de Testes Automatizados e Homologação E2E (Fase 7)
Valida:
1. Fórmulas Originais (Paridade 100% Python + C# PricingEngine.exe conforme NBC PG 01 e Res. CFC 1.590/2020)
2. Isolamento Multi-Tenant entre Escritórios (Tenant Alpha vs Tenant Beta)
3. Controle de Acesso Baseado em Perfis (RBAC: Admin, Gestor, Vendedor)
4. Os 10 Critérios de Aceite Obrigatórios (Fluxo Completo: Lead -> Diagnóstico -> Calculadora -> Proposta -> Envio -> Visualização -> Aceite -> Ganho -> Indicadores)
"""

import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

# Usa banco temporário isolado para o teste E2E além de inicializar o banco principal
TEST_DB_PATH = os.path.join(tempfile.gettempdir(), f"test_saas_contabil_{int(time.time())}.db")
os.environ["SAAS_DB_PATH"] = TEST_DB_PATH

from backend.database import init_db
from backend.pricing_engine import CSHARP_EXE_PATH, calculate_honorarios
from backend.server import SaaSContabilRequestHandler


class TestSaaSContabilPlatform(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        init_db(TEST_DB_PATH)
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), SaaSContabilRequestHandler)
        cls.port = cls.server.server_address[1]
        cls.base_url = f"http://127.0.0.1:{cls.port}"
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()

    def _req(self, method: str, path: str, body: dict = None, token: str = None, tenant_id: str = "tenant_alpha") -> tuple:
        url = f"{self.base_url}{path}"
        headers = {
            "Content-Type": "application/json",
            "X-Tenant-ID": tenant_id,
        }
        if token:
            headers["Authorization"] = f"Bearer {token}"
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req) as resp:
                raw = resp.read().decode("utf-8")
                try:
                    return resp.status, json.loads(raw)
                except Exception:
                    return resp.status, raw
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8")
            try:
                return e.code, json.loads(raw)
            except Exception:
                return e.code, raw

    def test_01_original_formulas_and_csharp_engine_parity(self) -> None:
        """Testa as fórmulas originais exatas auditadas do sistema Replit e paridade com o motor C#."""
        # Cenário padrão: custoFixo=28000, horasProdutivas=320, margem=30%, simples, servicos, fat=50000, 2 func, 1 socio, vol=1
        res = calculate_honorarios(
            {
                "custoFixo": 28000,
                "horasProdutivas": 320,
                "margem": 30,
                "regime": "simples",
                "atividade": "servicos",
                "faturamento": 50000,
                "funcionarios": 2,
                "socios": 1,
                "filiais": 0,
                "volume": 1,
                "obrigacoes": {},
                "avulsos": {},
                "precoPretendido": 0,
            },
            use_csharp_engine=True,
        )
        self.assertAlmostEqual(res["custoHora"], 87.50, places=2)
        self.assertAlmostEqual(res["horaTecnica"], 113.75, places=2)
        self.assertAlmostEqual(res["horasTotais"], 5.90, places=2)
        self.assertAlmostEqual(res["piso"], 516.25, places=2)
        self.assertAlmostEqual(res["sugerido"], 671.12, places=1)
        self.assertTrue(res["csharpEngineVerified"])

        # Testa alerta de aviltamento (< piso 516.25)
        res_avilt = calculate_honorarios({"precoPretendido": 450})
        self.assertEqual(res_avilt["status"], "aviltamento")

        # Testa alerta de compressão de margem (< sugerido * 0.92)
        res_abaixo = calculate_honorarios({"precoPretendido": 550})
        self.assertEqual(res_abaixo["status"], "abaixo")

        # Testa execução direta do binário C# PricingEngine.exe
        self.assertTrue(os.path.exists(CSHARP_EXE_PATH))
        proc = subprocess.run([CSHARP_EXE_PATH, "--self-test"], capture_output=True, text=True, timeout=5)
        self.assertEqual(proc.returncode, 0)
        cs_out = json.loads(proc.stdout)
        self.assertTrue(cs_out["selfTestPassed"])

    def test_02_full_10_acceptance_criteria_cycle(self) -> None:
        """
        Executa os 10 Critérios de Aceite ponta-a-ponta:
        1. Parâmetros e serviços -> 2. Lead -> 3. Diagnóstico -> 4. Calculadora sem redigitação ->
        5. Proposta personalizada + versionamento -> 6. Envio -> 7. Acompanhamento CRM ->
        8. Aceite comercial -> 9. Oportunidade Ganha -> 10. Indicadores comerciais.
        """
        # Login como Admin do Escritório Alpha
        st, login_res = self._req("POST", "/api/auth/login", {"email": "helena@alphacontabil.cnt.br", "password": "admin123"})
        self.assertEqual(st, 200)
        token = login_res["token"]

        # CRITÉRIO 1: Cadastrar parâmetros versionados e serviço sem preço fixo
        st, param_get = self._req("GET", "/api/parameters", token=token)
        self.assertEqual(st, 200)
        pv = param_get["activeVersion"]

        st, new_pv = self._req(
            "POST",
            "/api/parameters/versions",
            {
                "fixed_cost_monthly": 28000,
                "productive_hours_monthly": 320,
                "target_margin_pct": 30,
                "minimum_fee_floor": 400,
                "version_label": "v2.0 — Homologação Automatizada",
                "department_costs": pv["department_costs"],
                "regimes": pv["regimes"],
                "activities": pv["activities"],
                "invoice_brackets": pv["invoice_brackets"],
                "revenue_brackets": pv["revenue_brackets"],
                "accessories": pv["accessories"],
                "complexity_levels": pv["complexity_levels"],
            },
            token=token,
        )
        self.assertEqual(st, 201)
        self.assertEqual(new_pv["version_number"], 2)

        st, new_srv = self._req(
            "POST",
            "/api/plans-services",
            {
                "item_type": "servico_recorrente",
                "name": "Consultoria Tributária Mensal Custom",
                "estimated_hours": 2.0,
                "base_price": 0.0,
            },
            token=token,
        )
        self.assertEqual(st, 201)

        # CRITÉRIO 2: Cadastrar um Lead no CRM
        st, lead_res = self._req(
            "POST",
            "/api/crm/opportunities",
            {
                "company_name": "Horizonte Logística e Transportes Ltda.",
                "contact_name": "Marcos Vinícius",
                "cpf_cnpj": "66.777.888/0001-99",
                "email": "marcos@horizontelog.com.br",
                "whatsapp": "(11) 98888-1111",
                "city": "São Paulo",
                "state": "SP",
                "lead_origin": "Indicação",
                "hiring_type": "Troca de contador",
                "current_tax_regime": "presumido",
                "economic_activity": "servicos",
                "estimated_revenue": 350000,
                "employees_count": 10,
                "partners_count": 2,
            },
            token=token,
        )
        self.assertEqual(st, 201)
        opp_id = lead_res["id"]

        # CRITÉRIO 3: Realizar o Diagnóstico Comercial Contábil
        st, diag_res = self._req(
            "POST",
            f"/api/crm/opportunities/{opp_id}/diagnostic",
            {
                "client_need": "Apuração de Lucro Presumido e folha de motoristas.",
                "accountant_pains": "Erros em obrigações acessórias.",
                "tax_regime": "presumido",
                "economic_activity": "servicos",
                "monthly_revenue": 350000,
                "invoice_volume_index": 2,
                "employees_count": 10,
                "partners_count": 2,
                "branches_count": 1,
                "operational_complexity": "padrao",
                "specific_obligations": {"efdcontrib": True, "dctfweb": True},
                "desired_services": {"planejamento": {"valor": 2500}},
            },
            token=token,
        )
        self.assertEqual(st, 200)

        # Verifica que o diagnóstico alimentou a oportunidade e moveu para etapa 3 (Diagnóstico Comercial)
        st, diag_check = self._req("GET", f"/api/crm/opportunities/{opp_id}/diagnostic", token=token)
        self.assertEqual(st, 200)
        self.assertEqual(diag_check["opportunity"]["stage_id"], "stg_tenant_alpha_diagnostico")

        # CRITÉRIO 4: Calcular e salvar honorários sem redigitar informações
        opp_data = diag_check["opportunity"]
        diag_data = diag_check["diagnostic"]
        st, sim_res = self._req(
            "POST",
            "/api/simulations",
            {
                "opportunityId": opp_id,
                "clientId": opp_data["client_id"],
                "title": f"Simulação — {opp_data['company_name']}",
                "clientName": opp_data["contact_name"],
                "companyName": opp_data["company_name"],
                "cpfCnpj": opp_data["cpf_cnpj"],
                "regime": diag_data["tax_regime"],
                "atividade": diag_data["economic_activity"],
                "faturamento": diag_data["monthly_revenue"],
                "funcionarios": diag_data["employees_count"],
                "socios": diag_data["partners_count"],
                "filiais": diag_data["branches_count"],
                "volume": diag_data["invoice_volume_index"],
                "complexidade": diag_data["operational_complexity"],
                "obrigacoes": diag_data["specific_obligations"],
                "avulsos": diag_data["desired_services"],
                "taxaImplantacao": 500,
                "descontoPct": 5.0,
            },
            token=token,
        )
        self.assertEqual(st, 201)
        sim_id = sim_res["simulationId"]
        calc_out = sim_res["calculation"]
        self.assertGreater(calc_out["honorarioFinal"], calc_out["piso"])

        # Verifica que a oportunidade avançou para etapa 4 (Precificação)
        st, diag_check2 = self._req("GET", f"/api/crm/opportunities/{opp_id}/diagnostic", token=token)
        self.assertEqual(diag_check2["opportunity"]["stage_id"], "stg_tenant_alpha_precificacao")

        # CRITÉRIO 5: Gerar uma Proposta Comercial personalizada + testar versionamento (v1 -> v2)
        st, prop_res = self._req(
            "POST",
            "/api/proposals",
            {
                "opportunity_id": opp_id,
                "client_id": opp_data["client_id"],
                "simulation_id": sim_id,
                "client_name": opp_data["contact_name"],
                "company_name": opp_data["company_name"],
                "cpf_cnpj": opp_data["cpf_cnpj"],
                "contact_email": opp_data["email"],
                "contact_whatsapp": opp_data["whatsapp"],
                "services_summary": calc_out["breakdown"],
                "one_off_services": calc_out["avulsosSel"],
                "monthly_fee_base": calc_out["sugerido"],
                "discount_pct": 5.0,
                "monthly_fee_final": calc_out["honorarioFinal"],
                "setup_fee": 500.0,
                "one_off_total": calc_out["totalAvulsos"],
            },
            token=token,
        )
        self.assertEqual(st, 201)
        prop_id = prop_res["proposalId"]
        pub_token = prop_res["publicToken"]

        # Edita a proposta para gerar a Versão v2 preservando a v1
        st, edit_res = self._req(
            "PUT",
            f"/api/proposals/{prop_id}",
            {
                "monthly_fee_base": calc_out["sugerido"],
                "discount_pct": 6.0,
                "setup_fee": 450.0,
            },
            token=token,
        )
        self.assertEqual(st, 200)
        self.assertEqual(edit_res["version"], 2)

        # CRITÉRIO 6: Enviar a proposta pelo sistema e verificar sincronização para '5. Proposta Enviada'
        st, send_res = self._req("POST", f"/api/proposals/{prop_id}/send", {"channel": "email"}, token=token)
        self.assertEqual(st, 200)

        st, diag_check3 = self._req("GET", f"/api/crm/opportunities/{opp_id}/diagnostic", token=token)
        self.assertEqual(diag_check3["opportunity"]["stage_id"], "stg_tenant_alpha_proposta_enviada")

        # CRITÉRIO 7: Acompanhar visualização do cliente no link exclusivo e sincronizar para '6. Negociação'
        st_pub, html_pub = self._req("GET", f"/p/{pub_token}")
        self.assertEqual(st_pub, 200)
        self.assertIn("Horizonte Logística", html_pub)

        st, diag_check4 = self._req("GET", f"/api/crm/opportunities/{opp_id}/diagnostic", token=token)
        self.assertEqual(diag_check4["opportunity"]["stage_id"], "stg_tenant_alpha_negociacao")

        # CRITÉRIO 8 & 9: Registrar o Aceite Comercial e verificar que a oportunidade é marcada como GANHA ('7. Ganho')
        st, acc_res = self._req(
            "POST",
            f"/api/public/proposals/{pub_token}/accept",
            {
                "accepted_by_name": "Marcos Vinícius",
                "accepted_by_document": "123.456.789-00",
                "accepted_by_role": "Sócio-Diretor",
                "accepted_by_email": "marcos@horizontelog.com.br",
            },
        )
        self.assertEqual(st, 200)
        self.assertEqual(acc_res["status"], "Aceita")

        st, diag_check5 = self._req("GET", f"/api/crm/opportunities/{opp_id}/diagnostic", token=token)
        self.assertEqual(diag_check5["opportunity"]["stage_id"], "stg_tenant_alpha_ganho")
        self.assertEqual(diag_check5["opportunity"]["status"], "ganha")

        # CRITÉRIO 10: Consultar Indicadores Comerciais (MRR ganho, propostas aceitas, conversão)
        st, dash_res = self._req("GET", "/api/crm/dashboard?days=90", token=token)
        self.assertEqual(st, 200)
        self.assertGreaterEqual(dash_res["kpis"]["propostasAceitas"], 2)
        self.assertGreater(dash_res["kpis"]["mrrGanho"], 3000.0)

    def test_03_multi_tenant_isolation_and_rbac(self) -> None:
        """Garante que o Escritório Beta não enxerga dados do Escritório Alpha e valida RBAC do Vendedor."""
        st, beta_login = self._req("POST", "/api/auth/login", {"email": "gustavo@betacontabil.cnt.br", "password": "admin123"})
        self.assertEqual(st, 200)
        beta_token = beta_login["token"]

        st, beta_crm = self._req("GET", "/api/crm/pipeline", token=beta_token, tenant_id="tenant_beta")
        self.assertEqual(st, 200)
        for op in beta_crm["opportunities"]:
            self.assertEqual(op["tenant_id"], "tenant_beta")
            self.assertNotIn("Horizonte Logística", op["company_name"])

        # Login como Vendedora Mariana (Tenant Alpha) - Não pode criar nova versão de parâmetros (403)
        st, vend_login = self._req("POST", "/api/auth/login", {"email": "mariana@alphacontabil.cnt.br", "password": "admin123"})
        self.assertEqual(st, 200)
        vend_token = vend_login["token"]

        st_forbidden, _ = self._req("POST", "/api/parameters/versions", {"fixed_cost_monthly": 10000}, token=vend_token)
        self.assertEqual(st_forbidden, 403)

    def test_04_github_pages_browser_engine_and_responsive_assets(self) -> None:
        """Verifica os arquivos estáticos do GitHub Pages, o motor local browser_engine.js e o CSS adaptativo."""
        required_files = [
            os.path.join(ROOT_DIR, "index.html"),
            os.path.join(ROOT_DIR, "404.html"),
            os.path.join(ROOT_DIR, ".nojekyll"),
            os.path.join(ROOT_DIR, "browser_engine.js"),
            os.path.join(ROOT_DIR, "app.js"),
            os.path.join(ROOT_DIR, "styles.css"),
            os.path.join(ROOT_DIR, ".github", "workflows", "deploy-pages.yml"),
        ]
        for fpath in required_files:
            self.assertTrue(os.path.exists(fpath), f"Arquivo obrigatório do GitHub Pages ausente: {fpath}")

        with open(os.path.join(ROOT_DIR, "browser_engine.js"), "r", encoding="utf-8") as f:
            browser_engine_code = f.read()
        self.assertTrue("calculateHonorariosBrowser" in browser_engine_code, "calculateHonorariosBrowser missing")
        self.assertTrue("handleBrowserApiRequest" in browser_engine_code, "handleBrowserApiRequest missing")
        self.assertTrue("custoHora" in browser_engine_code, "custoHora missing")

        with open(os.path.join(ROOT_DIR, "app.js"), "r", encoding="utf-8") as f:
            app_code = f.read()
        self.assertTrue("detectScreenProfile" in app_code, "detectScreenProfile missing")
        self.assertTrue("renderPublicProposalStandaloneView" in app_code, "renderPublicProposalStandaloneView missing")
        self.assertTrue("mobile-bottom-nav" in app_code, "mobile-bottom-nav missing")

        with open(os.path.join(ROOT_DIR, "styles.css"), "r", encoding="utf-8") as f:
            css_code = f.read()
        self.assertTrue("@media (max-width: 768px)" in css_code, "mobile breakpoint missing")
        self.assertTrue("@media (min-width: 1680px)" in css_code, "ultrawide breakpoint missing")
        self.assertTrue("100dvh" in css_code, "100dvh missing")

    def test_05_hostinger_vps_readiness_and_healthcheck(self) -> None:
        """Verifica endpoints de healthcheck da Hostinger VPS e artefatos de deploy (Docker, Nginx, Systemd, Script SSH)."""
        st_health, res_health = self._req("GET", "/api/health")
        self.assertEqual(st_health, 200)
        self.assertTrue(res_health.get("ok"))
        self.assertEqual(res_health.get("status"), "healthy")

        st_hz, res_hz = self._req("GET", "/healthz")
        self.assertEqual(st_hz, 200)
        self.assertTrue(res_hz.get("ok"))

        vps_files = [
            os.path.join(ROOT_DIR, "Dockerfile"),
            os.path.join(ROOT_DIR, "docker-compose.yml"),
            os.path.join(ROOT_DIR, ".env.example"),
            os.path.join(ROOT_DIR, "deploy", "hostinger", "nginx.conf"),
            os.path.join(ROOT_DIR, "deploy", "hostinger", "saas-contabil.service"),
            os.path.join(ROOT_DIR, "deploy", "hostinger", "install_hostinger_vps.sh"),
            os.path.join(ROOT_DIR, "deploy", "hostinger", "GUIA_DEPLOY_HOSTINGER_VPS.md"),
        ]
        for fpath in vps_files:
            self.assertTrue(os.path.exists(fpath), f"Arquivo de deploy Hostinger VPS ausente: {fpath}")


if __name__ == "__main__":
    unittest.main(verbosity=2)


