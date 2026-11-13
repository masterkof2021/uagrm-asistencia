import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogo } from './catalogo.js';
import { abrirRegistro, validarRegistro } from './tenants.js';
import { configurarDespliegue, ejecutarOperacionAws, iniciarTrabajador } from './despliegues.js';
import { iniciarMonitor } from './monitor.js';

const archivos = new Map([
  ['/', ['index.html', 'text/html']],
  ['/app.js', ['app.js', 'text/javascript']],
  ['/styles.css', ['styles.css', 'text/css']],
]);
const limiteBytes = 16 * 1024;

function responder(res, status, contenido, tipo = 'application/json') {
  res.writeHead(status, {
    'Content-Type': `${tipo}; charset=utf-8`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  });
  res.end(tipo === 'application/json' ? JSON.stringify(contenido) : contenido);
}

async function leerRegistro(req, res) {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    responder(res, 415, { mensaje: 'El registro debe enviarse como JSON.' });
    return;
  }
  const partes = [];
  let bytes = 0;
  for await (const parte of req) {
    bytes += parte.length;
    if (bytes <= limiteBytes) partes.push(parte);
  }
  if (bytes > limiteBytes) {
    responder(res, 413, { mensaje: 'Los datos del registro exceden el tamaño admitido.' });
    return;
  }
  try {
    return validarRegistro(JSON.parse(Buffer.concat(partes).toString('utf8')));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    responder(res, 400, { mensaje: 'El JSON del registro no es válido.' });
  }
}

export function crearServidor(registro, despliegueHabilitado = false, monitor = null) {
  const contenidoEstatico = new Map(Array.from(archivos, ([ruta, [archivo, tipo]]) => [
    ruta, [readFileSync(new URL(`public/${archivo}`, import.meta.url)), tipo],
  ]));

  return createServer(async (req, res) => {
    try {
      const host = req.headers.host;
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host ?? '')) {
        return responder(res, 403, { mensaje: 'Acceso restringido al equipo local.' });
      }
      if (req.headers.origin && req.headers.origin !== `http://${host}`) {
        return responder(res, 403, { mensaje: 'Origen de la solicitud no autorizado.' });
      }

      const { pathname, searchParams } = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && contenidoEstatico.has(pathname)) {
        const [contenido, tipo] = contenidoEstatico.get(pathname);
        return responder(res, 200, contenido, tipo);
      }
      if (req.method === 'GET' && pathname === '/api/catalogo') {
        return responder(res, 200, { ...catalogo, despliegueHabilitado, observabilidadHabilitada: Boolean(monitor) });
      }
      if (req.method === 'GET' && pathname === '/metrics' && monitor) {
        return responder(res, 200, monitor.leer(), 'text/plain; version=0.0.4');
      }
      if (req.method === 'GET' && pathname === '/api/alertas' && monitor) {
        const activas = monitor.alertas.activas();
        return activas ? responder(res, 200, activas)
          : responder(res, 503, { mensaje: 'No hay una lectura actual de las reglas de Prometheus.' });
      }
      if (req.method === 'GET' && pathname === '/api/alertas/resumen' && monitor) {
        return responder(res, 200, monitor.alertas.resumen());
      }
      if (req.method === 'GET' && pathname === '/api/tenants') {
        const filtros = {};
        for (const campo of ['buscar', 'entorno', 'plan', 'estado']) {
          filtros[campo] = searchParams.get(campo)?.trim();
        }
        return responder(res, 200, registro.listar(filtros));
      }
      if (req.method === 'POST' && pathname === '/api/tenants') {
        const validacion = await leerRegistro(req, res);
        if (!validacion) return;
        const { errores, datos } = validacion;
        if (Object.keys(errores).length) {
          return responder(res, 422, { mensaje: 'Revisa los datos del formulario.', errores });
        }
        const tenant = registro.crear(datos);
        if (!tenant) {
          return responder(res, 409, {
            mensaje: 'El identificador ya está registrado.',
            errores: { identificador: 'Elige un identificador diferente.' },
          });
        }
        return responder(res, 201, tenant);
      }
      const rutaDespliegues = pathname.match(/^\/api\/tenants\/([a-z0-9-]{3,40})\/(despliegues|suspender|reanudar|preparar-retiro|(?:retirar|cancelar-retiro)\/[1-9][0-9]*)$/);
      if (rutaDespliegues && (req.method === 'POST' || (req.method === 'GET' && rutaDespliegues[2] === 'despliegues'))) {
        const tenant = registro.obtener(rutaDespliegues[1]);
        if (!tenant) return responder(res, 404, { mensaje: 'Tenant no encontrado.' });
        if (req.method === 'GET') return responder(res, 200, registro.consultar(tenant.identificador));
        if (!despliegueHabilitado) return responder(res, 503, { mensaje: 'Configura el rol y el estado de AWS en el panel.' });
        if (!catalogo.motoresEjecutables.includes(tenant.motor)) {
          return responder(res, 409, { mensaje: 'El motor del tenant no está disponible para desplegar.' });
        }
        const [accion, revision] = rutaDespliegues[2].split('/');
        if (accion === 'cancelar-retiro') {
          if (!registro.cancelarRetiro(tenant.identificador, Number(revision))) {
            return responder(res, 409, { mensaje: 'La revisión de retiro ya no está disponible.' });
          }
          return responder(res, 200, { mensaje: 'Se canceló el retiro.' });
        }
        const tipo = accion === 'despliegues' ? 'desplegar' : accion;
        const trabajo = registro.encolar(tenant.identificador, tipo, Number(revision));
        if (!trabajo) return responder(res, 409, { mensaje: 'El estado actual del tenant no permite esta operación.' });
        return responder(res, 202, trabajo);
      }
      return responder(res, 404, { mensaje: 'Ruta no encontrada.' });
    } catch (error) {
      console.error('Error en el servidor local:', error.code ?? error.name);
      if (!res.headersSent) responder(res, 500, { mensaje: 'No se pudo completar la solicitud.' });
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const rutaDb = process.env.TENANTS_DB ?? fileURLToPath(new URL('data/tenants.sqlite', import.meta.url));
  mkdirSync(dirname(rutaDb), { recursive: true });
  const registro = abrirRegistro(rutaDb);
  const puerto = Number(process.env.PORT ?? 4173);
  const config = configurarDespliegue();
  const monitor = config && process.env.PFM2_MONITORING === '1' ? iniciarMonitor(registro, config) : null;
  const servidor = crearServidor(registro, Boolean(config), monitor);
  const detener = config && iniciarTrabajador(registro, resolve(dirname(rutaDb), 'despliegues'),
    (trabajo) => ejecutarOperacionAws({ ...trabajo, config }));
  servidor.once('close', async () => {
    await Promise.all([detener?.(), monitor?.detener()]);
    registro.cerrar();
  });
  servidor.listen(puerto, '127.0.0.1', () => {
    console.log(`Plataforma disponible en http://127.0.0.1:${servidor.address().port}`);
  });
}
