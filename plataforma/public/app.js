const porId = (id) => document.getElementById(id);
const formulario = porId('registro');
const filtros = porId('filtros');
const numero = new Intl.NumberFormat('es-BO');
const fechaAlerta = new Intl.DateTimeFormat('es-BO', {
  dateStyle: 'short', timeStyle: 'medium', timeZone: 'America/La_Paz',
});
let catalogo;
let idEditado = false;
let consultaActiva;
let sondeo;
let listaRenderizada;
let sondeoAlertas;
let consultaAlertas;
let actividad;
const herramientas = {
  panel: 'Panel', packer: 'Packer · AMI', opentofu: 'OpenTofu', pulumi: 'Pulumi',
  scanners: 'Escáneres',
  'cloud-init': 'cloud-init', ansible: 'Ansible', monitoreo: 'Grafana · Prometheus',
  ssm: 'Systems Manager', ec2: 'Amazon EC2',
};
const nombresOperaciones = {
  registrar: 'Registro', desplegar: 'Despliegue', suspender: 'Suspensión', reanudar: 'Reanudación',
  'preparar-retiro': 'Preparación del retiro', retirar: 'Retiro', 'cancelar-retiro': 'Cancelación del retiro',
};
const estados = {
  registrado: 'Registrado', 'en-cola': 'En cola', 'en-curso': 'En curso',
  listo: 'Operativo', suspendido: 'Suspendido', error: 'Con error',
  'retiro-pendiente': 'Retiro pendiente', retirado: 'Retirado',
  cancelado: 'Cancelado', confirmado: 'Confirmado',
};
const operaciones = {
  desplegar: { ruta: 'despliegues', etiqueta: 'Desplegar en AWS', nota: 'Crea recursos facturables.' },
  suspender: { ruta: 'suspender', etiqueta: 'Suspender', nota: 'Los discos siguen almacenados.' },
  reanudar: { ruta: 'reanudar', etiqueta: 'Reanudar', nota: 'Reanuda el cómputo de las EC2.' },
  'preparar-retiro': { ruta: 'preparar-retiro', etiqueta: 'Preparar retiro', nota: 'Genera un plan para revisar.' },
};

function nodo(etiqueta, contenido, clase) {
  const elemento = document.createElement(etiqueta);
  if (contenido) elemento.textContent = contenido;
  if (clase) elemento.className = clase;
  return elemento;
}

async function api(ruta, opciones) {
  const respuesta = await fetch(ruta, opciones);
  const contenido = await respuesta.json();
  if (!respuesta.ok) {
    if (respuesta.status === 401) location.reload();
    const error = new Error(contenido.mensaje);
    error.campos = contenido.errores;
    throw error;
  }
  return contenido;
}

function llenarSelect(select, opciones) {
  for (const { id, nombre } of opciones) select.add(new Option(nombre, id));
}

function tarjetaPlan(plan, seleccionado) {
  const tarjeta = nodo('label', '', 'tarjeta-plan');
  const radio = nodo('input');
  Object.assign(radio, { type: 'radio', name: 'plan', value: plan.id, required: true });
  radio.defaultChecked = seleccionado;
  const totalDisco = plan.recursos.reduce((suma, recurso) => suma + recurso.discoGiB, 0);
  const mysql = plan.recursos.find(({ rol }) => rol === 'MySQL');
  tarjeta.append(
    radio,
    nodo('strong', plan.nombre),
    nodo('span', `Hasta ${numero.format(plan.estudiantes)} estudiantes`),
    nodo('span', `${totalDisco} GiB EBS · MySQL ${mysql.discoGiB} GiB`),
  );
  return tarjeta;
}

