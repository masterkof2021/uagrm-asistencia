"""Captura salida nativa sin convertir stderr informativo en errores PowerShell 5.1."""
import argparse
from pathlib import Path
import subprocess
import sys

parser = argparse.ArgumentParser()
parser.add_argument('stdout_path', type=Path)
parser.add_argument('stderr_path', type=Path)
parser.add_argument('command', nargs=argparse.REMAINDER)
args = parser.parse_args()
if not args.command:
    parser.error('Falta el ejecutable del escaner.')
with args.stdout_path.open('wb') as stdout, args.stderr_path.open('wb') as stderr:
    result = subprocess.run(args.command, stdout=stdout, stderr=stderr, shell=False)
sys.exit(result.returncode)
