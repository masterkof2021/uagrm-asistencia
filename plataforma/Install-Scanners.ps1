[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$toolsRoot = Join-Path $PSScriptRoot 'data/herramientas'
New-Item -ItemType Directory -Path $toolsRoot -Force | Out-Null

$packages = @(
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
  Expand-Archive -LiteralPath $archivePath -DestinationPath $destination -Force
}
Write-Host "Escáneres instalados en $toolsRoot"