function actualizarResumen() {
  if (!catalogo) return;
  const datos = new FormData(formulario);
  const plan = catalogo.planes.find(({ id }) => id === datos.get('plan'));
  porId('resumen-nombre').textContent = datos.get('nombre').trim() || '—';
  porId('resumen-id').textContent = datos.get('identificador').trim().toLowerCase() || '—';
  porId('resumen-entorno').textContent = porId('entorno').selectedOptions[0]?.textContent ?? '—';
  porId('resumen-motor').textContent = porId('motor').selectedOptions[0]?.textContent ?? '—';
  porId('resumen-plan').textContent = plan ? `Plan ${plan.nombre}` : 'Recursos del plan';
  porId('resumen-recursos').replaceChildren(...(plan?.recursos ?? []).map((recurso) => {
    const fila = nodo('li');
    fila.append(
      nodo('strong', recurso.rol),
      nodo('span', `${recurso.instancia} · ${recurso.memoriaGiB} GiB RAM · ${recurso.discoGiB} GiB EBS`),
    );
    return fila;
  }));
}

function mostrarError(mensaje) {
  const aviso = porId('mensaje-formulario');
  aviso.textContent = mensaje;
  aviso.hidden = !mensaje;
}

function etiqueta(opciones, id) {
  return opciones.find((opcion) => opcion.id === id)?.nombre ?? id;
}

function filaTenant(tenant) {
  const fila = nodo('tr');
  const institucion = nodo('td');
  institucion.append(nodo('strong', tenant.nombre), nodo('small', tenant.identificador));
  const estado = nodo('td');
  estado.append(nodo('span', estados[tenant.estado] ?? tenant.estado, 'etiqueta'));
  const accion = nodo('td');
  const tipo = tenant.estado === 'error' ?
    (tenant.tipo_despliegue === 'retirar' ? 'preparar-retiro' : tenant.tipo_despliegue ?? 'desplegar') :
    { registrado: 'desplegar', listo: 'suspender', suspendido: 'reanudar' }[tenant.estado];
  const operacion = operaciones[tipo];
  const motorDisponible = catalogo.motoresEjecutables.includes(tenant.motor);
  if (!motorDisponible) accion.append(nodo('small', 'Motor retirado del panel.'));
  if (motorDisponible && operacion) {
    if (catalogo.despliegueHabilitado) {
      const boton = nodo('button', tenant.estado === 'error' ? `Reintentar: ${operacion.etiqueta}` : operacion.etiqueta, 'secundario');
      boton.type = 'button';
      boton.addEventListener('click', () => iniciarOperacion(tenant, operacion, boton));
      accion.append(boton, nodo('small', operacion.nota));
    } else {
      accion.append(nodo('small', 'AWS pendiente de configurar.'));
    }
  }
  if (motorDisponible && catalogo.despliegueHabilitado && ['listo', 'suspendido'].includes(tenant.estado)) {
    const boton = nodo('button', 'Preparar retiro', 'secundario');
    boton.type = 'button';
    boton.addEventListener('click', () => iniciarOperacion(tenant, operaciones['preparar-retiro'], boton));
    accion.append(boton);
  }
  if (motorDisponible && catalogo.despliegueHabilitado && tenant.estado === 'retiro-pendiente') {
    const boton = nodo('button', 'Revisar retiro', 'secundario');
    boton.type = 'button';
    boton.addEventListener('click', () => mostrarRetiro(tenant, boton));
    accion.append(boton);
  }
  const verActividad = nodo('button', 'Ver actividad', 'secundario');
  verActividad.type = 'button';
  verActividad.dataset.tenant = tenant.identificador;
  verActividad.setAttribute('aria-controls', 'actividad-tenant');
  verActividad.setAttribute('aria-expanded', String(actividad?.tenant === tenant.identificador));
  verActividad.addEventListener('click', () => {
    if (actividad?.tenant === tenant.identificador) cerrarActividad(true);
    else abrirActividad(tenant);
  });
  accion.append(verActividad);
  if (tenant.puerto_local) {
    const url = `http://127.0.0.1:${tenant.puerto_local}`;
    if (tenant.estado === 'listo' && /^i-[a-f0-9]{8}(?:[a-f0-9]{9})?$/.test(tenant.frontend_id ?? '')) {
      const acceso = nodo('details');
      acceso.append(nodo('summary', 'Acceso por Systems Manager'));
      const enlace = nodo('a', url);
      enlace.href = url;
      enlace.target = '_blank';
      enlace.rel = 'noopener noreferrer';
      const comando = nodo('code', `aws ssm start-session --region us-east-2 --target ${tenant.frontend_id} --document-name AWS-StartPortForwardingSession --parameters 'portNumber=80,localPortNumber=${tenant.puerto_local}'`);
      acceso.append(nodo('small', 'Ejecuta el comando con tu perfil de AWS autorizado y deja abierta la terminal.'));
      const instrucciones = nodo('small');
      instrucciones.append(comando);
      acceso.append(instrucciones, enlace);
      accion.append(acceso);
    } else {
      accion.append(nodo('small', url));
    }
  }
  fila.append(
    institucion,
    nodo('td', tenant.plan.nombre),
    nodo('td', etiqueta(catalogo.entornos, tenant.entorno)),
    nodo('td', etiqueta(catalogo.motores, tenant.motor)),
    estado,
    accion,
  );
  return fila;
}

