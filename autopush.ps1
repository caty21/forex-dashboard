$repo = "C:\Users\capug\Documents\Private\Investissements\Trading\Code\forex-dashboard"

while ($true) {
    Set-Location $repo
    $status = git status --porcelain
    if ($status) {
        Write-Host "$(Get-Date -Format 'HH:mm:ss') - Modifications detectees, commit + push..."
        git add -A
        git commit -m "auto: sync $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
        git push origin main
        Write-Host "$(Get-Date -Format 'HH:mm:ss') - Push OK"
    } else {
        Write-Host "$(Get-Date -Format 'HH:mm:ss') - Rien a pusher"
    }
    Start-Sleep -Seconds 300
}
