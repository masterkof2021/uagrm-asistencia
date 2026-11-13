import { DatabaseSync } from 'node:sqlite';
import { catalogo } from './catalogo.js';

const texto = (valor) => typeof valor === 'string' ? valor.trim() : '';
const slugValido = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const correoValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const contiene = (opciones, id) => opciones.some((opcion) => opcion.id === id);

export function validarRegistro(datos) {
  const nombre = texto(datos?.nombre);
  const identificador = texto(datos?.identificador).toLowerCase();
  const correo = texto(datos?.correo);
  const entorno = texto(datos?.entorno);
  const motor = texto(datos?.motor);
  const plan = catalogo.planes.find(({ id }) => id === datos?.plan);
  const errores = {};

  if (nombre.length < 2 || nombre.length > 120) errores.nombre = 'Escribe entre 2 y 120 caracteres.';
  if (identificador.length < 3 || identificador.length > 40 || !slugValido.test(identificador)) {
    errores.identificador = 'Usa de 3 a 40 letras sin tildes, números o guiones entre palabras.';
  }
  if (correo.length > 254 || !correoValido.test(correo)) errores.correo = 'Escribe un correo válido.';
  if (!contiene(catalogo.entornos, entorno)) errores.entorno = 'Selecciona un entorno del catálogo.';
  if (!plan) errores.plan = 'Selecciona un plan del catálogo.';
  if (!contiene(catalogo.motores, motor)) errores.motor = 'Selecciona un motor del catálogo.';

  return { errores, datos: { nombre, identificador, correo, entorno, motor, plan } };
}

function leerTenant(fila) {
  return { ...fila, plan: JSON.parse(fila.plan) };
}