function actualizarBotonesActividad() {
  for (const boton of porId('filas').querySelectorAll('[data-tenant]')) {
    boton.setAttribute('aria-expanded', String(actividad?.tenant === boton.dataset.tenant));
  }
}

function cerrarActividad(devolverFoco = false) {
  if (!actividad) return;
  const tenant = actividad.tenant;
  actividad.consulta?.abort();
  clearTimeout(actividad.sondeo);
  actividad = undefined;
  porId('actividad-tenant').hidden = true;
  actualizarBotonesActividad();
  if (devolverFoco) {
    const boton = porId('filas').querySelector(`[data-tenant="${tenant}"]`);
    (boton ?? porId('nav-tenants')).focus();
  }
}

function abrirActividad(tenant) {
  cerrarActividad();
  actividad = { tenant: tenant.identificador };
  porId('titulo-actividad').textContent = tenant.nombre;
  porId('id-actividad').textContent = tenant.identificador;
  porId('estado-actividad').textContent = 'Cargando actividad…';
  for (const id of ['eventos-actividad', 'resultados-actividad', 'auditoria-actividad']) porId(id).replaceChildren();
  for (const id of ['selector-actividad', 'monitoreo-actividad', 'escaneos-actividad']) porId(id).hidden = true;
  for (const detalle of porId('actividad-tenant').querySelectorAll('details')) detalle.open = false;
  porId('actividad-tenant').hidden = false;
  porId('actividad-tenant').querySelector('.actividad-contenido').scrollTop = 0;
  porId('cerrar-actividad').focus();
  actualizarBotonesActividad();
  cargarActividad(actividad);
}

function distintivo(herramienta) {
  return nodo('span', herramientas[herramienta] ?? herramientas.panel,
    `actividad-herramienta herramienta-${Object.hasOwn(herramientas, herramienta) ? herramienta : 'panel'}`);
}

function filaActividad(evento) {
  const fila = nodo('li', '', 'actividad-evento');
  const cabecera = nodo('div', '', 'actividad-meta');
  cabecera.append(distintivo(evento.herramienta));
  const nivel = { exito: 'Correcto', aviso: 'Aviso', error: 'Error' }[evento.nivel];
  if (nivel) cabecera.append(nodo('span', nivel, `actividad-nivel nivel-${evento.nivel}`));
  const hora = nodo('time', formatearFechaAlerta(evento.fecha));
  hora.dateTime = evento.fecha;
  cabecera.append(hora);
  fila.append(cabecera, nodo('p', evento.mensaje));
  return fila;
}

function mostrarMonitoreo(monitor) {
  const seccion = porId('monitoreo-actividad');
  seccion.hidden = !monitor;
  if (!monitor) return;
  const encabezado = nodo('div', '', 'actividad-meta');
  encabezado.append(distintivo('monitoreo'));
  const grafana = nodo('a', 'Abrir Grafana');
  grafana.href = 'http://127.0.0.1:3000/d/pfm2-tenants';
  grafana.target = '_blank';
  grafana.rel = 'noopener noreferrer';
  encabezado.append(grafana);
  let muestra = 'El colector está esperando una primera muestra.';
  if (!monitor.habilitado) muestra = 'El colector sondea los tenants operativos.';
  else if (monitor.midiendo) muestra = 'Systems Manager está tomando muestras de este tenant.';
  else if (monitor.fallo) muestra = 'El colector no pudo completar el último ciclo.';
  else if (monitor.ultimaMuestra) {
    const { respondieron, fecha } = monitor.ultimaMuestra;
    muestra = `Último sondeo · ${respondieron} de 3 capas con muestra válida · ${formatearFechaAlerta(fecha)}.`;
  }
  const prometheus = {
    disponible: `Reglas de Prometheus disponibles · ${formatearFechaAlerta(monitor.ultimaConsulta)}.`,
    iniciando: 'Esperando la primera lectura de Prometheus.',
    'sin-datos': 'Prometheus no devolvió una lectura válida de sus reglas.',
  }[monitor.fuente];
  seccion.replaceChildren(encabezado, nodo('p', muestra), nodo('p', prometheus));
}

