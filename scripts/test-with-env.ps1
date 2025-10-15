# Load environment variables from .env.test and run tests
param(
    [string]$TestFile = "",
    [string]$Mode = "record"
)

# Load .env.test file
if (Test-Path ".env.test") {
    Get-Content ".env.test" | ForEach-Object {
        if ($_ -match '^([^=]+)=(.*)$') {
            $key = $matches[1]
            $value = $matches[2]
            [Environment]::SetEnvironmentVariable($key, $value, 'Process')
            Write-Host "Loaded: $key"
        }
    }
} else {
    Write-Host "Warning: .env.test file not found"
}

# Set TEST_MODE
$env:TEST_MODE = $Mode
Write-Host "TEST_MODE=$Mode"

# Run tests
if ($TestFile) {
    pnpm test $TestFile
} else {
    pnpm test
}

