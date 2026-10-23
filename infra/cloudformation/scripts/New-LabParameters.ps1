[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$OperatorIp,
  [string]$PublicKeyPath = (Join-Path $env:USERPROFILE 'globomatics-ec2.pub')
)
$ErrorActionPreference = 'Stop'
$parsedIp = $null
if (![Net.IPAddress]::TryParse($OperatorIp,[ref]$parsedIp) -or
    $parsedIp.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or
    $OperatorIp -ne $parsedIp.ToString()) { throw 'Introducir una IPv4 valida, sin /32.' }
$publicKey = (Get-Content -LiteralPath $PublicKeyPath -Raw).Trim()
if ($publicKey -notmatch '^(ssh-ed25519|ssh-rsa|ecdsa-sha2-\S+) [A-Za-z0-9+/]+={0,2}( .*)?$') {
  throw 'Se requiere una clave PUBLICA OpenSSH. No utilizar archivos privados.'
}
$parameters = @(
  @{ParameterKey='SshIngressCidr';ParameterValue="$OperatorIp/32"},
  @{ParameterKey='WebIngressCidr';ParameterValue="$OperatorIp/32"},
  @{ParameterKey='SshPublicKey';ParameterValue=$publicKey},
  @{ParameterKey='InstanceType';ParameterValue='t3.micro'}
)
$outputPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'parameters.local.json'
# Set-Content -Encoding utf8 agrega BOM en Windows PowerShell 5.1.
# AWS CLI requiere aqui JSON UTF-8 sin esa marca inicial.
$jsonText = $parameters | ConvertTo-Json -Depth 3
[IO.File]::WriteAllText($outputPath, $jsonText, [Text.UTF8Encoding]::new($false))
Write-Host "Parametros locales preparados: $outputPath"