function mostrarEscaneos(trabajo, eventos, escaneos) {
  const seccion = porId('escaneos-actividad');
  seccion.hidden = trabajo?.tipo !== 'desplegar';
  if (seccion.hidden) return;

  const ultimo = eventos.findLast(({ herramienta }) => herramienta === 'scanners');
  const activo = ['en-cola', 'en-curso'].includes(trabajo.estado);
  const estado = ultimo?.mensaje ?? (escaneos.length ? 'Resultados guardados para este intento.' :
    activo ? 'A la espera del plan o la plantilla.' : 'Este intento no tiene escaneos registrados.');
  porId('estado-escaneos').textContent = estado;
  const nombres = { trivy: 'Trivy', gitleaks: 'Gitleaks', conftest: 'Conftest' };
  porId('resultados-actividad').replaceChildren(...escaneos.map((control) => {
    const resultado = control.estado === 'error' ? 'Error de ejecución' :
      control.hallazgos === 0 ? 'Sin hallazgos' : `${control.hallazgos} hallazgos`;
    const nivel = control.estado === 'error' ? 'error' : control.hallazgos ? 'aviso' : 'exito';
    const item = nodo('li');
    item.append(nodo('strong', [nombres[control.nombre] ?? control.nombre, control.version].filter(Boolean).join(' ')),
      nodo('span', resultado, `actividad-nivel nivel-${nivel}`),
      nodo('small', [control.alcance, formatearFechaAlerta(control.fecha)].filter(Boolean).join(' · ')));
    if (control.motivo) item.append(nodo('small', control.motivo));
    if (control.reglas?.length) item.append(nodo('small', control.reglas.join(', ')));
    return item;
  }));
}

function renderizarActividad(datos) {
  const { operaciones, operacion, eventos, escaneos, auditoria, monitoreo } = datos;
  const cambioOperacion = actividad.mostrada !== operacion;
  actividad.mostrada = operacion;
  const selector = porId('operacion-actividad');
  selector.replaceChildren(new Option('Más reciente', ''), ...operaciones.map(({ id, tipo, estado }) =>
    new Option(`#${id} · ${nombresOperaciones[tipo] ?? tipo} · ${estados[estado] ?? estado}`, id)));
  selector.value = actividad.operacion ?? '';
  porId('selector-actividad').hidden = !operaciones.length;
  const trabajo = operaciones.find(({ id }) => id === operacion);
  porId('estado-actividad').textContent = trabajo
    ? `${estados[trabajo.estado] ?? trabajo.estado} · ${nombresOperaciones[trabajo.tipo] ?? trabajo.tipo} #${trabajo.id}`
    : 'Esta institución todavía no tiene operaciones.';
  const lineas = eventos.length || !trabajo ? eventos : [{
    herramienta: 'panel', nivel: trabajo.estado === 'error' ? 'error' : 'info',
    mensaje: trabajo.fase, fecha: trabajo.actualizado,
  }];
  porId('eventos-actividad').replaceChildren(...lineas.toReversed().map(filaActividad));
  if (cambioOperacion) porId('actividad-tenant').querySelector('.actividad-contenido').scrollTop = 0;
  mostrarEscaneos(trabajo, eventos, escaneos);
  porId('auditoria-actividad').replaceChildren(...(auditoria.length ? auditoria.map((evento) => {
    const trabajoId = evento.trabajo_id ? ` · Operación #${evento.trabajo_id}` : '';
    return nodo('li', `${nombresOperaciones[evento.accion] ?? evento.accion} · ${evento.operador} · ${formatearFechaAlerta(evento.fecha)}${trabajoId}`);
  }) : [nodo('li', 'Sin actividad atribuida a un operador.')]));
  mostrarMonitoreo(monitoreo);
}

