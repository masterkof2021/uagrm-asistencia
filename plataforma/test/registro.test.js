import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as esperar } from 'node:timers/promises';
import { cambiarEstadoEc2, configurarDespliegue, desplegarHcl, gestionarRetiro, iniciarTrabajador, seleccionarAmi } from '../despliegues.js';
import { catalogo } from '../catalogo.js';
import { consultarAlertas, iniciarHistorialAlertas } from '../alertas.js';
import { configurarAcceso } from '../acceso.js';
import { crearServidor } from '../server.js';
import { abrirRegistro } from '../tenants.js';

const solicitud = {
  nombre: 'Instituto San Marcos',
  identificador: 'san-marcos',
  correo: 'admin@example.org',
  entorno: 'pruebas',
  plan: 'estandar',
  motor: 'opentofu',
};

const administrador = { usuario: 'operador-pruebas', clave: 'clave local de pruebas' };

async function iniciar(registro, despliegueHabilitado, monitor, autenticar = true) {
  const acceso = configurarAcceso({
    PFM2_ADMIN_USUARIO: administrador.usuario, PFM2_ADMIN_CLAVE: administrador.clave,
  });
  const servidor = crearServidor(registro, despliegueHabilitado, monitor, acceso);
  servidor.listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  const url = `http://127.0.0.1:${servidor.address().port}`;
  const sesion = autenticar ? await ingresar(url, administrador) : null;
  const cookie = sesion?.headers.get('set-cookie')?.split(';')[0];
  return {
    url,
    pedir: (ruta, opciones = {}) => fetch(ruta, { ...opciones, headers: { Cookie: cookie, ...opciones.headers } }),
    cerrar: () => new Promise((resolve, reject) => servidor.close((error) => error ? reject(error) : resolve())),
  };
}

function registrar(pedir, url, datos, opciones = {}) {
  return pedir(`${url}/api/tenants`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...opciones },
    body: JSON.stringify(datos),
  });
}

function ingresar(url, datos) {
  return fetch(`${url}/api/sesion`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos),
  });
}

test('exige sesión para operar, atribuye el registro y despliegue y mantiene métricas locales', async (t) => {
  const registro = abrirRegistro(':memory:');
  const { url, cerrar } = await iniciar(registro, true, { leer: () => 'pfm2_demo 1\n' }, false);
  t.after(async () => { await cerrar(); registro.cerrar(); });
  assert.match(await (await fetch(url)).text(), /Iniciar sesión/);
  assert.equal((await fetch(`${url}/api/tenants`)).status, 401);
  assert.equal((await registrar(fetch, url, solicitud)).status, 401);
  assert.equal(await (await fetch(`${url}/metrics`)).text(), 'pfm2_demo 1\n');
  const sesion = await ingresar(url, administrador);
  assert.equal(sesion.status, 200);
  const cabecera = sesion.headers.get('set-cookie');
  assert.match(cabecera, /HttpOnly; SameSite=Strict/);
  const Cookie = cabecera.split(';')[0];
  assert.match(await (await fetch(url, { headers: { Cookie } })).text(), /Cerrar sesión/);
  assert.equal((await registrar(fetch, url, { ...solicitud, operador: 'falso' }, { Cookie })).status, 201);
  const ruta = `${url}/api/tenants/${solicitud.identificador}`;
  const despliegue = await fetch(`${ruta}/despliegues`, { method: 'POST', headers: { Cookie } });
  assert.equal(despliegue.status, 202);
  const trabajo = await despliegue.json();
  const actividad = await (await fetch(`${ruta}/auditoria`, { headers: { Cookie } })).json();
  assert.deepEqual(actividad.map(({ accion, operador, trabajo_id }) => [accion, operador, trabajo_id]), [
    ['desplegar', administrador.usuario, trabajo.id], ['registrar', administrador.usuario, null],
  ]);
  assert.equal((await fetch(`${url}/api/salir`, { method: 'POST', headers: { Cookie } })).status, 200);
  assert.equal((await fetch(`${ruta}/auditoria`, { headers: { Cookie } })).status, 401);
});

