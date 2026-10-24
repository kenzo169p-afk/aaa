<?php
/**
 * SaaS Contábil - Conector Híbrido SQLite3 + Supabase (PostgreSQL REST/RPC)
 * Garante isolamento Multi-Tenant (tenant_id) tanto em execução local quanto em nuvem.
 */

namespace SaaSContabil\Database;

use PDO;
use Exception;

class SupabaseClient
{
    private ?PDO $pdo = null;
    private string $supabaseUrl;
    private string $supabaseKey;
    private string $sqlitePath;

    public function __construct(?string $sqlitePath = null)
    {
        $this->supabaseUrl = getenv('SUPABASE_URL') ?: '';
        $this->supabaseKey = getenv('SUPABASE_SERVICE_ROLE_KEY') ?: (getenv('SUPABASE_ANON_KEY') ?: '');
        $this->sqlitePath = $sqlitePath ?: dirname(__DIR__) . DIRECTORY_SEPARATOR . 'database' . DIRECTORY_SEPARATOR . 'saas_contabil.db';
    }

    public function getLocalPdo(): PDO
    {
        if ($this->pdo === null) {
            $this->pdo = new PDO('sqlite:' . $this->sqlitePath);
            $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
            $this->pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
            $this->pdo->exec('PRAGMA foreign_keys = ON;');
        }
        return $this->pdo;
    }

    public function isSupabaseConfigured(): bool
    {
        return !empty($this->supabaseUrl) && !empty($this->supabaseKey);
    }

    /**
     * Executa requisição REST contra a API PostgREST do Supabase com cabeçalho de Tenant RLS
     */
    public function supabaseRequest(string $method, string $tableOrPath, array $query = [], ?array $body = null, ?string $tenantId = null): array
    {
        if (!$this->isSupabaseConfigured()) {
            throw new Exception('Supabase não configurado nas variáveis de ambiente.');
        }

        $url = rtrim($this->supabaseUrl, '/') . '/rest/v1/' . ltrim($tableOrPath, '/');
        if (!empty($query)) {
            $url .= '?' . http_build_query($query);
        }

        $headers = [
            'apikey: ' . $this->supabaseKey,
            'Authorization: Bearer ' . $this->supabaseKey,
            'Content-Type: application/json',
            'Prefer: return=representation'
        ];

        if ($tenantId) {
            $headers[] = 'X-Tenant-ID: ' . $tenantId;
        }

        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, strtoupper($method));
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);

        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE));
        }

        $response = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        return [
            'status' => $status,
            'data' => $response ? json_decode($response, true) : []
        ];
    }
}
