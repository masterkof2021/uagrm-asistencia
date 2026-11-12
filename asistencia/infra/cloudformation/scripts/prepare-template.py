"""Normaliza YAML CloudFormation a JSON sin resolver recursos ni ejecutar AWS."""
import argparse
import json
from pathlib import Path
from cfnlint.decode import decode

parser = argparse.ArgumentParser()
parser.add_argument('template', type=Path)
parser.add_argument('output', type=Path)
args = parser.parse_args()
template, errors = decode(str(args.template.resolve()))
if errors or not template:
    raise SystemExit('Template no parseable; ejecutar cfn-lint para ver los detalles.')
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(template, indent=2, ensure_ascii=False), encoding='utf-8')
print(f'JSON normalizado: {args.output.name}; recursos: {len(template.get("Resources", {}))}')
