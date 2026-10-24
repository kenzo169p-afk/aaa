# Plataforma SaaS de Precificação, Propostas Comerciais e CRM Contábil

Plataforma SaaS Multi-Tenant agnóstica para escritórios de contabilidade que integra todo o ciclo comercial:
**LEAD $\rightarrow$ DIAGNÓSTICO $\rightarrow$ PRECIFICAÇÃO $\rightarrow$ PROPOSTA $\rightarrow$ NEGOCIAÇÃO $\rightarrow$ VENDA**.

---

## 1. Arquitetura Poliglota e Stack Tecnológica

- **C# (`csharp/PricingEngine.cs` & `csharp/PricingEngine.exe`):** Motor oficial de cálculo contábil compilado em executável nativo `.NET`, implementando integralmente as fórmulas auditadas (**NBC PG 01** e **Res. CFC 1.590/2020**), validação de alçada de descontos e alertas de aviltamento.
- **Python (`backend/server.py`, `backend/database.py`, `backend/pricing_engine.py`):** Servidor full-stack multi-tenant RESTful, autenticação JWT/HMAC com hash PBKDF2-SHA256, controle de acesso baseado em perfis (RBAC), geração de links públicos/PDF e sincronização automática entre CRM, Calculadora e Propostas.
- **SQL (`database/migrations/`):**
  - `001_initial_schema_sqlite.sql`: Banco relacional local em **SQLite 3** (`database/saas_contabil.db`).
  - `002_supabase_postgres_rls.sql`: Schema **Supabase (PostgreSQL)** completo com políticas de **Row-Level Security (RLS)** por `tenant_id`.
- **PHP (`php/SupabaseClient.php`, `php/public_proposal.php`, `php/webhook_handler.php`):** Conector híbrido PDO SQLite / Supabase REST, portal público de aceite comercial e endpoint de webhook para captura externa de leads.
- **HTML5 / CSS3 / JS (`frontend/index.html`, `frontend/styles.css`, `frontend/app.js`):** Interface SaaS B2B responsiva com menu lateral esquerdo recolhível (**Parâmetros**, **Calculadora**, **Propostas**, **CRM de Vendas** e **Configurações** no rodapé), Kanban Drag-and-Drop e identidade visual personalizável por escritório.

---

## 2. Como Executar Localmente

### Iniciar o Servidor SaaS
Execute o arquivo `iniciar_plataforma.bat` ou rode no terminal:
```powershell
& "C:\Users\gordo\AppData\Local\Python\bin\python.exe" backend\server.py
```
Acesse no navegador: **http://localhost:8090**

### Executar o Motor C# Diretamente
```powershell
.\csharp\PricingEngine.exe --self-test
```

### Executar a Suíte de Testes Automatizados (10 Critérios de Aceite + Isolamento Multi-Tenant)
```powershell
& "C:\Users\gordo\AppData\Local\Python\bin\python.exe" tests\test_saas_acceptance.py
```
