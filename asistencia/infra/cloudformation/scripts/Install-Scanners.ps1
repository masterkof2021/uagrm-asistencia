[CmdletBinding()]
param([string]$Python = 'python')
$ErrorActionPreference = 'Stop'
$labRoot = Split-Path $PSScriptRoot -Parent
$toolsRoot = Join-Path $labRoot '.tools'
New-Item -ItemType Directory -Path $toolsRoot -Force | Out-Null

# Versiones y hashes obtenidos de los releases oficiales. No se modifica el PATH.
$packages = @(
  @{ Name='guard'; Url='https://github.com/aws-cloudformation/cloudformation-guard/releases/download/3.2.1/cfn-guard-v3-x86_64-windows-latest.tar.gz'; File='guard.tar.gz'; Hash='52af28c02081f1067c6710c08619d359899734ec59d51f17f68e1b4b396a1203' },
  @{ Name='trivy'; Url='https://github.com/aquasecurity/trivy/releases/download/v0.76.1/trivy_0.76.1_windows-64bit.zip'; File='trivy.zip'; Hash='1051f49cb22d5284f43425f72aad9cda63ca12ceb92e7caa06903490c82dc9bf' },
  @{ Name='gitleaks'; Url='https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_windows_x64.zip'; File='gitleaks.zip'; Hash='d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e' },
  @{ Name='conftest'; Url='https://github.com/open-policy-agent/conftest/releases/download/v0.71.1/conftest_0.71.1_Windows_x86_64.zip'; File='conftest.zip'; Hash='34d623334b5e7ed4465bf62a4cb3b092684859cd3d224bbd390925a0852b922a' }
)
foreach ($package in $packages) {
  $archivePath = Join-Path $toolsRoot $package.File
  $destination = Join-Path $toolsRoot $package.Name
  if (!(Test-Path -LiteralPath $archivePath)) {
    Write-Host "Descargando $($package.Name)..."
    Invoke-WebRequest -Uri $package.Url -OutFile $archivePath
  }
  if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $package.Hash) {
    throw "Hash incorrecto: $archivePath. No ejecutar ni extraer el archivo."
  }
  New-Item -ItemType Directory -Path $destination -Force | Out-Null
  if ($package.File.EndsWith('.zip')) {
    Expand-Archive -LiteralPath $archivePath -DestinationPath $destination -Force
  } else {
    & tar -xzf $archivePath -C $destination
    if ($LASTEXITCODE -ne 0) { throw 'Fallo extrayendo CloudFormation Guard.' }
  }
}
$venvRoot = Join-Path $toolsRoot 'venv'
$venvPython = Join-Path $venvRoot 'Scripts/python.exe'
if (!(Test-Path -LiteralPath $venvPython)) {
  & $Python -m venv $venvRoot
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear el entorno Python.' }
}
& $venvPython -m pip install -r (Join-Path $labRoot 'requirements-scanners.lock.txt')
if ($LASTEXITCODE -ne 0) { throw 'No se pudo instalar cfn-lint.' }
Write-Host "Herramientas aisladas instaladas en $toolsRoot"