test('registra detecciones y resoluciones sin duplicarlas ni cerrar alertas cuando falla Prometheus', async (t) => {
  const directorio = await mkdtemp(join(tmpdir(), 'pfm2-alertas-'));
  const archivo = join(directorio, 'tenants.sqlite');
  const registro = abrirRegistro(archivo);
  const deteccion = new Date(Date.now() - 60_000).toISOString();
  const alerta = {
    labels: { alertname: 'ServicioCaido', tenant: 'san-marcos', entorno: 'pruebas', rol: 'backend', severidad: 'critica' },
    annotations: { resumen: 'El servicio backend no responde.' }, activeAt: deteccion, state: 'firing',
  };
  let grupos = [{ name: 'uagrm-tenants', rules: [{ health: 'ok', alerts: [alerta] }] }];
  let lecturas = 0;
  const prometheus = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/api/v1/rules' || url.searchParams.get('rule_group[]') !== 'uagrm-tenants') {
      res.writeHead(404).end();
      return;
    }
    lecturas += 1;
    res.end(JSON.stringify({ status: 'success', data: { groups: grupos } }));
  });
  prometheus.listen(0, '127.0.0.1');
  await once(prometheus, 'listening');
  const alertas = iniciarHistorialAlertas(registro, {
    consultar: () => consultarAlertas(`http://127.0.0.1:${prometheus.address().port}`), intervalo: 25,
  });
  const { url, cerrar, pedir } = await iniciar(registro, false, { alertas });
  let registroCerrado = false;
  t.after(async () => {
    await alertas.detener();
    await cerrar();
    await new Promise((resolver) => prometheus.close(resolver));
    if (!registroCerrado) registro.cerrar();
    await rm(directorio, { recursive: true, force: true });
  });
  async function resumenCuando(condicion) {
    for (let intento = 0; intento < 100; intento++) {
      const respuesta = await pedir(`${url}/api/alertas/resumen`);
      assert.equal(respuesta.status, 200);
      const resumen = await respuesta.json();
      if (condicion(resumen)) return resumen;
      await esperar(20);
    }
    assert.fail('El historial no alcanzó el estado esperado.');
  }

  const primera = await resumenCuando(({ activas }) => activas?.length === 1 && lecturas >= 3);
  assert.deepEqual(primera.eventos.map(({ evento, deteccion, tenant }) => [evento, deteccion, tenant]),
    [['detectada', deteccion, 'san-marcos']]);
  assert.equal((await (await pedir(`${url}/api/alertas`)).json())[0].alerta, 'ServicioCaido');

  grupos = [];
  const sinDatos = await resumenCuando(({ fuente }) => fuente === 'sin-datos');
  assert.equal(sinDatos.activas, null);
  assert.ok(sinDatos.ultimaConsulta);
  assert.deepEqual(sinDatos.eventos, primera.eventos);
  assert.equal((await pedir(`${url}/api/alertas`)).status, 503);

  grupos = [{ name: 'uagrm-tenants', rules: [{ health: 'ok', alerts: [] }] }];
  const resuelta = await resumenCuando(({ eventos }) => eventos[0]?.evento === 'resuelta');
  assert.deepEqual(resuelta.activas, []);
  assert.deepEqual(resuelta.eventos.map(({ evento }) => evento), ['resuelta', 'detectada']);
  assert.ok(resuelta.eventos[0].fecha > deteccion);

  const deteccionNueva = new Date().toISOString();
  grupos[0].rules[0].alerts = [{ ...alerta, activeAt: deteccionNueva }];
  const reactivada = await resumenCuando(({ eventos }) => eventos.length === 3);
  assert.equal(reactivada.activas[0].deteccion, deteccionNueva);
  await alertas.detener();
  registro.cerrar();
  registroCerrado = true;
  const reabierto = abrirRegistro(archivo);
  try {
    assert.deepEqual(reabierto.eventosAlertas().map((fila) => ({ ...fila })), reactivada.eventos);
  } finally {
    reabierto.cerrar();
  }
});

