[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$labRoot = Split-Path $PSScriptRoot -Parent
$repoRoot = (Resolve-Path (Join-Path $labRoot '../..')).Path
$toolsRoot = Join-Path $labRoot '.tools'
$reportRoot = Join-Path $labRoot ('reports/' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $reportRoot -Force | Out-Null
function Find-Tool([string]$folder, [string]$file) {
  $found = Get-ChildItem -LiteralPath (Join-Path $toolsRoot $folder) -Recurse -File -Filter $file | Select-Object -First 1
  if (!$found) { throw "Falta $file. Ejecutar scripts/Install-Scanners.ps1." }
  return $found.FullName
}
$python = Join-Path $toolsRoot 'venv/Scripts/python.exe'
$lint = Join-Path $toolsRoot 'venv/Scripts/cfn-lint.exe'
if (!(Test-Path -LiteralPath $lint)) { throw 'Falta cfn-lint. Ejecutar Install-Scanners.ps1.' }
$guard = Find-Tool 'guard' 'cfn-guard.exe'
$trivy = Find-Tool 'trivy' 'trivy.exe'
$gitleaks = Find-Tool 'gitleaks' 'gitleaks.exe'
$conftest = Find-Tool 'conftest' 'conftest.exe'
$template = Join-Path $labRoot 'templates/asistencia.yaml'
$normalized = Join-Path $reportRoot 'asistencia.normalized.json'
$results = [Collections.Generic.List[object]]::new()
function Run-Check([string]$name, [string]$exe, [string[]]$arguments, [string]$suffix='json') {
  $output = Join-Path $reportRoot "$name.$suffix"
  # PS 5.1 convierte stderr nativo en NativeCommandError con ErrorAction=Stop.
  # Python conserva stdout/stderr separados y devuelve el exit code real.
  & $python (Join-Path $PSScriptRoot 'run-tool.py') $output (Join-Path $reportRoot "$name.stderr.txt") $exe @arguments
  $code = $LASTEXITCODE
  $results.Add([PSCustomObject]@{Check=$name;ExitCode=$code;Report=(Split-Path $output -Leaf)})
  Write-Host "$name -> exit $code"
  return $code
}
# Primero validez de esquema; no convertir errores del validador en un falso aprobado.
$lintCode = Run-Check 'cfn-lint' $lint @('--format','json','--regions','us-east-2','--template',$template)
if ($lintCode -ne 0) {
  $results | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $reportRoot 'summary.json') -Encoding utf8
  throw "Corregir cfn-lint antes de continuar. Reportes: $reportRoot"
}
& $python (Join-Path $PSScriptRoot 'prepare-template.py') $template $normalized
if ($LASTEXITCODE -ne 0) { throw 'Fallo normalizando el template.' }
$null = Run-Check 'guard' $guard @('validate','--rules',(Join-Path $labRoot 'policies/security.guard'),'--data',$normalized,'--output-format','json','--structured','--show-summary','none')
$null = Run-Check 'conftest' $conftest @('test',$normalized,'--policy',(Join-Path $labRoot 'policies/security.rego'),'--output','json')
$previousDockerConfig = $env:DOCKER_CONFIG
$env:DOCKER_CONFIG = Join-Path $toolsRoot 'docker-public'
New-Item -ItemType Directory -Path $env:DOCKER_CONFIG -Force | Out-Null
try {
  $null = Run-Check 'trivy' $trivy @('config','--cache-dir',(Join-Path $toolsRoot 'trivy-cache'),'--misconfig-scanners','cloudformation','--cf-params',(Join-Path $labRoot 'parameters.scan.json'),'--format','json','--exit-code','1',$template)
} finally { $env:DOCKER_CONFIG = $previousDockerConfig }

# Snapshot del arbol de trabajo: incluye archivos nuevos y respeta .gitignore.
# Evita leer .env, estados privados, claves y caches; no equivale a revisar historial Git.
$snapshot = Join-Path $reportRoot 'source-snapshot'
New-Item -ItemType Directory -Path $snapshot | Out-Null
Push-Location $repoRoot
try {
  $trackedFiles = @(& git -c core.quotepath=false ls-files --cached --others --exclude-standard)
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo enumerar el repositorio.' }
  foreach ($relative in $trackedFiles) {
    $source = Join-Path $repoRoot $relative
    if (Test-Path -LiteralPath $source -PathType Leaf) {
      $destination = Join-Path $snapshot $relative
      New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
      Copy-Item -LiteralPath $source -Destination $destination
    }
  }
} finally { Pop-Location }
$null = Run-Check 'gitleaks' $gitleaks @('dir',$snapshot,'--config',(Join-Path $labRoot 'policies/gitleaks.toml'),'--redact=100','--no-banner','--report-format','json','--report-path',(Join-Path $reportRoot 'gitleaks-findings.json')) 'txt'
$results | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $reportRoot 'summary.json') -Encoding utf8
$results | Format-Table -AutoSize
Write-Host "Reportes privados: $reportRoot"
if (@($results | Where-Object ExitCode -ne 0).Count -gt 0) {
  throw 'Hay hallazgos o errores de ejecucion. Revisar JSON y stderr; no desplegar automaticamente.'
}
