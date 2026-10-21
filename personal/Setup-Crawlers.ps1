param([switch]$BuildDesktopEntry)
$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
$toolDirectory = Join-Path (Split-Path -Parent $repository) 'tools'
$runtimeDirectory = Join-Path $toolDirectory 'crawler-runtime'
$sharedDirectory = Join-Path $toolDirectory 'personal-crawlers'
$mediaDirectory = Join-Path $toolDirectory 'MediaCrawler'
$pythonExecutable = Join-Path $runtimeDirectory 'Scripts/python.exe'
if (-not (Test-Path -LiteralPath $pythonExecutable)) {
    $basePython = (Get-Command python -ErrorAction Stop).Source
    & $basePython -m venv $runtimeDirectory
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the crawler Python environment.' }
}
if (-not (Test-Path -LiteralPath (Join-Path $mediaDirectory 'main.py'))) {
    & git clone --depth 1 https://github.com/NanmiCoder/MediaCrawler.git $mediaDirectory
    if ($LASTEXITCODE -ne 0) { throw 'MediaCrawler download failed.' }
}
$requirementsFile = Join-Path $runtimeDirectory 'personal-requirements.txt'
# MCP 2 requires a newer Uvicorn than the upstream WebUI's historical pin.
Get-Content -LiteralPath (Join-Path $mediaDirectory 'requirements.txt') | Where-Object { $_ -notmatch '^uvicorn' } | Set-Content -LiteralPath $requirementsFile -Encoding utf8NoBOM
& $pythonExecutable -m pip install -r $requirementsFile 'uvicorn>=0.31.1' 'scrapling[fetchers]==0.4.15' 'markdownify==1.2.3' 'mcp==2.3.0' 'sse-starlette==3.0.2' 'starlette==0.37.2' 'pywin32>=306' pyyaml python-docx pypdf pdfplumber reportlab
if ($LASTEXITCODE -ne 0) { throw 'Crawler dependencies could not be installed.' }
& $pythonExecutable -m playwright install chromium
if ($LASTEXITCODE -ne 0) { throw 'Playwright browser installation failed.' }
& $pythonExecutable -m patchright install chromium
if ($LASTEXITCODE -ne 0) { throw 'Scrapling browser installation failed.' }
New-Item -ItemType Directory -Path $sharedDirectory -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $repository 'packages/web/web-crawlers/runtime/crawler.py') -Destination (Join-Path $sharedDirectory 'crawler.py')
Copy-Item -LiteralPath (Join-Path $repository 'packages/web/web-crawlers/runtime/platform_lock.py') -Destination (Join-Path $sharedDirectory 'platform_lock.py')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'crawlers/cli.py') -Destination (Join-Path $sharedDirectory 'cli.py')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'crawlers/media_entry.py') -Destination (Join-Path $sharedDirectory 'media_entry.py')
$dataDirectory = Join-Path (Split-Path -Parent $repository) 'personal-data/crawlers'
New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null
$settingsFile = Join-Path $dataDirectory 'settings.json'
if (-not (Test-Path -LiteralPath $settingsFile)) {
    @{ pythonExecutable = $pythonExecutable; mediaCrawlerDirectory = $mediaDirectory; dataDirectory = $dataDirectory
       worker = (Join-Path $sharedDirectory 'crawler.py'); searchEngine = 'duckduckgo'; timeoutMs = 60000; maxBodyChars = 50000
    } | ConvertTo-Json | Set-Content -LiteralPath $settingsFile -Encoding utf8NoBOM
}
& $pythonExecutable (Join-Path $PSScriptRoot 'crawlers/configure_media.py') $settingsFile
if ($LASTEXITCODE -ne 0) { throw 'MediaCrawler WebUI configuration failed.' }
if (-not (Test-Path -LiteralPath (Join-Path $mediaDirectory 'api/webui/index.html'))) {
    Push-Location (Join-Path $mediaDirectory 'webui')
    try {
        & npm.cmd ci
        if ($LASTEXITCODE -ne 0) { throw 'MediaCrawler WebUI dependency installation failed.' }
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw 'MediaCrawler WebUI build failed.' }
    } finally { Pop-Location }
}
$commandPath = Join-Path $sharedDirectory 'desktop-crawlers.cmd'
@('@echo off', ('"{0}" "{1}" %*' -f $pythonExecutable, (Join-Path $sharedDirectory 'cli.py'))) | Set-Content -LiteralPath $commandPath -Encoding ascii
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (($userPath -split ';') -notcontains $sharedDirectory) {
    [Environment]::SetEnvironmentVariable('Path', ($userPath.TrimEnd(';') + ';' + $sharedDirectory), 'User')
}
& $pythonExecutable (Join-Path $sharedDirectory 'cli.py') doctor
if ($LASTEXITCODE -ne 0) { throw 'Crawler health check failed.' }
& (Join-Path $PSScriptRoot 'Register-Crawlers.ps1')
if (-not (Test-Path -LiteralPath (Join-Path $sharedDirectory 'skills-manifest.json'))) {
    & $pythonExecutable (Join-Path $PSScriptRoot 'crawlers/migrate_skills.py')
    if ($LASTEXITCODE -ne 0) { throw 'Skill migration failed.' }
}
$profilePath = Join-Path (Split-Path -Parent $repository) 'personal-data/home/profiles/desktop/cordis.patch.yml'
if (Test-Path -LiteralPath $profilePath) {
    & node (Join-Path $PSScriptRoot 'Configure-Crawlers.mjs') $profilePath
    if ($LASTEXITCODE -ne 0) { throw 'Personal Desktop crawler configuration failed.' }
}
if ($BuildDesktopEntry) {
    & $pythonExecutable -m pip install pyinstaller
    if ($LASTEXITCODE -ne 0) { throw 'Desktop entry builder installation failed.' }
    & $pythonExecutable -m PyInstaller --noconfirm --onefile --windowed --name MediaCrawler --distpath (Join-Path $sharedDirectory 'dist') --workpath (Join-Path $repository '.artifacts/mediacrawler-launcher/build') --specpath (Join-Path $repository '.artifacts/mediacrawler-launcher') (Join-Path $PSScriptRoot 'crawlers/desktop.py')
    if ($LASTEXITCODE -ne 0) { throw 'MediaCrawler desktop entry build failed.' }
    Copy-Item -LiteralPath (Join-Path $sharedDirectory 'dist/MediaCrawler.exe') -Destination (Join-Path ([Environment]::GetFolderPath('Desktop')) 'MediaCrawler.exe')
}
