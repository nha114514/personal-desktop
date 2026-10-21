$ErrorActionPreference = 'Stop'
$sharedDirectory = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tools/personal-crawlers'
$pythonExecutable = Join-Path (Split-Path -Parent $sharedDirectory) 'crawler-runtime/Scripts/python.exe'
$cli = Join-Path $sharedDirectory 'cli.py'
if (-not (Test-Path -LiteralPath $cli)) { throw 'Run personal/Setup-Crawlers.ps1 first.' }

$codexRoot = Join-Path $env:LOCALAPPDATA 'OpenAI/Codex/bin'
$codex = Get-ChildItem -LiteralPath $codexRoot -Filter codex.exe -Recurse -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $codex) { throw 'Official Codex runtime is not installed.' }
& $codex.FullName mcp add personal-crawlers -- $pythonExecutable $cli server
if ($LASTEXITCODE -ne 0) { throw 'Codex MCP registration failed.' }

$antigravity = Join-Path $env:LOCALAPPDATA 'agy/bin/agy.exe'
if (-not (Test-Path -LiteralPath $antigravity)) { throw 'Official Antigravity CLI is not installed.' }
& $antigravity mcp add personal-crawlers $pythonExecutable $cli server
if ($LASTEXITCODE -ne 0) { throw 'Antigravity MCP registration failed.' }
& $pythonExecutable (Join-Path $PSScriptRoot 'crawlers/configure_global.py')
if ($LASTEXITCODE -ne 0) { throw 'Global crawler routing policy configuration failed.' }
