$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
$env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
$env:DSH_DESKTOP_PERSONAL = '1'
$env:DSH_CLIENT_TITLE = 'Personal Desktop'
Push-Location $repository
try {
    & corepack pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    & corepack pnpm run build
    if ($LASTEXITCODE -ne 0) { throw 'Runtime build failed.' }
    & corepack pnpm run build:desktop
    if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed.' }
    & corepack pnpm --filter @deepseek-ai/dsh-desktop run prepare:primary-runtime
    if ($LASTEXITCODE -ne 0) { throw 'Bundled runtime preparation failed.' }
    & node --test personal/bootstrap.test.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Personal bootstrap verification failed.' }
} finally {
    Pop-Location
}