test('ofrece el catálogo, valida los campos y registra un identificador único ante solicitudes simultáneas', async (t) => {
  const registro = abrirRegistro(':memory:');
  const { url, cerrar, pedir } = await iniciar(registro);
  t.after(async () => { await cerrar(); registro.cerrar(); });

  const catalogo = await (await pedir(`${url}/api/catalogo`)).json();
  assert.equal(catalogo.region, 'us-east-2');
  assert.deepEqual(catalogo.planes.map(({ id }) => id), ['basico', 'estandar', 'avanzado']);

  const invalido = await registrar(pedir, url, { ...solicitud, identificador: '../foo', plan: 'inexistente' });
  assert.equal(invalido.status, 422);
  assert.deepEqual(Object.keys((await invalido.json()).errores), ['identificador', 'plan']);

  const respuestas = await Promise.all([
    registrar(pedir, url, solicitud),
    registrar(pedir, url, { ...solicitud, identificador: ' SAN-MARCOS ' }),
  ]);
  assert.deepEqual(respuestas.map(({ status }) => status).sort(), [201, 409]);
  const nuevo = await respuestas.find(({ status }) => status === 201).json();
  assert.equal(nuevo.estado, 'registrado');
  assert.equal(nuevo.identificador, 'san-marcos');
  assert.equal(nuevo.plan.recursos.find(({ rol }) => rol === 'MySQL').discoGiB, 32);

  const origenAjeno = await registrar(pedir, url, { ...solicitud, identificador: 'otro' }, { Origin: 'https://example.org' });
  assert.equal(origenAjeno.status, 403);
  assert.equal(registro.listar().length, 1);
});

test('la API encola un despliegue único y permite reintentar sin perder el historial', async (t) => {
  const registro = abrirRegistro(':memory:');
  const { url, cerrar, pedir } = await iniciar(registro, true);
  let intentos = 0;
  const detener = iniciarTrabajador(registro, tmpdir(), async ({ tenant, progreso, guardarEscaneos }) => {
    assert.equal(tenant.identificador, solicitud.identificador);
    progreso('Plan verificado.');
    intentos += 1;
    guardarEscaneos([{ nombre: 'trivy', estado: intentos === 1 ? 'error' : 'hallazgos',
      hallazgos: intentos === 1 ? null : 2 }]);
    if (intentos === 1) throw new Error('Falló la comprobación de arranque.');
    return { instancias: { frontend: 'i-ejemplo' } };
  });
  t.after(async () => { await cerrar(); await detener(); registro.cerrar(); });
  assert.equal((await registrar(pedir, url, solicitud)).status, 201);
  const ruta = `${url}/api/tenants/${solicitud.identificador}/despliegues`;
  const iniciarDespliegue = () => pedir(ruta, { method: 'POST' });
  const respuestas = await Promise.all([iniciarDespliegue(), iniciarDespliegue()]);
  assert.deepEqual(respuestas.map(({ status }) => status).sort(), [202, 409]);

  async function esperarEstado(estado) {
    for (let intento = 0; intento < 50; intento++) {
      const historial = await (await pedir(ruta)).json();
      if (historial[0]?.estado === estado) return historial;
      await esperar(100);
    }
    assert.fail(`No se observó el estado ${estado}`);
  }

  const [fallido] = await esperarEstado('error');
  assert.equal(fallido.fase, 'Falló la comprobación de arranque.');
  assert.equal((await iniciarDespliegue()).status, 202);
  const historial = await esperarEstado('listo');
  assert.deepEqual(historial.map(({ estado }) => estado), ['listo', 'error']);
  assert.deepEqual(historial.map(({ escaneos }) => escaneos[0].estado), ['hallazgos', 'error']);
  assert.equal(historial[0].salida.instancias.frontend, 'i-ejemplo');
  assert.equal((await iniciarDespliegue()).status, 409);
});

