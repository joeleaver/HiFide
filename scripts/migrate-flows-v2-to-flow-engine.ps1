# Script to migrate flows-v2 imports to flow-engine

$files = Get-ChildItem -Path . -Include *.ts,*.tsx,*.md,*.json -Recurse -Exclude node_modules,dist,dist-electron,release,.git

$count = 0
foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw
    $modified = $false
    
    # Replace flows-v2 with flow-engine in import paths
    if ($content -match "from ['\""](.*/)flows-v2") {
        $content = $content -replace "from (['\""](.*/)flows-v2)", "from `$1flow-engine"
        $modified = $true
    }
    
    # Replace flows-v2 with flow-engine in require paths
    if ($content -match "require\(['\""](.*/)flows-v2") {
        $content = $content -replace "require\((['\""](.*/)flows-v2)", "require(`$1flow-engine"
        $modified = $true
    }
    
    # Replace flows-v2 with flow-engine in documentation paths
    if ($content -match "electron/ipc/flows-v2") {
        $content = $content -replace "electron/ipc/flows-v2", "electron/flow-engine"
        $modified = $true
    }
    
    # Replace flows-v2 with flow-engine in tsconfig exclude paths
    if ($content -match "electron/ipc/flows-v2/__tests__") {
        $content = $content -replace "electron/ipc/flows-v2/__tests__", "electron/flow-engine/__tests__"
        $modified = $true
    }
    
    if ($modified) {
        Set-Content -Path $file.FullName -Value $content -NoNewline
        $count++
        Write-Host "Updated: $($file.FullName)"
    }
}

Write-Host "`nTotal files updated: $count"

