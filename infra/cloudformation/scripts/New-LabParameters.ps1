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
$prefixText = & aws ec2 describe-managed-prefix-lists --profile pulumi-lab --region us-east-2 --filters 'Name=prefix-list-name,Values=com.amazonaws.us-east-2.s3' --query 'PrefixLists[].PrefixListId' --output text --no-cli-pager
if ($LASTEXITCODE -ne 0) { throw 'No se pudo consultar la lista S3 regional.' }
# Evitar el wrapper de arrays de ConvertFrom-Json en Windows PowerShell 5.1.
$prefixId = ($prefixText -join "`n").Trim()
if ($prefixId -notmatch '^pl-[0-9a-f]+$') { throw 'Se requiere exactamente una lista S3 administrada por AWS.' }
$parameters = @(
  @{ParameterKey='S3PrefixListId';ParameterValue=[string]$prefixId},
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