test('conserva los tenants al reabrir SQLite y aplica filtros combinados', async (t) => {
  const directorio = await mkdtemp(join(tmpdir(), 'uagrm-tenants-'));
  const ruta = join(directorio, 'tenants.sqlite');
  t.after(() => rm(directorio, { recursive: true }));

  const registro = abrirRegistro(ruta);
  const servidor = await iniciar(registro);
  try {
    assert.equal((await registrar(servidor.pedir, servidor.url, solicitud)).status, 201);
    assert.equal((await registrar(servidor.pedir, servidor.url, {
      ...solicitud, nombre: 'Instituto Central', identificador: 'central', plan: 'basico', entorno: 'produccion',
    })).status, 201);
  } finally {
    await servidor.cerrar();
    registro.cerrar();
  }

  const reabierto = abrirRegistro(ruta);
  const { url, cerrar, pedir } = await iniciar(reabierto);
  try {
    const resultado = await (await pedir(`${url}/api/tenants?buscar=marcos&plan=estandar&entorno=pruebas&estado=registrado`)).json();
    assert.deepEqual(resultado.map(({ identificador }) => identificador), ['san-marcos']);
    const vacio = await (await pedir(`${url}/api/tenants?buscar=marcos&entorno=produccion`)).json();
    assert.deepEqual(vacio, []);
  } finally {
    await cerrar();
    reabierto.cerrar();
  }
});

test('valida la AMI privada de la cuenta y la conserva en reintentos', async (t) => {
  const directorio = await mkdtemp(join(tmpdir(), 'uagrm-ami-'));
  t.after(() => rm(directorio, { recursive: true }));
  const cuenta = '123456789012';
  const ami = 'ami-0123456789abcdef0';
  const config = { cuenta, amiPersonalizada: ami };
  const imagen = { ImageId: ami, OwnerId: cuenta, State: 'available',
    Public: false, Architecture: 'x86_64', RootDeviceType: 'ebs' };
  await assert.rejects(seleccionarAmi(async () => ({
    Images: [{ ...imagen, OwnerId: '210987654321' }],
  }), directorio, config), /cuenta del proyecto/);
  assert.equal(await seleccionarAmi(async (...args) => {
    assert.deepEqual(args, ['ec2', 'describe-images', '--image-ids', ami]);
    return { Images: [imagen] };
  }, directorio, config), ami);
  assert.equal(await seleccionarAmi(() => assert.fail('Debe reutilizar la AMI guardada'),
    directorio, { ...config, amiPersonalizada: 'ami-1234567890abcdef0' }), ami);
});

test('OpenTofu usa el estado del tenant y detiene un plan que reemplaza una instancia', async (t) => {
  const directorio = await mkdtemp(join(tmpdir(), 'uagrm-opentofu-'));
  t.after(() => rm(directorio, { recursive: true }));
  const cuenta = '123456789012';
  const config = configurarDespliegue({ PFM2_AWS_ACCOUNT: cuenta, PFM2_STATE_BUCKET: 'estado-de-pruebas' });
  const tenant = { ...solicitud, entorno: 'pruebas', plan: catalogo.planes[0] };
  const llamadas = [];
  async function simular(programa, args) {
    llamadas.push([programa, ...args]);
    if (programa === 'aws' && args[0] === 'sts') {
      return JSON.stringify({ Account: cuenta, Arn: `arn:aws:sts::${cuenta}:assumed-role/${config.rol}/prueba` });
    }
    if (programa === 'aws' && args[0] === 'ssm') {
      return JSON.stringify({ Parameter: { Value: 'ami-0123456789abcdef0' } });
    }
    if (programa === 'tofu' && args[0] === 'show') {
      return JSON.stringify({ resource_changes: ['frontend', 'backend', 'database'].map((rol) => ({
        type: 'aws_instance', mode: 'managed',
        change: { actions: rol === 'database' ? ['delete', 'create'] : ['no-op'],
          after: { tags_all: { Tenant: tenant.identificador } } },
      })) });
    }
    return '';
  }
  await assert.rejects(
    desplegarHcl({ config, directorio: join(directorio, 'intento'), datosTenant: directorio,
      tenant, progreso() {}, ejecutarComando: simular }),
    /fuera del despliegue inicial/,
  );
  assert.ok(llamadas.some((args) => args.includes('-backend-config=key=tenants/panel/san-marcos/terraform.tfstate')));
  assert.ok(!llamadas.some(([programa, accion]) => programa === 'tofu' && accion === 'apply'));
});

