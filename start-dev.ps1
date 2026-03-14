# Rapitas開発環境起動スクリプト
Write-Host "🚀 Rapitas開発環境を起動します..." -ForegroundColor Cyan

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

# バックエンドとフロントエンドを並列起動
$jobs = @()

# バックエンド起動
Write-Host "`n📦 バックエンド起動中 (http://localhost:3001)..." -ForegroundColor Green
$backendJob = Start-Job -ScriptBlock {
    Set-Location $using:PWD\rapitas-backend
    bun run index.ts
}
$jobs += $backendJob

# フロントエンド起動（バックエンドが起動するまで少し待つ）
Start-Sleep -Seconds 2
Write-Host "🎨 フロントエンド起動中 (http://localhost:3000)..." -ForegroundColor Green
$frontendJob = Start-Job -ScriptBlock {
    Set-Location $using:PWD\rapitas-frontend
    npm run dev
}
$jobs += $frontendJob

Write-Host "`n✅ 起動完了!" -ForegroundColor Cyan
Write-Host "📌 バックエンド: http://localhost:3001" -ForegroundColor Yellow
Write-Host "📌 フロントエンド: http://localhost:3000" -ForegroundColor Yellow
Write-Host "`n⚠️  終了するには Ctrl+C を押してください`n" -ForegroundColor Red

# ログをリアルタイム表示
try {
    while ($true) {
        foreach ($job in $jobs) {
            $output = Receive-Job -Job $job -ErrorAction SilentlyContinue
            if ($output) {
                Write-Host $output
            }
        }
        Start-Sleep -Milliseconds 500
        
        # ジョブが終了していたら再起動
        foreach ($job in $jobs) {
            if ($job.State -eq 'Completed' -or $job.State -eq 'Failed') {
                Write-Host "⚠️ プロセスが停止しました。再起動しています..." -ForegroundColor Yellow
                $index = $jobs.IndexOf($job)
                Remove-Job -Job $job -Force
                
                if ($index -eq 0) {
                    # バックエンド再起動
                    $jobs[$index] = Start-Job -ScriptBlock {
                        Set-Location $using:PWD\rapitas-backend
                        bun run index.ts
                    }
                } else {
                    # フロントエンド再起動
                    $jobs[$index] = Start-Job -ScriptBlock {
                        Set-Location $using:PWD\rapitas-frontend
                        npm run dev
                    }
                }
            }
        }
    }
} finally {
    # クリーンアップ
    Write-Host "`n🛑 開発環境を停止中..." -ForegroundColor Yellow
    foreach ($job in $jobs) {
        Stop-Job -Job $job -ErrorAction SilentlyContinue
        Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
    }
    Write-Host "✅ 停止完了" -ForegroundColor Green
}
