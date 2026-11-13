import { execFile } from 'node:child_process';
import { cp, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('../', import.meta.url));
const herramientas = join(raiz, 'asistencia', 'infra', 'cloudformation', '.tools');
const politica = join(raiz, 'infra', 'seguridad', 'tenant.rego');

function ejecutar(programa, args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(programa, args, { cwd, timeout: 240_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        if (error && !Number.isInteger(error.code)) return reject(error);
        resolve({ codigo: error?.code ?? 0, stdout });
      });
  });
}

function herramienta(nombre) {
  return process.platform === 'win32' ? join(herramientas, nombre, `${nombre}.exe`) : nombre;
}

function resumir(codigo, permitidos, hallazgos) {
  if (!permitidos.includes(codigo)) throw new Error('Código de salida inesperado');
  if (!Array.isArray(hallazgos)) throw new Error('Formato de informe inesperado');
  const reglas = hallazgos.map((id) => /^[A-Za-z0-9:_.-]{1,100}$/.test(id ?? '') ? id : 'sin-identificador');
  return { hallazgos: reglas.length, reglas: [...new Set(reglas)].slice(0, 30) };
}

export async function escanearDespliegue({ motor, directorio, archivo, instancias }) {
  const dir = join(directorio, 'escaneos');
  await mkdir(dir, { recursive: true });
  const ejecutarLocal = (nombre, args) => ejecutar(herramienta(nombre), args, dir);
  const inventario = join(dir, 'politica.json');
  await writeFile(inventario, JSON.stringify({ instancias }));
  const fuente = join(dir, 'fuente');
  const reporte = join(dir, 'gitleaks.json');
  const dependencia = motor === 'pulumi';

  const controles = [
    ['trivy', dependencia ? 'Dependencias del programa Pulumi' : 'Configuración del motor', async () => {
      const args = dependencia ? ['fs', '--scanners', 'vuln', '--pkg-types', 'library'] :
        ['config', '--misconfig-scanners', motor === 'cloudformation' ? 'cloudformation' : 'terraformplan-json'];
      const { codigo, stdout } = await ejecutarLocal('trivy',
        [...args, '--quiet', '--format', 'json', '--exit-code', '10', '--cache-dir', join(herramientas, 'trivy-cache'), archivo]);
      const informe = JSON.parse(stdout);
      if (!Array.isArray(informe.Results)) throw new Error('Trivy no reconoció el objetivo');
      const ids = informe.Results.flatMap((r) => dependencia ?
        (r.Vulnerabilities ?? []).map((v) => v.VulnerabilityID) :
        (r.Misconfigurations ?? []).map((v) => v.ID));
      return resumir(codigo, [0, 10], ids);
    }],
    ['gitleaks', 'Código de infraestructura y plataforma', async () => {
      try {
        await mkdir(fuente, { recursive: true });
        const { codigo, stdout } = await ejecutar('git', ['ls-files', '-z', '--cached', '--others',
          '--exclude-standard', '--', 'infra', 'plataforma', 'asistencia/src', 'asistencia/deploy'], raiz);
        if (codigo !== 0) throw new Error('No se pudo preparar el código');
        for (const nombre of new Set(stdout.split('\0').filter(Boolean))) {
          const origen = join(raiz, nombre);
          const info = await lstat(origen).catch((error) => {
            if (error.code !== 'ENOENT') throw error;
          });
          if (!info?.isFile()) continue;
          const destino = join(fuente, nombre);
          await mkdir(dirname(destino), { recursive: true });
          await cp(origen, destino);
        }
        const resultado = await ejecutarLocal('gitleaks', ['dir', fuente, '--redact=100', '--no-banner',
          '--exit-code', '10', '--report-format', 'json', '--report-path', reporte]);
        if (![0, 10].includes(resultado.codigo)) throw new Error('Gitleaks falló');
        const informe = JSON.parse(await readFile(reporte, 'utf8'));
        return resumir(resultado.codigo, [0, 10], (informe ?? []).map(({ RuleID }) => RuleID));
      } finally {
        await rm(fuente, { recursive: true, force: true });
        await rm(reporte, { force: true });
      }
    }],
    ['conftest', dependencia ? 'Tres EC2 en Pulumi, IMDSv2 y cifrado en las altas' : 'Tres EC2, IMDSv2 y cifrado', async () => {
      const { codigo, stdout } = await ejecutarLocal('conftest', ['test', inventario, '--policy', politica, '--output', 'json']);
      const informe = JSON.parse(stdout);
      if (!Array.isArray(informe) || !informe.some((r) => r.successes || r.failures?.length)) {
        throw new Error('Conftest no ejecutó las políticas');
      }
      return resumir(codigo, [0, 1], informe.flatMap((r) => (r.failures ?? []).map(({ msg }) => msg)));
    }],
  ];

  const resultados = [];
  for (const [nombre, alcance, comprobar] of controles) {
    const fecha = new Date().toISOString();
    let version = null;
    try {
      const v = await ejecutarLocal(nombre, [nombre === 'gitleaks' ? 'version' : '--version']);
      version = v.stdout.match(/\b\d+\.\d+\.\d+\b/)?.[0] ?? null;
      if (v.codigo !== 0 || !version) throw new Error('Versión no disponible');
      const resumen = await comprobar();
      resultados.push({ nombre, alcance, fecha, version,
        estado: resumen.hallazgos ? 'hallazgos' : 'sin-hallazgos', ...resumen });
    } catch {
      resultados.push({ nombre, alcance, fecha, version, estado: 'error', hallazgos: null, reglas: [] });
    }
  }
  return resultados;
}
