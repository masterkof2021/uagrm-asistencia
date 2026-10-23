[CmdletBinding()]
param(
  [string]$Profile = 'pulumi-lab',
  [ValidatePattern('^asistencia-cfn-[a-zA-Z0-9-]+$')][string]$StackName = 'asistencia-cfn-lab'
)
$ErrorActionPreference = 'Stop'
$labRoot = Split-Path $PSScriptRoot -Parent
$parameters = Join-Path $labRoot 'parameters.local.json'
if (!(Test-Path -LiteralPath $parameters)) { throw 'Crear parameters.local.json con New-LabParameters.ps1.' }
$identityText = & aws sts get-caller-identity --profile $Profile --output json --no-cli-pager
if ($LASTEXITCODE -ne 0) { throw 'Fallo de autenticacion AWS.' }
$identity = $identityText | ConvertFrom-Json
if ($identity.Account -ne '487450071663') { throw 'Cuenta AWS distinta de la prevista para el laboratorio.' }
$template = Join-Path $labRoot 'templates/asistencia.yaml'
& aws cloudformation validate-template --profile $Profile --region us-east-2 --template-body "file://$template" --no-cli-pager
if ($LASTEXITCODE -ne 0) { throw 'Validacion del servicio fallida.' }
$changeSet = 'asistencia-cfn-preview-' + (Get-Date -Format 'yyyyMMddHHmmss')
& aws cloudformation create-change-set --profile $Profile --region us-east-2 --stack-name $StackName --change-set-name $changeSet --change-set-type CREATE --template-body "file://$template" --parameters "file://$parameters" --description 'Revision academica antes de aprovisionar las EC2' --no-cli-pager
if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear el change set; revisar nombre, permisos y estado del stack.' }
& aws cloudformation wait change-set-create-complete --profile $Profile --region us-east-2 --stack-name $StackName --change-set-name $changeSet
if ($LASTEXITCODE -ne 0) {
  & aws cloudformation describe-change-set --profile $Profile --region us-east-2 --stack-name $StackName --change-set-name $changeSet --no-cli-pager
  throw 'El change set no termino correctamente. No ejecutarlo.'
}
& aws cloudformation describe-change-set --profile $Profile --region us-east-2 --stack-name $StackName --change-set-name $changeSet --query 'Changes[].ResourceChange.{Accion:Action,Nombre:LogicalResourceId,Tipo:ResourceType}' --output table --no-cli-pager
if ($LASTEXITCODE -ne 0) { throw 'No se pudo leer el change set.' }
Write-Host "Change set preparado, NO ejecutado: $changeSet"
Write-Host "Revisar en AWS CloudFormation > $StackName > Change sets. No hay EC2 creadas por este script."
