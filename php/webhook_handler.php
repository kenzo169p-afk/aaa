<?php
/**
 * Webhook Endpoint (PHP) para Captura de Leads Contábeis Externos
 * Integra Landing Pages, WhatsApp, RD Station e Meta Ads diretamente no Pipeline Kanban do Escritório.
 */

require_once __DIR__ . '/SupabaseClient.php';

use SaaSContabil\Database\SupabaseClient;

header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'Método não permitido. Use POST.']);
    exit;
}

$rawBody = file_get_contents('php://input');
$payload = json_decode($rawBody, true) ?: $_POST;

$tenantId = $payload['tenant_id'] ?? ($_GET['tenant_id'] ?? '');
$contactName = trim($payload['contact_name'] ?? '');
$companyName = trim($payload['company_name'] ?? $contactName);

if (empty($tenantId) || empty($contactName)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Campos obrigatórios: tenant_id, contact_name.']);
    exit;
}

try {
    $db = new SupabaseClient();
    $pdo = $db->getLocalPdo();

    // Localiza a primeira etapa do funil ("Novo Lead") do escritório
    $stageStmt = $pdo->prepare("SELECT id FROM pipeline_stages WHERE tenant_id = :t ORDER BY stage_order ASC LIMIT 1");
    $stageStmt->execute([':t' => $tenantId]);
    $stage = $stageStmt->fetch();

    if (!$stage) {
        http_response_code(404);
        echo json_encode(['ok' => false, 'error' => 'Tenant ou pipeline não encontrado.']);
        exit;
    }

    $oppId = 'opp_' . bin2hex(random_bytes(6));
    $stmt = $pdo->prepare("
        INSERT INTO opportunities (
            id, tenant_id, stage_id, contact_name, company_name, cpf_cnpj,
            email, whatsapp, city, state, lead_origin, hiring_type,
            service_interest, estimated_revenue, current_tax_regime,
            employees_count, partners_count, next_action, next_action_date, status
        ) VALUES (
            :id, :tenant_id, :stage_id, :contact_name, :company_name, :cpf_cnpj,
            :email, :whatsapp, :city, :state, :lead_origin, :hiring_type,
            :service_interest, :estimated_revenue, :current_tax_regime,
            :employees_count, :partners_count, 'Realizar Primeiro Contato Comercial', date('now', '+1 day'), 'aberta'
        )
    ");

    $stmt->execute([
        ':id' => $oppId,
        ':tenant_id' => $tenantId,
        ':stage_id' => $stage['id'],
        ':contact_name' => $contactName,
        ':company_name' => $companyName,
        ':cpf_cnpj' => $payload['cpf_cnpj'] ?? '',
        ':email' => $payload['email'] ?? '',
        ':whatsapp' => $payload['whatsapp'] ?? '',
        ':city' => $payload['city'] ?? '',
        ':state' => $payload['state'] ?? 'SP',
        ':lead_origin' => $payload['lead_origin'] ?? 'Webhook / Landing Page',
        ':hiring_type' => $payload['hiring_type'] ?? 'Troca de contador',
        ':service_interest' => $payload['service_interest'] ?? 'Assessoria Contábil Mensal',
        ':estimated_revenue' => (float)($payload['estimated_revenue'] ?? 50000),
        ':current_tax_regime' => $payload['current_tax_regime'] ?? 'simples',
        ':employees_count' => (int)($payload['employees_count'] ?? 1),
        ':partners_count' => (int)($payload['partners_count'] ?? 1)
    ]);

    echo json_encode([
        'ok' => true,
        'opportunity_id' => $oppId,
        'stage_id' => $stage['id'],
        'message' => 'Lead contábil registrado no pipeline com sucesso.'
    ]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()]);
}
