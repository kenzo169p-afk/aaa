@echo off
chcp 65001 >nul
echo ============================================================================
echo   PLATAFORMA SAAS DE PRECIFICACAO, PROPOSTAS E CRM CONTABIL
echo   Iniciando servidor em http://localhost:8090 ...
echo ============================================================================
start "" "http://localhost:8090"
"C:\Users\gordo\AppData\Local\Python\bin\python.exe" "%~dp0backend\server.py"
