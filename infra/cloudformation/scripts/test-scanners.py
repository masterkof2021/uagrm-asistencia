"""Controles negativos locales: errores intencionales que nunca se despliegan."""
import json
import os
from pathlib import Path
import subprocess
import uuid
from cfnlint.decode import decode

root = Path(__file__).resolve().parent.parent
tools = root / '.tools'
reports = root / 'reports' / ('negative-' + uuid.uuid4().hex[:8])
reports.mkdir(parents=True)
template, errors = decode(str(root / 'templates' / 'asistencia.yaml'))
if errors:
    raise SystemExit('Primero corregir la sintaxis del template principal.')
template['Resources']['ClientInstance']['Properties']['MetadataOptions']['HttpTokens'] = 'optional'
template['Resources']['BackendInstance']['Properties']['BlockDeviceMappings'][0]['Ebs']['Encrypted'] = False
template['Resources']['ClientSsh']['Properties']['CidrIp'] = '0.0.0.0/0'
bad = reports / 'DO-NOT-DEPLOY.json'
bad.write_text(json.dumps(template, indent=2), encoding='utf-8')
secret_dir = reports / 'synthetic-secret'
secret_dir.mkdir()
# Construccion deliberadamente artificial: ninguna credencial AWS real.
(secret_dir / 'demo.txt').write_text('LAB_' + 'DEMO_TOKEN_' + uuid.uuid4().hex, encoding='utf-8')

def tool(folder, executable):
    matches = list((tools / folder).rglob(executable))
    if not matches:
        raise SystemExit(f'Falta instalar {folder}')
    return str(matches[0])

def run(name, command, expected_text=None):
    env = os.environ.copy()
    env['DOCKER_CONFIG'] = str(tools / 'docker-public')
    result = subprocess.run(command, capture_output=True, text=True, encoding='utf-8', errors='replace', env=env)
    (reports / f'{name}.json').write_text(result.stdout, encoding='utf-8')
    (reports / f'{name}.stderr.txt').write_text(result.stderr, encoding='utf-8')
    if expected_text and expected_text not in result.stdout:
        raise SystemExit(f'{name}: no aparece el hallazgo esperado; revisar el reporte.')
    if result.returncode == 0:
        raise SystemExit(f'{name}: el control negativo paso inesperadamente.')
    return result

run('guard', [tool('guard', 'cfn-guard.exe'), 'validate', '--data', str(bad), '--rules', str(root / 'policies/security.guard'), '--output-format', 'json', '--structured', '--show-summary', 'none'], 'ec2_imdsv2')
run('conftest', [tool('conftest', 'conftest.exe'), 'test', str(bad), '--policy', str(root / 'policies/security.rego'), '--output', 'json'], 'IMDSv2')
trivy = run('trivy', [tool('trivy', 'trivy.exe'), 'config', '--cache-dir', str(tools / 'trivy-cache'), '--misconfig-scanners', 'cloudformation', '--cf-params', str(root / 'parameters.scan.json'), '--format', 'json', '--exit-code', '1', str(bad)])
trivy_data = json.loads(trivy.stdout)
findings = [finding for resource in trivy_data.get('Results', []) for finding in resource.get('Misconfigurations', [])]
if not any(f['ID'] in ('AWS-0028', 'AWS-0008', 'AWS-0107') or 'encrypt' in f.get('Title', '').lower() or 'imds' in f.get('Title', '').lower() for f in findings):
    raise SystemExit('Trivy: falta el hallazgo de cifrado o IMDS del control negativo.')
secret_report = reports / 'gitleaks-findings.json'
run('gitleaks', [tool('gitleaks', 'gitleaks.exe'), 'dir', str(secret_dir), '--config', str(root / 'policies/gitleaks.toml'), '--redact=100', '--no-banner', '--report-format', 'json', '--report-path', str(secret_report)])
if not any(f['RuleID'] == 'lab-demo-token' for f in json.loads(secret_report.read_text(encoding='utf-8-sig'))):
    raise SystemExit('Gitleaks: falta la deteccion del token ficticio.')
print('CONTROLES NEGATIVOS CORRECTOS: Guard, Conftest, Trivy y Gitleaks detectaron los fallos esperados.')
print(f'Reportes locales: {reports}')
