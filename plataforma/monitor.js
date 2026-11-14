import { readFileSync } from 'node:fs';
import { setTimeout as esperar } from 'node:timers/promises';
import { conectarAws, describirInstancias } from './despliegues.js';
import { iniciarHistorialAlertas } from './alertas.js';

const script = readFileSync(new URL('../observabilidad/muestreo.sh', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const metricas = {
  muestra_up: 'Disponibilidad de la muestra del estado de la instancia',
  cpu_ratio: 'Fraccion de CPU utilizada durante la sonda',
  memoria_ratio: 'Fraccion de memoria utilizada',
  servicio_up: 'Disponibilidad del servicio de la instancia',
  api_up: 'Disponibilidad de la API a traves de Nginx',
  api_latencia_seconds: 'Tiempo de respuesta de la sonda a la API',
  api_errores_5m: 'Respuestas HTTP 5xx de API en los ultimos cinco minutos',
};
const tipos = Object.keys(metricas).map((nombre) =>
  `# HELP pfm2_${nombre} ${metricas[nombre]}.\n# TYPE pfm2_${nombre} gauge`).join('\n');

async function medirInstancia(aws, { rol, id }) {
  const parametros = JSON.stringify({
    commands: [`ROL=${rol} bash <<'PFM2_SONDA'\n${script}\nPFM2_SONDA`],
    executionTimeout: ['25'],
  });
  const { Command } = await aws('ssm', 'send-command', '--instance-ids', id,
    '--document-name', 'AWS-RunShellScript', '--parameters', parametros);
  for (let intento = 0; intento < 12; intento++) {
    const { CommandInvocations } = await aws('ssm', 'list-command-invocations',
      '--command-id', Command.CommandId, '--instance-id', id, '--details');
    const resultado = CommandInvocations[0];
    if (resultado?.Status === 'Success') {
      const medicion = {};
      for (const linea of resultado.CommandPlugins[0]?.Output?.split(/\r?\n/) ?? []) {
        const dato = linea.match(/^([a-z_0-9]+)=([0-9]+(?:\.[0-9]+)?)$/);
        if (dato && Object.hasOwn(metricas, dato[1]) && dato[1] !== 'muestra_up') medicion[dato[1]] = Number(dato[2]);
      }
      return { ...medicion, muestra_up: Number([medicion.servicio_up, medicion.cpu_ratio, medicion.memoria_ratio]
        .every(Number.isFinite)) };
    }
    if (['Failed', 'Cancelled', 'TimedOut'].includes(resultado?.Status)) break;
    await esperar(2500);
  }
  return { muestra_up: 0 };
}

function formatearMuestra(tenant, rol, valores) {
  const etiquetas = `tenant=${JSON.stringify(tenant.identificador)},entorno=${JSON.stringify(tenant.entorno)},rol=${JSON.stringify(rol)}`;
  return Object.entries(valores).filter(([, valor]) => Number.isFinite(valor))
    .map(([nombre, valor]) => `pfm2_${nombre}{${etiquetas}} ${valor}`);
}

async function medirTenant(aws, registro, tenant) {
  const infraestructura = registro.obtenerInfraestructura(tenant.identificador);
  if (!infraestructura?.instancias) return { series: [], respondieron: 0 };
  const roles = ['backend', 'database', 'frontend'];
  let instancias;
  try {
    instancias = await describirInstancias(aws, tenant.identificador, infraestructura.instancias);
  } catch {
    return { series: roles.flatMap((rol) => formatearMuestra(tenant, rol, { muestra_up: 0 })), respondieron: 0 };
  }
  const resultados = await Promise.allSettled(instancias.map((instancia) =>
    instancia.estado === 'running' ? medirInstancia(aws, instancia) : { muestra_up: 1, servicio_up: 0 }));
  const mediciones = resultados.map((resultado) =>
    resultado.status === 'fulfilled' ? resultado.value : { muestra_up: 0 });
  return {
    series: mediciones.flatMap((valores, i) => formatearMuestra(tenant, instancias[i].rol, valores)),
    respondieron: mediciones.filter(({ muestra_up }) => muestra_up === 1).length,
  };
}

export function iniciarMonitor(registro, config) {
  const alertas = iniciarHistorialAlertas(registro);
  let lectura = [];
  let ultima = 0;
  let disponible = 0;
  let enCurso;
  let mediciones = new Map();
  let midiendo;
  let fallo = false;
  async function medir() {
    if (enCurso) return;
    enCurso = (async () => {
      try {
        const activos = registro.listar({ estado: 'listo' });
        const { aws } = activos.length ? await conectarAws(config) : {};
        const muestras = [];
        const ciclo = new Map();
        for (const tenant of activos) {
          midiendo = tenant.identificador;
          const { series, respondieron } = await medirTenant(aws, registro, tenant);
          ciclo.set(midiendo, { respondieron, fecha: new Date().toISOString() });
          muestras.push(...series);
        }
        mediciones = ciclo;
        lectura = muestras;
        disponible = 1;
        fallo = false;
      } catch {
        disponible = 0;
        fallo = true;
        lectura = [];
        mediciones = new Map();
      } finally {
        midiendo = undefined;
      }
      ultima = Date.now() / 1000;
    })();
    try { await enCurso; } finally { enCurso = undefined; }
  }
  const intervalo = setInterval(medir, 60_000);
  intervalo.unref();
  medir();
  return {
    alertas,
    actividad(identificador) {
      const { fuente, ultimaConsulta } = alertas.resumen();
      const tenant = registro.obtener(identificador);
      return {
        habilitado: tenant?.estado === 'listo',
        midiendo: midiendo === identificador,
        fallo,
        ultimaMuestra: mediciones.get(identificador) ?? null,
        fuente, ultimaConsulta,
      };
    },
    leer: () => [
      '# TYPE pfm2_colector_ok gauge', `pfm2_colector_ok ${disponible}`,
      '# TYPE pfm2_colector_timestamp_seconds gauge', `pfm2_colector_timestamp_seconds ${ultima}`,
      tipos, ...lectura, '',
    ].join('\n'),
    async detener() {
      clearInterval(intervalo);
      await Promise.all([enCurso, alertas.detener()]);
    },
  };
}