test('suspende y reanuda las EC2 registradas conservando sus discos después de una suspensión parcial', async (t) => {
  const registro = abrirRegistro(':memory:');
  const { url, cerrar, pedir } = await iniciar(registro, true);
  const roles = ['frontend', 'backend', 'database'];
  const instancias = Object.fromEntries(roles.map((rol, i) => [rol, `i-0000000${i}`]));
  const volumenes = Object.fromEntries(roles.map((rol, i) => [rol, `vol-0000000${i}`]));
  const estados = { frontend: 'running', backend: 'stopped', database: 'running' };
  const cuenta = '123456789012';
  const config = configurarDespliegue({ PFM2_AWS_ACCOUNT: cuenta, PFM2_STATE_BUCKET: 'estado-de-pruebas' });
  const llamadas = [];
  const serviciosComprobados = new Set();
  async function simular(programa, args) {
    assert.equal(programa, 'aws');
    const [servicio, accion] = args;
    if (servicio === 'sts') return JSON.stringify({
      Account: cuenta, Arn: `arn:aws:sts::${cuenta}:assumed-role/${config.rol}/prueba`,
    });
    if (accion === 'describe-instances') return JSON.stringify({
      Reservations: [{ Instances: roles.map((rol) => ({
        InstanceId: instancias[rol], State: { Name: estados[rol] }, RootDeviceType: 'ebs',
        RootDeviceName: '/dev/xvda',
        BlockDeviceMappings: [{ DeviceName: '/dev/xvda', Ebs: { VolumeId: volumenes[rol] } }],
        Tags: Object.entries({ Project: 'proyecto-final-modulo-2', Tenant: solicitud.identificador, Role: rol })
          .map(([Key, Value]) => ({ Key, Value })),
      })) }],
    });
    if (accion === 'stop-instances' || accion === 'start-instances') {
      const ids = args.slice(3, args.indexOf('--region'));
      llamadas.push([accion, ids]);
      for (const rol of roles.filter((rol) => ids.includes(instancias[rol]))) {
        estados[rol] = accion === 'stop-instances' ? 'stopped' : 'running';
      }
      return '{}';
    }
    if (accion === 'describe-instance-information') return JSON.stringify({
      InstanceInformationList: roles.map(() => ({ PingStatus: 'Online' })),
    });
    if (accion === 'send-command') {
      const id = args[args.indexOf('--instance-ids') + 1];
      const rol = roles.find((nombre) => instancias[nombre] === id);
      if (rol === 'frontend') assert.deepEqual(serviciosComprobados, new Set(['database', 'backend']));
      return JSON.stringify({ Command: { CommandId: rol } });
    }
    if (accion === 'list-command-invocations') {
      serviciosComprobados.add(args[args.indexOf('--command-id') + 1]);
      return JSON.stringify({ CommandInvocations: [{ Status: 'Success' }] });
    }
    assert.fail(`Operación inesperada: ${servicio} ${accion}`);
  }
  assert.equal((await registrar(pedir, url, solicitud)).status, 201);
  registro.encolar(solicitud.identificador);
  registro.actualizar(registro.reclamar().id, 'listo', 'Prueba inicial.', { instancias, volumenes });
  const detener = iniciarTrabajador(registro, tmpdir(), (trabajo) =>
    cambiarEstadoEc2({ ...trabajo, config, ejecutarComando: simular, pausar: async () => {} }));
  t.after(async () => { await cerrar(); await detener(); registro.cerrar(); });

  const ruta = `${url}/api/tenants/${solicitud.identificador}`;
  const operacion = (tipo) => pedir(`${ruta}/${tipo}`, { method: 'POST' });
  async function esperarEstado(estado) {
    for (let intento = 0; intento < 50; intento++) {
      const [trabajo] = await (await pedir(`${ruta}/despliegues`)).json();
      if (trabajo.estado === estado) return trabajo;
      if (trabajo.estado === 'error') assert.fail(trabajo.fase);
      await esperar(100);
    }
    assert.fail(`El tenant no alcanzó el estado ${estado}`);
  }
  assert.equal((await operacion('reanudar')).status, 409);
  assert.equal((await operacion('suspender')).status, 202);
  assert.deepEqual((await esperarEstado('suspendido')).salida.volumenes, volumenes);
  assert.equal((await operacion('reanudar')).status, 202);
  assert.deepEqual((await esperarEstado('listo')).salida.volumenes, volumenes);
  assert.deepEqual(serviciosComprobados, new Set(roles));
  assert.deepEqual(llamadas, [
    ['stop-instances', [instancias.database, instancias.frontend]],
    ['start-instances', [instancias.backend, instancias.database, instancias.frontend]],
  ]);
});