export function abrirRegistro(ruta) {
  const db = new DatabaseSync(ruta);
  db.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS tenants (
      identificador TEXT PRIMARY KEY NOT NULL,
      nombre TEXT NOT NULL,
      correo TEXT NOT NULL,
      entorno TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      plan TEXT NOT NULL,
      motor TEXT NOT NULL,
      region TEXT NOT NULL,
      estado TEXT NOT NULL DEFAULT 'registrado',
      creado TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS despliegues (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(identificador),
      tipo TEXT NOT NULL DEFAULT 'desplegar',
      estado_anterior TEXT,
      estado TEXT NOT NULL,
      fase TEXT NOT NULL,
      actualizado TEXT NOT NULL,
      salida TEXT
    );
    CREATE INDEX IF NOT EXISTS despliegues_por_tenant ON despliegues (tenant_id, id DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS despliegue_activo_por_tenant ON despliegues (tenant_id)
      WHERE estado IN ('en-cola', 'en-curso');
    CREATE TABLE IF NOT EXISTS alertas (
      clave TEXT PRIMARY KEY NOT NULL,
      alerta TEXT NOT NULL,
      tenant TEXT,
      entorno TEXT,
      rol TEXT,
      severidad TEXT,
      mensaje TEXT NOT NULL,
      deteccion TEXT NOT NULL,
      resuelta TEXT
    );
    CREATE INDEX IF NOT EXISTS alertas_por_deteccion ON alertas (deteccion);
    CREATE INDEX IF NOT EXISTS alertas_por_resolucion ON alertas (resuelta);
    CREATE TABLE IF NOT EXISTS auditoria (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(identificador),
      operador TEXT NOT NULL,
      accion TEXT NOT NULL,
      trabajo_id INTEGER REFERENCES despliegues(id),
      fecha TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS auditoria_por_tenant ON auditoria (tenant_id, id DESC);
  `);
  transaccion(() => {
    const columnas = db.prepare("PRAGMA table_info(despliegues)").all();
    if (!columnas.some(({ name }) => name === 'tipo')) {
      db.exec("ALTER TABLE despliegues ADD COLUMN tipo TEXT NOT NULL DEFAULT 'desplegar'");
    }
    if (!columnas.some(({ name }) => name === 'estado_anterior')) {
      db.exec('ALTER TABLE despliegues ADD COLUMN estado_anterior TEXT');
    }
    if (!columnas.some(({ name }) => name === 'escaneos')) {
      db.exec('ALTER TABLE despliegues ADD COLUMN escaneos TEXT');
    }
  });

  const insertar = db.prepare(`
    INSERT INTO tenants (identificador, nombre, correo, entorno, plan_id, plan, motor, region, creado)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(identificador) DO NOTHING
    RETURNING identificador, nombre, correo, entorno, plan, motor, region, estado, creado
  `);
  const listar = db.prepare(`
    SELECT t.*, d.fase AS fase_despliegue, d.tipo AS tipo_despliegue
    FROM tenants t
    LEFT JOIN despliegues d ON d.id = (
      SELECT id FROM despliegues WHERE tenant_id = t.identificador ORDER BY id DESC LIMIT 1
    )
    WHERE (? = '' OR instr(lower(nombre), lower(?)) > 0 OR instr(identificador, lower(?)) > 0)
      AND (? = '' OR entorno = ?)
      AND (? = '' OR plan_id = ?)
      AND (? = '' OR t.estado = ?)
    ORDER BY creado DESC, identificador
  `);
  const porId = db.prepare('SELECT * FROM tenants WHERE identificador = ?');
  const actualizarTenant = db.prepare('UPDATE tenants SET estado = ? WHERE identificador = ?');
  const ultimoTipo = db.prepare('SELECT tipo FROM despliegues WHERE tenant_id = ? ORDER BY id DESC LIMIT 1');
  const ultimaSalida = db.prepare(`
    SELECT salida FROM despliegues
    WHERE tenant_id = ? AND tipo IN ('desplegar', 'suspender', 'reanudar') AND salida IS NOT NULL
    ORDER BY id DESC LIMIT 1
  `);
  const despliegueOriginal = db.prepare(`
    SELECT id FROM despliegues WHERE tenant_id = ? AND tipo = 'desplegar' AND estado = 'listo'
    ORDER BY id DESC LIMIT 1
  `);
  const vistaPrevia = db.prepare(`
    SELECT id, estado_anterior, salida FROM despliegues
    WHERE tenant_id = ? AND tipo = 'preparar-retiro' AND estado = 'retiro-pendiente'
    ORDER BY id DESC LIMIT 1
  `);
  const cerrarVista = db.prepare(`
    UPDATE despliegues SET estado = ?, fase = ?, actualizado = ? WHERE id = ?
  `);
  const encolar = db.prepare(`
    INSERT INTO despliegues (tenant_id, tipo, estado_anterior, estado, fase, actualizado)
    VALUES (?, ?, ?, 'en-cola', 'Esperando turno.', ?)
    ON CONFLICT DO NOTHING
    RETURNING id, tenant_id, tipo, estado, fase, actualizado
  `);
  const reclamar = db.prepare(`
    UPDATE despliegues SET estado = 'en-curso', fase = 'Preparando la operación en AWS.', actualizado = ?
    WHERE id = (SELECT id FROM despliegues WHERE estado = 'en-cola' ORDER BY id LIMIT 1)
      AND NOT EXISTS (SELECT 1 FROM despliegues WHERE estado = 'en-curso')
    RETURNING id, tenant_id, tipo
  `);
  const consultar = db.prepare('SELECT * FROM despliegues WHERE tenant_id = ? ORDER BY id DESC');
  const guardarEscaneos = db.prepare("UPDATE despliegues SET escaneos = ? WHERE id = ? AND estado = 'en-curso'");
  const actualizar = db.prepare(`
    UPDATE despliegues SET estado = ?, fase = ?, actualizado = ?, salida = ?
    WHERE id = ? AND estado = 'en-curso'
    RETURNING tenant_id, tipo
  `);
  const tocar = db.prepare("UPDATE despliegues SET actualizado = ? WHERE id = ? AND estado = 'en-curso'");
  const vencer = db.prepare(`
    UPDATE despliegues SET estado = 'error', fase = 'El proceso se interrumpió. Puedes reintentar.', actualizado = ?
    WHERE estado = 'en-curso' AND actualizado < ?
    RETURNING tenant_id
  `);
  const fecha = () => new Date().toISOString();
  const registrarAuditoria = db.prepare(
    'INSERT INTO auditoria (tenant_id, operador, accion, trabajo_id, fecha) VALUES (?, ?, ?, ?, ?)',
  );
  const consultarAuditoria = db.prepare(
    'SELECT operador, accion, trabajo_id, fecha FROM auditoria WHERE tenant_id = ? ORDER BY id DESC',
  );
  const guardarAlerta = db.prepare(`
    INSERT INTO alertas (clave, alerta, tenant, entorno, rol, severidad, mensaje, deteccion)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(clave) DO UPDATE SET resuelta = NULL WHERE alertas.resuelta IS NOT NULL
  `);
  const alertasAbiertas = db.prepare('SELECT clave FROM alertas WHERE resuelta IS NULL');
  const resolverAlerta = db.prepare('UPDATE alertas SET resuelta = ? WHERE clave = ?');
  const eventosAlertas = db.prepare(`
    SELECT alerta, tenant, entorno, rol, severidad, mensaje, deteccion,
      deteccion AS fecha, 'detectada' AS evento
    FROM alertas WHERE deteccion >= ?
    UNION ALL
    SELECT alerta, tenant, entorno, rol, severidad, mensaje, deteccion,
      resuelta AS fecha, 'resuelta' AS evento
    FROM alertas WHERE resuelta >= ?
    ORDER BY fecha DESC, evento DESC, alerta, tenant, rol
    LIMIT 50
  `);

  function transaccion(operacion) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const resultado = operacion();
      db.exec('COMMIT');
      return resultado;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  return {
    crear({ identificador, nombre, correo, entorno, motor, plan }, operador) {
      return transaccion(() => {
        const ahora = fecha();
        const fila = insertar.get(identificador, nombre, correo, entorno, plan.id, JSON.stringify(plan),
          motor, catalogo.region, ahora);
        if (fila && operador) registrarAuditoria.run(identificador, operador, 'registrar', null, ahora);
        return fila ? leerTenant(fila) : null;
      });
    },
    listar({ buscar = '', entorno = '', plan = '', estado = '' } = {}) {
      return listar.all(buscar, buscar, buscar, entorno, entorno, plan, plan, estado, estado).map(leerTenant);
    },
    obtener(identificador) {
      const fila = porId.get(identificador);
      return fila && leerTenant(fila);
    },
    registrarAlertas(activas, ahora) {
      transaccion(() => {
        const claves = new Set();
        for (const { alerta, tenant = null, entorno = null, rol = null, severidad = null, mensaje, deteccion } of activas) {
          const clave = JSON.stringify([alerta, tenant, entorno, rol, severidad, deteccion]);
          claves.add(clave);
          guardarAlerta.run(clave, alerta, tenant, entorno, rol, severidad, mensaje, deteccion);
        }
        for (const { clave } of alertasAbiertas.all()) {
          if (!claves.has(clave)) resolverAlerta.run(ahora, clave);
        }
      });
    },
    eventosAlertas() {
      const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      return eventosAlertas.all(desde, desde);
    },
    encolar(identificador, tipo = 'desplegar', revision, operador) {
      return transaccion(() => {
        const tenant = porId.get(identificador);
        const permitido = new Map([['desplegar', 'registrado'], ['suspender', 'listo'], ['reanudar', 'suspendido']]);
        if (!catalogo.motoresEjecutables.includes(tenant?.motor)) return;
        const ultimo = ultimoTipo.get(identificador)?.tipo;
        if (tipo === 'retirar') {
          if (tenant.estado !== 'retiro-pendiente' || vistaPrevia.get(identificador)?.id !== revision) return;
        } else if (tipo === 'preparar-retiro') {
          const errorDeRetiro = tenant.estado === 'error' && ['retirar', 'preparar-retiro'].includes(ultimo);
          if (!['listo', 'suspendido'].includes(tenant.estado) && !errorDeRetiro) return;
        } else if (!permitido.has(tipo) || (tenant.estado !== permitido.get(tipo) &&
                   !(tenant.estado === 'error' && ultimo === tipo))) return;
        if (tipo !== 'desplegar' && !ultimaSalida.get(identificador)) return;
        const trabajo = encolar.get(identificador, tipo, tenant.estado, fecha());
        if (trabajo) {
          actualizarTenant.run('en-cola', identificador);
          if (operador) registrarAuditoria.run(identificador, operador, tipo, trabajo.id, trabajo.actualizado);
        }
        return trabajo;
      });
    },
    cancelarRetiro(identificador, revision, operador) {
      return transaccion(() => {
        const vista = vistaPrevia.get(identificador);
        if (porId.get(identificador)?.estado !== 'retiro-pendiente' || vista?.id !== revision) return false;
        cerrarVista.run('cancelado', 'Se canceló el retiro.', fecha(), revision);
        actualizarTenant.run(vista.estado_anterior, identificador);
        if (operador) registrarAuditoria.run(identificador, operador, 'cancelar-retiro', revision, fecha());
        return true;
      });
    },
    reclamar() {
      return transaccion(() => {
        const ahora = fecha();
        const expiracion = new Date(Date.now() - 120_000).toISOString();
        for (const trabajo of vencer.all(ahora, expiracion)) actualizarTenant.run('error', trabajo.tenant_id);
        const trabajo = reclamar.get(ahora);
        if (trabajo) actualizarTenant.run('en-curso', trabajo.tenant_id);
        return trabajo;
      });
    },
    consultar(identificador) {
      return consultar.all(identificador).map((trabajo) => ({
        ...trabajo, salida: trabajo.salida ? JSON.parse(trabajo.salida) : null,
        escaneos: trabajo.escaneos ? JSON.parse(trabajo.escaneos) : [],
      }));
    },
    auditoria: (identificador) => consultarAuditoria.all(identificador),
    obtenerInfraestructura(identificador) {
      const fila = ultimaSalida.get(identificador);
      return fila ? JSON.parse(fila.salida) : null;
    },
    obtenerRetiro(identificador) {
      const vista = vistaPrevia.get(identificador);
      return {
        despliegueId: despliegueOriginal.get(identificador)?.id,
        revision: vista && { id: vista.id, ...JSON.parse(vista.salida) },
      };
    },
    actualizar(id, estado, fase, salida = null) {
      return transaccion(() => {
        const ahora = fecha();
        const trabajo = actualizar.get(estado, fase, ahora, salida && JSON.stringify(salida), id);
        if (!trabajo) return;
        if (trabajo.tipo === 'retirar' && estado !== 'en-curso') {
          const vista = vistaPrevia.get(trabajo.tenant_id);
          if (vista) cerrarVista.run('confirmado', 'Se confirmó este plan de retiro.', ahora, vista.id);
        }
        actualizarTenant.run(estado, trabajo.tenant_id);
      });
    },
    tocar: (id) => tocar.run(fecha(), id),
    guardarEscaneos: (id, escaneos) => guardarEscaneos.run(JSON.stringify(escaneos), id),
    cerrar: () => db.close(),
  };
}
