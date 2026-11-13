const grupoProyecto = 'uagrm-tenants';

export async function consultarAlertas(origen = 'http://127.0.0.1:9090') {
  const url = new URL('/api/v1/rules', origen);
  url.search = new URLSearchParams({ type: 'alert', 'rule_group[]': grupoProyecto });
  const respuesta = await fetch(url, { signal: AbortSignal.timeout(3000), redirect: 'error' });
  if (!respuesta.ok) throw new Error('Prometheus no está disponible.');
  const { status, data } = await respuesta.json();
  const reglas = data?.groups?.find(({ name }) => name === grupoProyecto)?.rules;
  if (status !== 'success' || !reglas?.length || reglas.some(({ health }) => health !== 'ok')) {
    throw new Error('Las reglas de Prometheus no están disponibles.');
  }
  return reglas.flatMap(({ alerts }) => alerts.filter(({ state }) => state === 'firing')
    .map(({ labels, annotations, activeAt }) => {
      if (typeof labels?.alertname !== 'string' || !Number.isFinite(Date.parse(activeAt))) {
        throw new Error('Prometheus devolvió una alerta sin identidad o fecha.');
      }
      return {
        alerta: labels.alertname, tenant: labels.tenant, entorno: labels.entorno,
        rol: labels.rol, severidad: labels.severidad, mensaje: annotations?.resumen ?? labels.alertname,
        deteccion: new Date(activeAt).toISOString(),
      };
    }));
}

export function iniciarHistorialAlertas(registro, { consultar = consultarAlertas, intervalo = 15_000 } = {}) {
  let activas = null;
  let fuente = 'iniciando';
  let ultimaConsulta = null;
  let enCurso;
  async function actualizar() {
    if (enCurso) return;
    enCurso = (async () => {
      try {
        const respuesta = await consultar();
        const ahora = new Date().toISOString();
        registro.registrarAlertas(respuesta, ahora);
        activas = respuesta;
        ultimaConsulta = ahora;
        fuente = 'disponible';
      } catch {
        activas = null;
        fuente = 'sin-datos';
      }
    })();
    try { await enCurso; } finally { enCurso = undefined; }
  }
  const sondeo = setInterval(actualizar, intervalo);
  sondeo.unref();
  actualizar();
  return {
    activas: () => activas,
    resumen: () => ({ activas, fuente, ultimaConsulta, eventos: registro.eventosAlertas() }),
    async detener() { clearInterval(sondeo); await enCurso; },
  };
}
