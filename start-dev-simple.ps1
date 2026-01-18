# Rapitas開発環境起動スクリプト（シンプル版）
Write-Host "🚀 Rapitas開発環境を起動します..." -ForegroundColor Cyan
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
