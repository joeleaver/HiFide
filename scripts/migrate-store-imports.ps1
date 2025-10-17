# Script to migrate store imports from './store' to './store/bridge'

$files = Get-ChildItem -Path src -Recurse -Include *.tsx,*.ts -Exclude *.test.ts,*.spec.ts,bridge.ts,index.ts

$count = 0
foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw
    $modified = $false
    
    # Replace './store' with './store/bridge'
    if ($content -match "from ['\""]\./store['\""]") {
        $content = $content -replace "from ['\""]\./store['\""]", "from './store/bridge'"
        $modified = $true
    }
    
    # Replace '../store' with '../store/bridge'
    if ($content -match "from ['\""]\.\.\/store['\""]") {
        $content = $content -replace "from ['\""]\.\.\/store['\""]", "from '../store/bridge'"
        $modified = $true
    }
    
    # Replace '../../store' with '../../store/bridge'
    if ($content -match "from ['\""]\.\.\/\.\.\/store['\""]") {
        $content = $content -replace "from ['\""]\.\.\/\.\.\/store['\""]", "from '../../store/bridge'"
        $modified = $true
    }
    
    if ($modified) {
        Set-Content -Path $file.FullName -Value $content -NoNewline
        Write-Host "Updated: $($file.FullName)"
        $count++
    }
}

Write-Host "`nTotal files updated: $count"