async function cargarActividad(vista) {
  vista.consulta?.abort();
  clearTimeout(vista.sondeo);
  const consulta = new AbortController();
  vista.consulta = consulta;
  try {
    const operacion = vista.operacion ? `?operacion=${vista.operacion}` : '';
    const datos = await api(`/api/tenants/${vista.tenant}/actividad${operacion}`, { signal: consulta.signal });
    if (consulta.signal.aborted) return;
    const serializado = JSON.stringify(datos);
    if (vista.ultimaLectura !== serializado || vista.seleccionRenderizada !== vista.operacion) {
      renderizarActividad(datos);
      vista.ultimaLectura = serializado;
      vista.seleccionRenderizada = vista.operacion;
    }
  } catch {
    if (!consulta.signal.aborted) {
      vista.ultimaLectura = undefined;
      porId('estado-actividad').textContent = 'No se pudo actualizar la actividad. Volviendo a intentar…';
    }
  } finally {
    if (!consulta.signal.aborted) vista.sondeo = setTimeout(() => cargarActividad(vista), 2000);
  }
}

async function mostrarRetiro(tenant, boton) {
  boton.disabled = true;
  const dialogo = porId('revision-retiro');
  try {
    const historial = await api(`/api/tenants/${tenant.identificador}/despliegues`);
    const revision = historial[0];
    if (revision?.estado !== 'retiro-pendiente') throw new Error('La revisión de retiro ya no está disponible.');
    const { discos, recursos } = revision.salida;
    porId('titulo-retiro').textContent = `Retirar ${tenant.nombre}`;
    porId('impacto-retiro').textContent = discos.some(({ rol }) => rol === 'database') ?
      'Se eliminarán las bases de datos de MySQL, incluidos los registros de asistencia de este tenant.' :
      'Revisa los recursos incluidos en el retiro.';
    const capas = { frontend: 'Nginx', backend: 'API', database: 'MySQL' };
    porId('discos-retiro').replaceChildren(...discos.map(({ rol, id, gib }) =>
      nodo('li', `${capas[rol] ?? rol} · ${id} · ${gib} GiB`)));
    porId('total-retiro').textContent = `${recursos.length} ${recursos.length === 1 ? 'recurso' : 'recursos'} en el plan`;
    porId('recursos-retiro').replaceChildren(...recursos.map(({ direccion, identificador }) =>
      nodo('li', `${direccion} · ${identificador}`)));
    const confirmar = porId('confirmar-retiro');
    const cancelar = porId('cancelar-retiro');
    confirmar.onclick = () => {
      dialogo.close();
      iniciarOperacion(tenant, { ruta: `retirar/${revision.id}` }, boton);
    };
    cancelar.onclick = async () => {
      dialogo.close();
      try {
        await api(`/api/tenants/${tenant.identificador}/cancelar-retiro/${revision.id}`, { method: 'POST' });
        cargarTenants();
      } catch (error) {
        const resultado = porId('resultado');
        resultado.className = 'aviso';
        resultado.textContent = error.message;
        resultado.hidden = false;
      }
    };
    dialogo.showModal();
  } catch (error) {
    const resultado = porId('resultado');
    resultado.className = 'aviso';
    resultado.textContent = error.message;
    resultado.hidden = false;
  } finally {
    boton.disabled = false;
  }
}

async function iniciarOperacion(tenant, operacion, boton) {
  boton.disabled = true;
  const resultado = porId('resultado');
  try {
    await api(`/api/tenants/${tenant.identificador}/${operacion.ruta}`, { method: 'POST' });
    resultado.className = 'exito';
    resultado.textContent = `La operación para ${tenant.nombre} está en cola.`;
    if (actividad?.tenant === tenant.identificador) {
      actividad.operacion = undefined;
      porId('operacion-actividad').value = '';
      cargarActividad(actividad);
    }
    cargarTenants();
  } catch (error) {
    resultado.className = 'aviso';
    resultado.textContent = error.message;
  } finally {
    resultado.hidden = false;
    boton.disabled = false;
  }
}