test('rechaza el retiro de una EC2 con un disco adjunto fuera del plan', async (t) => {
  const directorio = await mkdtemp(join(tmpdir(), 'uagrm-retiro-'));
  t.after(() => rm(directorio, { recursive: true }));
  const cwd = join(directorio, '1', 'infra', 'opentofu');
  await mkdir(join(cwd, '.terraform'), { recursive: true });
  const cuenta = '123456789012';
  const config = configurarDespliegue({ PFM2_AWS_ACCOUNT: cuenta, PFM2_STATE_BUCKET: 'estado-de-pruebas' });
  const id = 'i-00000001';
  const volumen = 'vol-00000001';
  await writeFile(join(cwd, '.terraform', 'terraform.tfstate'), JSON.stringify({
    backend: { type: 's3', config: { bucket: config.bucket, key: 'tenants/panel/san-marcos/terraform.tfstate' } },
  }));
  await writeFile(join(cwd, 'retiro-2.tfplan'), 'plan de prueba');
  async function simular(programa, args) {
    if (programa === 'aws' && args[0] === 'sts') return JSON.stringify({
      Account: cuenta, Arn: `arn:aws:sts::${cuenta}:assumed-role/${config.rol}/prueba`,
    });
    if (programa === 'aws' && args[1] === 'describe-instances') return JSON.stringify({
      Reservations: [{ Instances: [{ InstanceId: id, RootDeviceName: '/dev/xvda', BlockDeviceMappings: [
        { DeviceName: '/dev/xvda', Ebs: { VolumeId: volumen, DeleteOnTermination: true } },
        { DeviceName: '/dev/sdf', Ebs: { VolumeId: 'vol-00000002', DeleteOnTermination: true } },
      ] }] }],
    });
    if (programa === 'tofu' && args[0] === 'plan') return '';
    if (programa === 'tofu' && args[0] === 'show') return JSON.stringify({
      resource_changes: [{ mode: 'managed', type: 'aws_instance', address: 'aws_instance.server["database"]',
        change: { actions: ['delete'], before: { id, tags_all: {
          Project: 'proyecto-final-modulo-2', Tenant: solicitud.identificador, Role: 'database',
        }, root_block_device: [{ volume_id: volumen, volume_size: 20, delete_on_termination: true }] } } }],
    });
    assert.fail('Operación inesperada: ' + args[0]);
  }
  await assert.rejects(gestionarRetiro({
    config, tenant: solicitud, datosTenant: directorio, tipo: 'preparar-retiro', trabajoId: 2,
    retiro: { despliegueId: 1 }, infraestructura: { instancias: { database: id } },
    progreso() {}, ejecutarComando: simular,
  }), /discos distintos a los del plan/);
});
