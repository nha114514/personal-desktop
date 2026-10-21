param([ValidateSet('status', 'login', 'extension')][string]$Action = 'status')
$ErrorActionPreference = 'Stop'
if ($Action -eq 'status') {
    & opencli doctor
} elseif ($Action -eq 'login') {
    Start-Process "https://x.com/i/flow/login"
    Write-Host "已在浏览器中打开 X 登录页面。请在 Chrome 中登录，登录后通过 opencli doctor 核对连接状态。"
} elseif ($Action -eq 'extension') {
    Start-Process "chrome://extensions"
    Write-Host "请在 Chrome 扩展页面 (chrome://extensions) 开启开发者模式，点击“加载已解压的扩展程序”，选择目录："
    Write-Host "C:\Users\mouwe\.opencli\extension"
}
