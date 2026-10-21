param([Parameter(Mandatory)][ValidateSet('xhs','dy','ks','bili','wb','tieba','zhihu')][string]$Platform)
$settingsPath = 'D:\desktop\personal-data\crawlers\settings.json'
$crawlerSettings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
& $crawlerSettings.pythonExecutable (Join-Path $PSScriptRoot 'crawlers\cli.py') login $Platform
exit $LASTEXITCODE
