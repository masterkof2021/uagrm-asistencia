"""Actualiza SOLO la instantanea IPv4 autorizada; no llama ni modifica AWS."""
import ipaddress
import json
from pathlib import Path
import socket

HOSTS = ('registry.npmjs.org', 'repo.mysql.com')
root = Path(__file__).resolve().parent.parent
path = root / 'templates/asistencia.yaml'
entries = {}
for host in HOSTS:
    addresses = {row[4][0] for row in socket.getaddrinfo(host, 443, socket.AF_INET, socket.SOCK_STREAM)}
    if not addresses:
        raise SystemExit(f'Sin IPv4 para {host}; no se modifica el template.')
    for address in addresses:
        if not ipaddress.ip_address(address).is_global:
            raise SystemExit(f'DNS no publico para {host}; revisar antes de continuar.')
        entries.setdefault(address, set()).add(host)
# Evidencia DNS de EC2 revisada manualmente; no aceptar hosts adicionales.
for observation in json.loads((root / 'policies/egress-observations.json').read_text(encoding='utf-8')):
    address = ipaddress.ip_address(observation['ipv4'])
    host = observation['host']
    if host not in HOSTS or address.version != 4 or not address.is_global:
        raise SystemExit('Observacion no autorizada; no se modifica el template.')
    entries.setdefault(str(address), set()).add(host)
if len(entries) > 20:
    raise SystemExit('Mas de 20 destinos: revisar cuotas SG antes de ampliar la lista.')
start = '      # BEGIN APPROVED DOWNLOAD IPV4\n'
end = '      # END APPROVED DOWNLOAD IPV4\n'
text = path.read_text(encoding='utf-8')
before, remainder = text.split(start)
_, after = remainder.split(end)
block = '      Entries:\n'
for address in sorted(entries, key=ipaddress.ip_address):
    block += f'        - Cidr: {address}/32\n          Description: {", ".join(sorted(entries[address]))}\n'
path.write_text(before + start + block + end + after, encoding='utf-8')
print(f'Instantanea preparada: {len(entries)} IPv4 /32. Revisar git diff y ejecutar los scans.')
print('DNS desde este PC puede diferir del DNS de EC2. Probar descargas desde ambos servidores.')
print('Una lista de IP no restringe dominios ni contenido alojado en CDN compartidas.')