async function cargarTenants(enSegundoPlano = false) {
  consultaActiva?.abort();
  clearTimeout(sondeo);
  const consulta = new AbortController();
  consultaActiva = consulta;
  const estado = porId('estado-lista');
  if (!enSegundoPlano) estado.textContent = 'Cargando tenants…';
  try {
    const parametros = new URLSearchParams(new FormData(filtros));
    const tenants = await api(`/api/tenants?${parametros}`, { signal: consulta.signal });
    if (consulta.signal.aborted) return;
    const serializado = JSON.stringify(tenants);
    if (listaRenderizada !== serializado) {
      const botonEnFoco = document.activeElement?.dataset.tenant;
      const filas = porId('filas');
      filas.replaceChildren(...tenants.map(filaTenant));
      if (botonEnFoco) filas.querySelector(`[data-tenant="${botonEnFoco}"]`)?.focus();
      listaRenderizada = serializado;
    }
    porId('tabla').hidden = tenants.length === 0;
    estado.textContent = tenants.length
      ? `${tenants.length} ${tenants.length === 1 ? 'tenant encontrado' : 'tenants encontrados'}`
      : 'No hay tenants para esta búsqueda.';
  } catch (error) {
    if (error.name !== 'AbortError') estado.textContent = 'No se pudo consultar el registro. Intenta filtrar de nuevo.';
  } finally {
    if (!consulta.signal.aborted && location.hash === '#tenants' && catalogo.despliegueHabilitado) {
      sondeo = setTimeout(() => cargarTenants(true), 3000);
    }
  }
}

function formatearFechaAlerta(valor) {
  const fecha = Date.parse(valor);
  return Number.isFinite(fecha) ? fechaAlerta.format(fecha) : '—';
}

function filaAlerta(alerta) {
  const fila = nodo('tr');
  const severidad = alerta.severidad === 'critica' ? 'Crítica' : 'Advertencia';
  fila.append(nodo('td', alerta.mensaje), nodo('td', alerta.tenant ?? 'Plataforma'),
    nodo('td', alerta.entorno ? etiqueta(catalogo.entornos, alerta.entorno) : '—'),
    nodo('td', severidad), nodo('td', formatearFechaAlerta(alerta.deteccion)));
  if (alerta.evento) {
    const evento = nodo('td', alerta.evento === 'resuelta' ? 'Resuelta' : 'Detectada');
    evento.append(nodo('small', formatearFechaAlerta(alerta.fecha)));
    fila.append(evento);
  }
  return fila;
}

async function cargarAlertas() {
  const consulta = new AbortController();
  consultaAlertas = consulta;
  const estado = porId('estado-alertas');
  const tabla = porId('tabla-alertas');
  try {
    const { activas, eventos, fuente, ultimaConsulta } = await api('/api/alertas/resumen', { signal: consulta.signal });
    if (consulta.signal.aborted) return;
    porId('filas-alertas').replaceChildren(...(activas ?? []).map(filaAlerta));
    porId('filas-eventos').replaceChildren(...eventos.map(filaAlerta));
    tabla.hidden = !activas?.length;
    porId('tabla-eventos').hidden = eventos.length === 0;
    porId('estado-eventos').textContent = eventos.length ? '' : 'No hay eventos registrados en las últimas 24 horas.';
    if (fuente === 'disponible') estado.textContent = activas.length ? '' : 'No hay alertas activas.';
    else if (fuente === 'iniciando') estado.textContent = 'Esperando la primera lectura de Prometheus…';
    else estado.textContent = ultimaConsulta
      ? `Sin lectura actual de Prometheus. Última lectura válida en Bolivia el ${formatearFechaAlerta(ultimaConsulta)}.`
      : 'Sin lectura actual de Prometheus. El historial sigue disponible.';
  } catch {
    if (consulta.signal.aborted) return;
    tabla.hidden = true;
    porId('tabla-eventos').hidden = true;
    porId('estado-eventos').textContent = 'No se pudo consultar el historial.';
    estado.textContent = 'No se pudieron consultar las alertas.';
  } finally {
    if (!consulta.signal.aborted) sondeoAlertas = setTimeout(cargarAlertas, 15000);
  }
}

