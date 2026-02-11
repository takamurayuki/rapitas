# Rapitas開発環境起動スクリプト（シンプル版）
Write-Host "🚀 Rapitas開発環境を起動します..." -ForegroundColor Cyan
Write-Host ""

# ポートクリーンアップ関数
function Stop-ProcessOnPort {
    param(
        [int]$Port
    )
    
    Write-Host "🔍 ポート $Port を使用しているプロセスを確認中..." -ForegroundColor Yellow
    
    $connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
    if ($connections) {
        $pids = $connections | Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($pid in $pids) {
            if ($pid -ne 0 -and $pid -ne $PID) {
                $processName = (Get-Process -Id $pid -ErrorAction SilentlyContinue).ProcessName
                Write-Host "⚠️ ポート $Port を使用中のプロセスを終了: $processName (PID: $pid)" -ForegroundColor Yellow
                try {
                    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
                } catch {
                    Write-Host "  プロセス $pid の終了に失敗しました: $_" -ForegroundColor Red
                }
            }
        }
        Start-Sleep -Milliseconds 500
    } else {
        Write-Host "✅ ポート $Port は使用されていません" -ForegroundColor Green
    }
}

# 起動前にポートをクリーンアップ
Stop-ProcessOnPort -Port 3001
Stop-ProcessOnPort -Port 3000
Write-Host ""

# 新しいPowerShellウィンドウでバックエンドを起動
Write-Host "📦 バックエンドを起動中..." -ForegroundColor Green
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\rapitas-backend'; Write-Host '🚀 バックエンドサーバー起動中...' -ForegroundColor Cyan; bun run index.ts"

# 少し待つ
Start-Sleep -Seconds 1

# 新しいPowerShellウィンドウでフロントエンドを起動
Write-Host "🎨 フロントエンドを起動中..." -ForegroundColor Green
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\rapitas-frontend'; Write-Host '🎨 フロントエンドサーバー起動中...' -ForegroundColor Cyan; npm run dev"

Write-Host ""
Write-Host "✅ 起動完了!" -ForegroundColor Cyan
Write-Host "📌 バックエンド: http://localhost:3001" -ForegroundColor Yellow
Write-Host "📌 フロントエンド: http://localhost:3000" -ForegroundColor Yellow
Write-Host ""
Write-Host "⚠️  各ウィンドウで Ctrl+C を押すと終了できます" -ForegroundColor Red
