param([switch]$Wait)
$ErrorActionPreference = 'Stop'

$launchClock = [System.Diagnostics.Stopwatch]::StartNew()
$repository = Split-Path -Parent $PSScriptRoot
$dataDirectory = Join-Path (Split-Path -Parent $repository) 'personal-data'
$logDirectory = Join-Path $dataDirectory 'logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
function Write-LaunchTiming([string]$Phase) {
    $record = @{ at = [DateTimeOffset]::Now.ToString('o'); pid = $PID; phase = $Phase; elapsedMs = $launchClock.ElapsedMilliseconds }
    try {
        [System.IO.File]::AppendAllText((Join-Path $logDirectory 'launcher-timings.jsonl'), ($record | ConvertTo-Json -Compress) + "`n")
    } catch [System.IO.IOException] {
        # Timing output must not block a simultaneous launch.
    }
}
Write-LaunchTiming 'entered'

# Wait for the owner to process activation; connecting alone is not an acknowledgement.
$pipeName = 'personal-desktop-activate'
$pipe = $null
try {
    $pipe = [System.IO.Pipes.NamedPipeClientStream]::new('.', $pipeName, [System.IO.Pipes.PipeDirection]::InOut, [System.IO.Pipes.PipeOptions]::Asynchronous)
    $pipe.Connect(150)
    $reply = New-Object byte[] 16
    $read = $pipe.BeginRead($reply, 0, $reply.Length, $null, $null)
    if (-not $read.AsyncWaitHandle.WaitOne(2000)) { throw 'Desktop activation was not acknowledged.' }
    $received = $pipe.EndRead($read)
    if ([System.Text.Encoding]::UTF8.GetString($reply, 0, $received) -ne 'ok') { throw 'Desktop activation failed.' }
    Write-LaunchTiming 'activated'
    exit 0
} catch {
    # Electron's single-instance lock handles a concurrent launch without killing applications.
    Write-LaunchTiming 'activation-unconfirmed'
} finally {
    if ($null -ne $pipe) { $pipe.Dispose() }
}

$nodeCommand = (Get-Command node -ErrorAction Stop).Source
$pnpmEntry = Join-Path $repository 'apps\desktop\node_modules\pnpm\bin\pnpm.mjs'

if (-not (Test-Path -LiteralPath (Join-Path $repository 'apps\desktop\lib\main.js'))) {
    throw 'Desktop is not built. Run personal\Prepare.ps1 first.'
}

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$env:DSH_HOME = Join-Path $dataDirectory 'home'
$env:DSH_DESKTOP_USER_DATA_DIR = Join-Path $dataDirectory 'electron'
$env:DSH_DESKTOP_PERSONAL = '1'
$env:DSH_DESKTOP_OPEN_DEVTOOLS = '0'
$env:DSH_DESKTOP_MAIN_INSPECT_PORT = '24571'
$env:DSH_DESKTOP_RENDERER_DEBUG_PORT = '24572'
$env:DSH_DESKTOP_HOST_INSPECT_PORT = '24573'
$env:DSH_TELEMETRY_DISABLED = '1'
$env:DSH_CLIENT_TITLE = 'Personal Desktop'
$env:DSH_PERSONAL_DATA_DIRECTORY = $dataDirectory
$env:DSH_PERSONAL_NODE_EXECUTABLE = $nodeCommand
$env:DSH_PERSONAL_GEMINI_CLI_LAUNCHER = Join-Path $PSScriptRoot 'GeminiCli.mjs'

$antigravityExecutable = Join-Path $env:LOCALAPPDATA 'agy\bin\agy.exe'
if (Test-Path -LiteralPath $antigravityExecutable -PathType Leaf) {
    $env:DSH_PERSONAL_ANTIGRAVITY_EXECUTABLE = $antigravityExecutable
} else {
    Remove-Item Env:DSH_PERSONAL_ANTIGRAVITY_EXECUTABLE -ErrorAction SilentlyContinue
}

# Only probe Gemini CLI if installed, avoiding an expensive failed node process
$geminiCliPkg = Join-Path $env:APPDATA 'npm\node_modules\@google\gemini-cli'
if (Test-Path -LiteralPath $geminiCliPkg) {
    $geminiProbeOutput = & $nodeCommand $env:DSH_PERSONAL_GEMINI_CLI_LAUNCHER --account 2 --probe
    if ($LASTEXITCODE -eq 0) {
        $geminiProbe = $geminiProbeOutput | ConvertFrom-Json
        $env:DSH_PERSONAL_GEMINI_CLI_ENTRY = $geminiProbe.entryPath
    }
} else {
    Remove-Item Env:DSH_PERSONAL_GEMINI_CLI_ENTRY -ErrorAction SilentlyContinue
}

$mimoExecutable = Join-Path (Split-Path -Parent $repository) 'tools\mimocode-0.1.14\mimo.exe'
if (Test-Path -LiteralPath $mimoExecutable -PathType Leaf) {
    $env:DSH_PERSONAL_MIMO_EXECUTABLE = $mimoExecutable
}

$codexExecutable = Get-ChildItem -Path "$env:LOCALAPPDATA\OpenAI\Codex\bin\*\codex.exe" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
if ($codexExecutable -and (Test-Path -LiteralPath $codexExecutable -PathType Leaf)) {
    $env:DSH_PERSONAL_CODEX_EXECUTABLE = $codexExecutable
}

# Only run bootstrap when template files are missing
$patchFile = Join-Path $env:DSH_HOME 'profiles\desktop\cordis.patch.yml'
$agentsFile = Join-Path $env:DSH_HOME 'AGENTS.md'
if (-not (Test-Path -LiteralPath $patchFile) -or -not (Test-Path -LiteralPath $agentsFile)) {
    & $nodeCommand (Join-Path $PSScriptRoot 'bootstrap.mjs') $env:DSH_HOME
    if ($LASTEXITCODE -ne 0) { throw 'Personal configuration initialization failed.' }
}

$launchArguments = @($pnpmEntry, '--dir', $repository, 'run', 'start:desktop')

if ($Wait) {
    Write-LaunchTiming 'runtime-start'
    & $nodeCommand @launchArguments
    Write-LaunchTiming 'runtime-exit'
    exit $LASTEXITCODE
} else {
    Start-Process -FilePath $nodeCommand -ArgumentList $launchArguments -WorkingDirectory $repository -WindowStyle Hidden | Out-Null
    Write-LaunchTiming 'runtime-launched'
}
