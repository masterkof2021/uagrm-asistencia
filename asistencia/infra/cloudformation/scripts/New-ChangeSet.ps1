[CmdletBinding()]
param(
  [switch]$RecoverRetainedBuckets,
  [ValidateSet('CREATE','UPDATE')][string]$ChangeSetType = 'CREATE',
  [string]$Profile = 'pulumi-lab',
  [ValidatePattern('^asistencia-cfn-[a-zA-Z0-9-]+$')][string]$StackName = 'asistencia-cfn-lab'
)
$ErrorActionPreference = 'Stop'
$labRoot = Split-Path $PSScriptRoot -Parent
$parameters = Join-Path $labRoot 'parameters.local.json'
if (!(Test-Path -LiteralPath $parameters)) { throw 'Crear parameters.local.json con New-LabParameters.ps1.' }
$checkedParams = Get-Content -LiteralPath $parameters -Raw | ConvertFrom-Json
foreach ($item in $checkedParams) {
  if ($item.ParameterValue -isnot [string]) { throw 'Parametro no textual. Regenerar parameters.local.json con New-LabParameters.ps1.' }
}
$identityText = & aws sts get-caller-identity --profile $Profile --output json --no-cli-pager
if ($LASTEXITCODE -ne 0) { throw 'Fallo de autenticacion AWS.' }
$identity = $identityText | ConvertFrom-Json
if ($identity.Account -ne '487450071663') { throw 'Cuenta AWS distinta de la prevista para el laboratorio.' }
$template = Join-Path $labRoot 'templates/asistencia.yaml'
$importArguments = @()
if ($RecoverRetainedBuckets) {
  if ($ChangeSetType -ne 'UPDATE' -or $StackName -ne 'asistencia-cfn-lab') { throw 'La recuperacion solo se admite en UPDATE de asistencia-cfn-lab.' }
  # Auto-import requiere nombres literales; no admite Fn::Sub en BucketName.
  # La variante local conserva el template principal portable.
  # Conservar YAML y la forma original de GetAtt: normalizar a JSON puede
  # producir cambios sintacticos que CloudFormation marca como reemplazos.
  $recoveryTemplate = Join-Path $labRoot 'recovery-template.local.yaml'
  $recovery = Get-Content -LiteralPath $template -Raw
  $managedText = & aws cloudformation list-stack-resources --profile $Profile --region us-east-2 --stack-name $StackName --query 'StackResourceSummaries[?ResourceType==`AWS::S3::Bucket`].LogicalResourceId' --output text --no-cli-pager
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo consultar los buckets ya administrados por la pila.' }
  $managedBuckets = @(($managedText -join ' ') -split '\s+' | Where-Object { $_ -and $_ -ne 'None' })
  $expectedBucketImports = @(@('AccessLogsBucket','FlowLogsBucket') | Where-Object { $_ -notin $managedBuckets })
  foreach ($item in @(
    @{Suffix='accesslogs';Name='asistencia-cfn-lab-accesslogs-487450071663-us-east-2'},
    @{Suffix='flowlogs';Name='asistencia-cfn-lab-flowlogs-487450071663-us-east-2'}
  )) {
    & aws s3api head-bucket --bucket $item.Name --expected-bucket-owner '487450071663' --profile $Profile --region us-east-2 --no-cli-pager
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo verificar el bucket retenido y su propietario.' }
    $original = 'BucketName: !Sub ''${AWS::StackName}-' + $item.Suffix + '-${AWS::AccountId}-${AWS::Region}'''
    if ([regex]::Matches($recovery, [regex]::Escape($original)).Count -ne 1) { throw 'No se encontro exactamente un BucketName esperado; revisar template.' }
    $recovery = $recovery.Replace($original, ('BucketName: ''' + $item.Name + ''''))
  }
  [IO.File]::WriteAllText($recoveryTemplate, $recovery, [Text.UTF8Encoding]::new($false))
  $template = $recoveryTemplate
  $importArguments = @('--import-existing-resources')
}
if ((Get-Item -LiteralPath $template).Length -gt 51200) { throw 'TemplateBody excede 51200 bytes; compactar antes de enviarlo. No se creo el change set.' }
& aws cloudformation validate-template --profile $Profile --region us-east-2 --template-body "file://$template" --no-cli-pager
if ($LASTEXITCODE -ne 0) { throw 'Validacion del servicio fallida.' }
$changeSet = 'asistencia-cfn-preview-' + (Get-Date -Format 'yyyyMMddHHmmss')
if ($ChangeSetType -eq 'UPDATE') {
  # Conserva claves y acceso vigentes; solo incorpora el nuevo parametro S3.
  $existingText = & aws cloudformation describe-stacks --profile $Profile --region us-east-2 --stack-name $StackName --output json --no-cli-pager
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo consultar el stack existente.' }
  $existing = ($existingText | ConvertFrom-Json).Stacks[0]
  if ($existing.StackStatus -notin @('CREATE_COMPLETE','UPDATE_COMPLETE','UPDATE_ROLLBACK_COMPLETE')) { throw 'Estado de stack no apto para UPDATE.' }
  $localParams = Get-Content -LiteralPath $parameters -Raw | ConvertFrom-Json
  $s3 = @($localParams | Where-Object ParameterKey -eq 'S3PrefixListId')
  if ($s3.Count -ne 1) { throw 'Regenerar parametros para incluir S3PrefixListId.' }
  $updateParams = @($existing.Parameters | ForEach-Object { @{ParameterKey=$_.ParameterKey;UsePreviousValue=$true} })
  $updateParams = @($updateParams | Where-Object ParameterKey -ne 'S3PrefixListId') + @(@{ParameterKey='S3PrefixListId';ParameterValue=$s3[0].ParameterValue})
  $parameters = Join-Path $labRoot 'parameters.update.local.json'
  [IO.File]::WriteAllText($parameters, ($updateParams | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
}
& aws cloudformation create-change-set --profile $Profile --region us-east-2 --stack-name $StackName --change-set-name $changeSet --change-set-type $ChangeSetType --template-body "file://$template" --parameters "file://$parameters" --description 'Revision academica; no ejecutar sin revisar recursos y costos' @importArguments --no-cli-pager
if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear el change set; revisar nombre, permisos y estado del stack.' }
& aws cloudformation wait change-set-create-complete --profile $Profile --region us-east-2 --stack-name $StackName --change-set-name $changeSet
if ($LASTEXITCODE -ne 0) {
  & aws cloudformation describe-change-set --profile $Profile --region us-east-2 --stack-name $StackName --change-set-name $changeSet --no-cli-pager
  throw 'El change set no termino correctamente. No ejecutarlo.'
}
$detailText = & aws cloudformation describe-change-set --profile $Profile --region us-east-2 --stack-name $StackName --change-set-name $changeSet --output json --no-cli-pager
if ($LASTEXITCODE -ne 0) { throw 'No se pudo leer el change set.' }
$details = $detailText | ConvertFrom-Json
$details.Changes.ResourceChange | Select-Object Action,LogicalResourceId,ResourceType,Replacement | Format-Table -AutoSize
$expectedRuleReplacements = @('ClientHttpOutbound','ClientHttpsOutbound','BackendHttpOutbound','BackendHttpsOutbound')
$unsafeChanges = @($details.Changes.ResourceChange | Where-Object {
  $expectedRule = $_.ResourceType -eq 'AWS::EC2::SecurityGroupEgress' -and
    $_.LogicalResourceId -in $expectedRuleReplacements -and $_.Action -eq 'Modify' -and $_.Replacement -eq 'True'
  $_.ResourceType -eq 'AWS::EC2::Instance' -or $_.Action -eq 'Remove' -or
    ($_.Replacement -in @('True','Conditional') -and !$expectedRule)
})
if ($ChangeSetType -eq 'UPDATE' -and $unsafeChanges.Count -gt 0) {
  throw 'DETENER: cambios en instancias, eliminaciones o reemplazos no previstos. NO ejecutar este change set.'
}
if ($RecoverRetainedBuckets) {
  $imports = @($details.Changes.ResourceChange | Where-Object Action -eq 'Import')
  if ($imports.Count -ne $expectedBucketImports.Count -or @($imports | Where-Object { $_.LogicalResourceId -notin $expectedBucketImports -or $_.ResourceType -ne 'AWS::S3::Bucket' }).Count -gt 0) {
    throw 'DETENER: importaciones distintas de los buckets pendientes de recuperar. No ejecutar.'
  }
}
Write-Host "Change set preparado, NO ejecutado: $changeSet"
Write-Host "Revisar en AWS CloudFormation > $StackName > Change sets. No hay EC2 creadas por este script."
