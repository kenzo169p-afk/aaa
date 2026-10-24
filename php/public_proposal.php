<?php
/**
 * Portal Público de Visualização e Aceite Comercial de Propostas Contábeis
 * Integrado ao banco SQLite / Supabase e ao CRM de Vendas.
 */

require_once __DIR__ . '/SupabaseClient.php';

use SaaSContabil\Database\SupabaseClient;

header('Content-Type: text/html; charset=utf-8');

$db = new SupabaseClient();
$pdo = $db->getLocalPdo();

$token = $_GET['token'] ?? ($_POST['token'] ?? '');
if (empty($token)) {
    http_response_code(400);
    echo "<h2>Token de proposta inválido ou ausente.</h2>";
    exit;
}

$stmt = $pdo->prepare("
    SELECT p.*, t.name AS tenant_name, t.trade_name, t.cnpj AS tenant_cnpj,
           t.crc_registration, t.email AS tenant_email, t.phone AS tenant_phone,
           t.whatsapp AS tenant_whatsapp, t.primary_color, t.secondary_color,
           t.commercial_signature
    FROM proposals p
    JOIN tenants t ON t.id = p.tenant_id
    WHERE p.public_token = :token
    LIMIT 1
");
$stmt->execute([':token' => $token]);
$proposal = $stmt->fetch();

if (!$proposal) {
    http_response_code(404);
    echo "<h2>Proposta comercial não encontrada.</h2>";
    exit;
}

$message = '';
$ip = $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1';

if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['action'])) {
    $action = $_POST['action'];
    if ($action === 'accept' && $proposal['status'] !== 'Aceita') {
        $respName = trim($_POST['accepted_by_name'] ?? '');
        $respDoc = trim($_POST['accepted_by_document'] ?? '');
        $respRole = trim($_POST['accepted_by_role'] ?? 'Sócio / Administrador');
        $respEmail = trim($_POST['accepted_by_email'] ?? '');

        if ($respName !== '' && $respDoc !== '') {
            $upd = $pdo->prepare("
                UPDATE proposals
                SET status = 'Aceita',
                    accepted_at = datetime('now'),
                    accepted_by_name = :name,
                    accepted_by_document = :doc,
                    accepted_by_role = :role,
                    accepted_by_email = :email,
                    accepted_ip = :ip,
                    accepted_version = current_version,
                    updated_at = datetime('now')
                WHERE id = :id AND tenant_id = :tenant_id
            ");
            $upd->execute([
                ':name' => $respName,
                ':doc' => $respDoc,
                ':role' => $respRole,
                ':email' => $respEmail,
                ':ip' => $ip,
                ':id' => $proposal['id'],
                ':tenant_id' => $proposal['tenant_id']
            ]);

            // Sincroniza automaticamente a oportunidade no CRM para etapa 'Ganho'
            if (!empty($proposal['opportunity_id'])) {
                $wonStage = $pdo->prepare("SELECT id FROM pipeline_stages WHERE tenant_id = :t AND is_won = 1 LIMIT 1");
                $wonStage->execute([':t' => $proposal['tenant_id']]);
                $stageRow = $wonStage->fetch();
                if ($stageRow) {
                    $pdo->prepare("
                        UPDATE opportunities
                        SET stage_id = :stage_id,
                            status = 'ganha',
                            potential_monthly_value = :val,
                            won_at = datetime('now'),
                            updated_at = datetime('now')
                        WHERE id = :opp_id AND tenant_id = :tenant_id
                    ")->execute([
                        ':stage_id' => $stageRow['id'],
                        ':val' => $proposal['monthly_fee_final'],
                        ':opp_id' => $proposal['opportunity_id'],
                        ':tenant_id' => $proposal['tenant_id']
                    ]);
                }
            }

            $message = 'Aceite comercial registrado com sucesso!';
            $stmt->execute([':token' => $token]);
            $proposal = $stmt->fetch();
        }
    }
} else {
    // Registra visualização se estava 'Enviada'
    if ($proposal['status'] === 'Enviada') {
        $pdo->prepare("UPDATE proposals SET status = 'Visualizada', viewed_at = datetime('now') WHERE id = :id")
            ->execute([':id' => $proposal['id']]);
    }
}
?>
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <title>Proposta <?= htmlspecialchars($proposal['proposal_number']) ?> — <?= htmlspecialchars($proposal['tenant_name']) ?></title>
    <style>
        body { font-family: 'DM Sans', system-ui, sans-serif; background: #0A0F1C; color: #EAE3CF; margin: 0; padding: 32px 16px; }
        .container { max-width: 860px; margin: 0 auto; background: #0E1626; border: 1px solid #243049; border-radius: 16px; padding: 32px; }
        .badge { display: inline-block; padding: 6px 14px; border-radius: 999px; background: <?= htmlspecialchars($proposal['primary_color'] ?: '#C9A227') ?>; color: #1a1408; font-weight: 700; font-size: 12px; }
        .price { font-size: 34px; font-weight: 800; color: <?= htmlspecialchars($proposal['primary_color'] ?: '#C9A227') ?>; }
        .legal-note { font-size: 12px; color: #9AA6B8; border-top: 1px solid #243049; padding-top: 14px; margin-top: 24px; }
    </style>
</head>
<body>
<div class="container">
    <span class="badge">Status: <?= htmlspecialchars($proposal['status']) ?> (v<?= (int)$proposal['current_version'] ?>)</span>
    <h1><?= htmlspecialchars($proposal['cover_title'] ?: 'Proposta de Assessoria Contábil') ?></h1>
    <p><strong>Escritório:</strong> <?= htmlspecialchars($proposal['tenant_name']) ?> (CRC: <?= htmlspecialchars($proposal['crc_registration'] ?? '-') ?>)</p>
    <p><strong>Cliente / Empresa:</strong> <?= htmlspecialchars($proposal['company_name']) ?> (<?= htmlspecialchars($proposal['cpf_cnpj'] ?? '') ?>)</p>
    <hr style="border-color:#243049;margin:20px 0">
    <h3>Investimento Mensal</h3>
    <div class="price">R$ <?= number_format((float)$proposal['monthly_fee_final'], 2, ',', '.') ?> / mês</div>
    <p>Taxa de Implantação: R$ <?= number_format((float)$proposal['setup_fee'], 2, ',', '.') ?> | Condições: <?= htmlspecialchars($proposal['payment_conditions']) ?></p>
    <p class="legal-note">
        Nota Legal (Res. CFC 1.590/2020): O aceite comercial registra a concordância com os valores e escopo desta proposta comercial (v<?= (int)$proposal['current_version'] ?>), não substituindo automaticamente o Contrato de Prestação de Serviços Contábeis assinado eletronicamente.
    </p>
</div>
</body>
</html>
