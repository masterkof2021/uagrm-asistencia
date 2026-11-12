#!/usr/bin/env python3
"""Ejecuta una herramienta con credenciales temporales de AWS CLI en memoria."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

parser = argparse.ArgumentParser()
parser.add_argument('--profile', default=os.environ.get('AWS_PROFILE', 'default'))
parser.add_argument('command', nargs=argparse.REMAINDER)
args = parser.parse_args()
if not args.command:
    parser.error('Falta el comando que se ejecutará.')
result = subprocess.run(
    ['aws', 'configure', 'export-credentials', '--profile', args.profile, '--format', 'process'],
    capture_output=True, text=True,
)
if result.returncode:
    sys.stderr.write(result.stderr)
    sys.exit(result.returncode)
credentials = json.loads(result.stdout)
env = os.environ.copy()
env['AWS_ACCESS_KEY_ID'] = credentials['AccessKeyId']
env['AWS_SECRET_ACCESS_KEY'] = credentials['SecretAccessKey']
if credentials.get('SessionToken'):
    env['AWS_SESSION_TOKEN'] = credentials['SessionToken']
else:
    env.pop('AWS_SESSION_TOKEN', None)
env.pop('AWS_PROFILE', None)
env.setdefault('AWS_REGION', 'us-east-2')
env.setdefault('AWS_DEFAULT_REGION', 'us-east-2')
root = Path(__file__).resolve().parent.parent
local = root / '.pulumi'
local.mkdir(mode=0o700, exist_ok=True)
(local / 'home').mkdir(mode=0o700, exist_ok=True)
passphrase = local / 'passphrase'
if not env.get('PULUMI_CONFIG_PASSPHRASE_FILE') and 'PULUMI_CONFIG_PASSPHRASE' not in env:
    if not passphrase.is_file():
        sys.exit('Falta la contraseña del stack compartido. Proporciona PULUMI_CONFIG_PASSPHRASE_FILE o restaura .pulumi/passphrase por un canal seguro; no generes una contraseña nueva.')
    env['PULUMI_CONFIG_PASSPHRASE_FILE'] = str(passphrase)
env.setdefault('PULUMI_HOME', str(root / '.pulumi/home'))
# Pulumi usa backend.url de cada proyecto. PULUMI_BACKEND_URL puede sobrescribirlo
# explícitamente para recuperación o una migración coordinada.
sys.exit(subprocess.run(args.command, env=env).returncode)