function cambiarVista() {
  const lista = location.hash === '#tenants';
  porId('vista-crear').hidden = lista;
  porId('vista-tenants').hidden = !lista;
  porId('ruta').textContent = lista ? 'Tenants' : 'Tenants / Nuevo registro';
  porId(lista ? 'nav-tenants' : 'nav-crear').setAttribute('aria-current', 'page');
  porId(lista ? 'nav-crear' : 'nav-tenants').removeAttribute('aria-current');
  consultaAlertas?.abort();
  clearTimeout(sondeoAlertas);
  if (lista && catalogo) {
    cargarTenants();
    if (catalogo.observabilidadHabilitada) {
      porId('observabilidad').hidden = false;
      porId('estado-alertas').textContent = 'Cargando alertas…';
      porId('tabla-alertas').hidden = true;
      cargarAlertas();
    }
  }
  if (!lista) {
    cerrarActividad();
    consultaActiva?.abort();
    clearTimeout(sondeo);
  }
}

formulario.addEventListener('input', ({ target }) => {
  const identificador = formulario.elements.identificador;
  if (target === identificador) idEditado = Boolean(identificador.value);
  if (target === formulario.elements.nombre && !idEditado) {
    identificador.value = target.value.normalize('NFD').replace(/\p{Diacritic}/gu, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-$/, '');
  }
  target.removeAttribute('aria-invalid');
  mostrarError('');
  actualizarResumen();
});

formulario.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const boton = porId('guardar');
  if (boton.disabled) return;
  boton.disabled = true;
  mostrarError('');
  try {
    const tenant = await api('/api/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(formulario))),
    });
    formulario.reset();
    filtros.reset();
    idEditado = false;
    actualizarResumen();
    const resultado = porId('resultado');
    resultado.className = 'exito';
    resultado.textContent = `${tenant.nombre} se registró correctamente.`;
    resultado.hidden = false;
    location.hash = '#tenants';
  } catch (error) {
    const campos = Object.entries(error.campos ?? {});
    mostrarError(campos.length ? campos.map(([, mensaje]) => mensaje).join(' ') : 'No se pudo guardar el tenant.');
    for (const [campo] of campos) formulario.elements[campo]?.setAttribute?.('aria-invalid', 'true');
    if (campos.length) formulario.elements[campos[0][0]]?.focus?.();
  } finally {
    boton.disabled = false;
  }
});

filtros.addEventListener('submit', (evento) => {
  evento.preventDefault();
  if (catalogo) cargarTenants();
});
porId('cerrar-actividad').addEventListener('click', () => cerrarActividad(true));
porId('actividad-tenant').addEventListener('keydown', (evento) => {
  if (evento.key === 'Escape') {
    evento.preventDefault();
    cerrarActividad(true);
  }
});
porId('operacion-actividad').addEventListener('change', ({ target }) => {
  actividad.operacion = target.value || undefined;
  cargarActividad(actividad);
});
window.addEventListener('hashchange', cambiarVista);
porId('salir').addEventListener('click', async () => {
  try {
    await api('/api/salir', { method: 'POST' });
    location.reload();
  } catch {
    alert('No se pudo cerrar la sesión. Intenta de nuevo.');
  }
});
cambiarVista();

try {
  catalogo = await api('/api/catalogo');
  llenarSelect(porId('entorno'), catalogo.entornos);
  llenarSelect(porId('motor'), catalogo.motores);
  llenarSelect(porId('filtro-entorno'), catalogo.entornos);
  llenarSelect(porId('filtro-plan'), catalogo.planes);
  porId('planes').replaceChildren(...catalogo.planes.map((plan, indice) => tarjetaPlan(plan, indice === 0)));
  actualizarResumen();
  cambiarVista();
  porId('guardar').disabled = false;
} catch {
  const mensaje = 'No se pudo cargar el catálogo. Recarga la página para volver a intentarlo.';
  mostrarError(mensaje);
  porId('estado-lista').textContent = mensaje;
}
