import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as esperar } from 'node:timers/promises';
import { origenLocal } from '../infra/arranque.js';
import { abrirPilaPulumi, huellaPulumi, inventarioPulumi, prepararProgramaPulumi, revisarPreviewPulumi, verificarEntradaPulumi } from './pulumi.js';
import { escanearDespliegue } from './escaneos.js';
import { catalogo } from './catalogo.js';

const modulo = fileURLToPath(new URL('../infra/opentofu/', import.meta.url));
const region = 'us-east-2';
const ejecutable = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const esperado = ['backend', 'database', 'frontend'];
const idAmi = /^ami-(?:[0-9a-f]{8}|[0-9a-f]{17})$/;
const salidaMaxima = 8 * 1024 * 1024;
const claveOpenTofu = (tenant) => `tenants/panel/${tenant.identificador}/terraform.tfstate`;

export function configurarDespliegue(env = process.env) {
  const cuenta = env.PFM2_AWS_ACCOUNT;
  const bucket = env.PFM2_STATE_BUCKET;
  const amiPersonalizada = env.PFM2_AMI_ID;
  if (!cuenta && !bucket) return null;
  if (!/^[0-9]{12}$/.test(cuenta ?? '') || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket ?? '')) {
    throw new Error('Configura PFM2_AWS_ACCOUNT y PFM2_STATE_BUCKET para habilitar el despliegue en AWS.');
  }
  if (amiPersonalizada && !idAmi.test(amiPersonalizada)) {
    throw new Error('PFM2_AMI_ID debe contener el identificador de una AMI de AWS.');
  }
  return {
    cuenta, bucket, amiPersonalizada, ansible: env.PFM2_ANSIBLE === '1', escaneos: env.PFM2_ESCANEOS !== '0',
    perfil: env.PFM2_DEPLOY_PROFILE ?? 'pfm2-deploy',
    rol: 'pfm2-panel-deploy',
    limite: `arn:aws:iam::${cuenta}:policy/proyecto-final-modulo-2/pfm2-instance-boundary`,
  };
}

function ejecutar(programa, args, opciones) {
  return new Promise((resolve, reject) => {
    const proceso = spawn(programa, args, {
      ...opciones, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      signal: AbortSignal.timeout(600_000),
    });
    const buffers = [[], []];
    let bytes = 0;
    let exceso = false;
    [proceso.stdout, proceso.stderr].forEach((stream, indice) => {
      stream.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes <= salidaMaxima) buffers[indice].push(chunk);
        else exceso = true;
      });
    });
    proceso.once('error', reject);
    proceso.once('close', (codigo) => {
      const [stdout, stderr] = buffers.map((partes) => Buffer.concat(partes).toString('utf8'));
      if (exceso) return reject(new Error('La respuesta del motor excedió el tamaño permitido.'));
      if (codigo === 0) return resolve(stdout);
      const detalle = stdout + stderr;
      if (/AccessDenied|UnauthorizedOperation|ExpiredToken|session has expired/i.test(detalle)) {
        return reject(new Error('AWS rechazó la sesión o los permisos del rol de despliegue.'));
      }
      if (/state lock/i.test(detalle)) {
        return reject(new Error('El estado del tenant está bloqueado. Reintenta cuando termine la otra operación.'));
      }
      if (/VpcLimitExceeded/i.test(detalle)) {
        return reject(new Error('AWS alcanzó la cuota de VPC en Ohio. Reintenta cuando haya una VPC disponible.'));
      }
      reject(new Error(`Falló ${programa} ${args[0]}. Revisa la configuración y el estado en AWS.`));
    });
  });
}

async function prepararTrabajo(directorio, tenant) {
  const raiz = join(directorio, 'infra', 'opentofu');
  await mkdir(raiz, { recursive: true });
  await mkdir(join(directorio, 'plataforma'), { recursive: true });
  await Promise.all([
    ...['main.tf', 'variables.tf'].map((archivo) =>
      copyFile(join(modulo, archivo), join(raiz, archivo))),
    copyFile(join(modulo, '.terraform.lock.hcl'), join(raiz, '.terraform.lock.hcl')),
    copyFile(join(modulo, 'backend.tf.example'), join(raiz, 'backend.tf')),
    cp(join(modulo, 'cloud-init'), join(raiz, 'cloud-init'), { recursive: true }),
    writeFile(join(directorio, 'plataforma', 'planes.json'), JSON.stringify([tenant.plan])),
  ]);
  return raiz;
}

function revisarPlan(plan, tenant) {
  const permitidas = new Set(['no-op', 'create']);
  const recursos = plan.resource_changes.filter(({ mode }) => mode === 'managed');
  const servidores = recursos.filter(({ type }) => type === 'aws_instance');
  if (servidores.length !== 3 ||
      recursos.some(({ change }) => change.actions.some((accion) => !permitidas.has(accion))) ||
      servidores.some(({ change }) => change.after?.tags_all?.Tenant !== tenant)) {
    throw new Error('El plan incluye cambios fuera del despliegue inicial. Requiere revisión en AWS.');
  }
}

async function revisarSeguridad(motor, directorio, archivo, instancias, progreso, guardarEscaneos) {
  progreso('Iniciando los controles previos al despliegue.', 'scanners');
  const resultados = await escanearDespliegue({ motor, directorio, archivo, instancias,
    informar: (mensaje, nivel) => progreso(mensaje, 'scanners', nivel),
    guardarResultados: guardarEscaneos,
  });
  const fallos = resultados.filter(({ estado }) => estado === 'error').map(({ nombre }) => nombre);
  if (fallos.length) throw new Error(`Escaneo incompleto (${fallos.join(', ')}). Revisa las herramientas y reintenta.`);
  progreso('Trivy, Gitleaks y Conftest completaron los controles previos.', 'scanners', 'exito');
}

export async function seleccionarAmi(aws, directorio, { amiPersonalizada, cuenta }) {
  const ruta = join(directorio, 'ami.txt');
  try {
    return (await readFile(ruta, 'utf8')).trim();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  let ami = amiPersonalizada;
  if (ami) {
    const { Images } = await aws('ec2', 'describe-images', '--image-ids', ami);
    const imagen = Images?.[0];
    if (imagen?.ImageId !== ami || imagen.OwnerId !== cuenta || imagen.State !== 'available' ||
        imagen.Public !== false || imagen.Architecture !== 'x86_64' || imagen.RootDeviceType !== 'ebs') {
      throw new Error('La AMI configurada debe estar disponible en Ohio, ser privada, usar x86_64 y EBS, y pertenecer a la cuenta del proyecto.');
    }
  } else {
    const { Parameter } = await aws('ssm', 'get-parameter', '--name',
      '/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64');
    ami = Parameter.Value;
  }
  try {
    await writeFile(ruta, ami, { flag: 'wx' });
    return ami;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return (await readFile(ruta, 'utf8')).trim();
  }
}

async function prepararArranque(aws, directorio, config, progreso) {
  const ansible = await seleccionarArranque(directorio, config);
  progreso(config.amiPersonalizada ? 'Validando o reutilizando la AMI privada configurada.' :
    'Resolviendo la AMI base de Amazon Linux o reutilizando la imagen fijada.',
    config.amiPersonalizada ? 'packer' : 'ec2');
  const ami = await seleccionarAmi(aws, directorio, config);
  if (config.amiPersonalizada) progreso(`AMI fijada para el tenant: ${ami}.`, 'packer', 'exito');
  progreso('Preparando los datos de arranque de las tres EC2.', 'cloud-init');
  if (ansible) progreso('Preparando los playbooks de las tres capas para el primer arranque.', 'ansible');
  return { ami, ansible };
}

async function seleccionarArranque(directorio, config) {
  const ruta = join(directorio, 'arranque.txt');
  try {
    await readFile(join(directorio, 'ami.txt'), 'utf8');
    await writeFile(ruta, 'shell', { flag: 'wx' });
  } catch (error) {
    if (error.code === 'ENOENT') {
      try {
        await writeFile(ruta, config.ansible ? 'ansible' : 'shell', { flag: 'wx' });
      } catch (escritura) {
        if (escritura.code !== 'EEXIST') throw escritura;
      }
    } else if (error.code !== 'EEXIST') {
      throw error;
    }
  }
  return (await readFile(ruta, 'utf8')) === 'ansible';
}

async function comprobarArranque(aws, servidores, progreso, ansible = false) {
  progreso('Esperando que los agentes de las tres EC2 estén en línea.', 'ssm');
  const ids = esperado.map((rol) => servidores[rol].id);
  const filtro = `Key=InstanceIds,Values=${ids.join(',')}`;
  for (let intento = 0; intento < 30; intento++) {
    const { InstanceInformationList } = await aws('ssm', 'describe-instance-information', '--filters', filtro);
    if (InstanceInformationList.filter(({ PingStatus }) => PingStatus === 'Online').length === 3) break;
    if (intento === 29) throw new Error('AWS creó las EC2, pero Systems Manager aún no las detecta.');
    await esperar(5000);
  }
  progreso('Comprobando que cloud-init termine en las tres EC2 y validando los servicios.', 'cloud-init');
  if (ansible) progreso('Esperando la finalización de los playbooks ejecutados por cloud-init.', 'ansible');
  await comprobarServicios(aws, servidores, progreso, {
    database: 'systemctl is-active mysqld',
    backend: 'systemctl is-active asistencia',
  });
  await comprobarServicios(aws, servidores, progreso, {
    frontend: `systemctl is-active nginx && curl -fsS -o /dev/null --max-time 10 http://127.0.0.1/ &&
      for intento in $(seq 1 24); do
        if [ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1/api/me)" = 401 ]; then exit 0; fi
        sleep 5
      done
      exit 1`,
  });
  progreso('Arranque completado en las tres EC2.', 'cloud-init', 'exito');
  if (ansible) progreso('Arranque con los playbooks verificado en las tres EC2.', 'ansible', 'exito');
}

async function comprobarServicios(aws, servidores, progreso, comandos) {
  const servicios = { database: 'MySQL', backend: 'API Node.js', frontend: 'Nginx y acceso a la API' };
  const solicitudes = await Promise.all(Object.entries(comandos).map(async ([rol, comando]) => {
    progreso(`Comprobando ${servicios[rol]}.`, 'ssm');
    const parametros = JSON.stringify({
      commands: ['set -e', 'cloud-init status --wait', comando],
      executionTimeout: ['600'],
    });
    const { Command } = await aws('ssm', 'send-command', '--instance-ids', servidores[rol].id,
      '--document-name', 'AWS-RunShellScript', '--parameters', parametros);
    return { id: servidores[rol].id, comando: Command.CommandId, rol };
  }));
  const pendientes = new Set(solicitudes);
  for (let intento = 0; intento < 126 && pendientes.size; intento++) {
    for (const solicitud of pendientes) {
      const { CommandInvocations } = await aws('ssm', 'list-command-invocations',
        '--command-id', solicitud.comando, '--instance-id', solicitud.id);
      const estado = CommandInvocations[0]?.Status;
      if (estado === 'Success') {
        pendientes.delete(solicitud);
        progreso(`${servicios[solicitud.rol]} verificado.`, 'ssm', 'exito');
      }
      if (['Failed', 'TimedOut', 'Cancelled'].includes(estado)) {
        throw new Error(`El servicio ${solicitud.rol} no inició. Revisa cloud-init en Systems Manager.`);
      }
    }
    if (pendientes.size) await esperar(5000);
  }
  if (pendientes.size) throw new Error('Se agotó el tiempo de verificación de los servicios.');
}

export async function conectarAws(config, ejecutarComando = ejecutar, cwd) {
  const env = { ...process.env, AWS_PROFILE: config.perfil, AWS_REGION: region, AWS_PAGER: '', TF_IN_AUTOMATION: '1' };
  for (const nombre of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'TF_DATA_DIR', 'TF_WORKSPACE',
    'TF_CLI_ARGS', 'TF_CLI_ARGS_init', 'TF_CLI_ARGS_plan', 'TF_CLI_ARGS_apply']) delete env[nombre];
  const aws = async (...args) => {
    const salida = await ejecutarComando('aws', [
      ...args, '--region', region, '--profile', config.perfil, '--no-cli-pager', '--output', 'json',
    ], { cwd, env });
    return salida.trim() ? JSON.parse(salida) : {};
  };
  const identidad = await aws('sts', 'get-caller-identity');
  if (identidad.Account !== config.cuenta ||
      !identidad.Arn.startsWith(`arn:aws:sts::${config.cuenta}:assumed-role/${config.rol}/`)) {
    throw new Error('El perfil debe asumir el rol dedicado del panel en la cuenta configurada.');
  }
  return { aws, env };
}

export async function desplegarOpenTofu({ config, directorio, datosTenant, tenant, progreso, guardarEscaneos, ejecutarComando = ejecutar }) {
  if (!ejecutable.test(tenant.identificador)) throw new Error('El identificador del tenant no es válido.');
  const cwd = await prepararTrabajo(directorio, tenant);
  const { aws, env } = await conectarAws(config, ejecutarComando, cwd);
  const ejecutarTofu = (...args) => ejecutarComando('tofu', args, { cwd, env });
  const { ami, ansible } = await prepararArranque(aws, datosTenant, config, progreso);
  const variables = {
    account_id: config.cuenta, tenant_id: tenant.identificador, environment: tenant.entorno,
    plan: tenant.plan.id, ami_id: ami, permissions_boundary_arn: config.limite,
    use_ansible: ansible, web_origin: origenLocal(tenant.puerto_local),
  };
  const clave = claveOpenTofu(tenant);
  await writeFile(join(cwd, 'tenant.tfvars.json'), JSON.stringify(variables));
  progreso('Ejecutando OpenTofu init con el estado del tenant en S3.');
  await ejecutarTofu('init', '-input=false', '-no-color', '-lock-timeout=30s',
    `-backend-config=bucket=${config.bucket}`, `-backend-config=key=${clave}`,
    '-backend-config=workspace_key_prefix=tenants/panel/workspaces');
  progreso('Ejecutando OpenTofu plan y revisando los cambios propuestos.');
  await ejecutarTofu('plan', '-input=false', '-no-color', '-lock-timeout=30s', '-var-file=tenant.tfvars.json', '-out=tenant.tfplan');
  const planJson = await ejecutarTofu('show', '-json', 'tenant.tfplan');
  const plan = JSON.parse(planJson);
  revisarPlan(plan, tenant.identificador);
  if (config.escaneos) {
    const archivo = join(directorio, 'plan-escaneo.json');
    await writeFile(archivo, planJson, { mode: 0o600 });
    try {
      const instancias = plan.resource_changes.filter(({ type, mode }) => type === 'aws_instance' && mode === 'managed')
        .map(({ name, index, change: { after } }) => ({
          id: index ?? name, comprobar_configuracion: true,
          imdsv2: after.metadata_options?.[0]?.http_tokens === 'required',
          cifrado: after.root_block_device?.[0]?.encrypted === true,
        }));
      await revisarSeguridad(tenant.motor, directorio, archivo, instancias, progreso, guardarEscaneos);
    } finally {
      await rm(archivo, { force: true });
    }
  }
  progreso('Ejecutando OpenTofu apply para aprovisionar la red y las tres EC2.');
  await ejecutarTofu('apply', '-input=false', '-no-color', '-lock-timeout=30s', 'tenant.tfplan');
  const outputs = JSON.parse(await ejecutarTofu('output', '-json'));
  const versiones = JSON.parse(await ejecutarTofu('version', '-json'));
  const servidores = outputs.instances.value;
  const instancias = Object.fromEntries(esperado.map((rol) => [rol, servidores[rol].id]));
  progreso('Verificando el inventario de las tres EC2 y sus discos raíz.', 'ec2');
  const discos = await describirInstancias(aws, tenant.identificador, instancias);
  await comprobarArranque(aws, servidores, progreso, ansible);
  return {
    instancias,
    volumenes: Object.fromEntries(discos.map(({ rol, volumen }) => [rol, volumen])),
    app_commit: outputs.deployment.value.app_commit,
    ami, arranque: ansible ? 'ansible' : 'shell',
    opentofu: versiones.tofu_version ?? versiones.terraform_version,
    proveedores: versiones.provider_selections,
    plantilla: createHash('sha256').update(await readFile(join(cwd, 'main.tf'))).digest('hex'),
  };
}

export async function desplegarPulumi({ config, directorio, datosTenant, tenant, progreso, guardarEscaneos, ejecutarComando = ejecutar }) {
  if (!ejecutable.test(tenant.identificador)) throw new Error('El identificador del tenant no es válido.');
  await mkdir(directorio, { recursive: true });
  const { aws, env } = await conectarAws(config, ejecutarComando, directorio);
  const { ami, ansible } = await prepararArranque(aws, datosTenant, config, progreso);
  const cwd = await prepararProgramaPulumi(datosTenant, tenant, { ...config, ami, ansible });
  progreso('Abriendo el estado remoto de Pulumi en S3.');
  const pila = await abrirPilaPulumi({ ejecutar: ejecutarComando, env, config, cwd, tenant, crear: true });
  progreso('Ejecutando Pulumi preview y revisando los cambios propuestos.');
  const archivo = join(directorio, 'pulumi-plan.json');
  const preview = JSON.parse(await pila.ejecutar('preview', '--json', '--show-sames', '--save-plan', archivo));
  revisarPreviewPulumi(preview, tenant);
  if (config.escaneos) {
    const { resourcePlans } = JSON.parse(await readFile(archivo, 'utf8'));
    const instancias = preview.steps.filter(({ urn }) => urn.includes('::aws:ec2/instance:Instance::'))
      .map(({ urn, op }) => {
        const entradas = resourcePlans?.[urn]?.goal?.inputDiff?.adds;
        return { id: urn.split('::').at(-1), comprobar_configuracion: op === 'create',
          imdsv2: entradas?.metadataOptions?.httpTokens === 'required',
          cifrado: entradas?.rootBlockDevice?.encrypted === true,
        };
      });
    await revisarSeguridad(tenant.motor, directorio, join(cwd, 'package-lock.json'), instancias, progreso, guardarEscaneos);
  }
  progreso('Ejecutando Pulumi up con el plan del tenant.');
  await pila.ejecutar('up', '--plan', archivo, '--yes', '--skip-preview');
  const salidas = JSON.parse(await pila.ejecutar('stack', 'output', '--json'));
  const instancias = Object.fromEntries(esperado.map((rol) => [rol, salidas.instances?.[rol]?.id]));
  progreso('Verificando el inventario de las tres EC2 y sus discos raíz.', 'ec2');
  const discos = await describirInstancias(aws, tenant.identificador, instancias);
  await comprobarArranque(aws, salidas.instances, progreso, ansible);
  const paquetes = JSON.parse(await readFile(join(cwd, 'package-lock.json'), 'utf8')).packages;
  return {
    instancias, volumenes: Object.fromEntries(discos.map(({ rol, volumen }) => [rol, volumen])),
    app_commit: salidas.appCommit, ami, arranque: ansible ? 'ansible' : 'shell',
    pulumi: (await pila.version()).trim(), aws_pulumi: paquetes['node_modules/@pulumi/aws'].version,
    plantilla: await huellaPulumi(cwd),
  };
}

export async function describirInstancias(aws, tenant, ids) {
  if (new Set(esperado.map((rol) => ids[rol])).size !== esperado.length ||
      esperado.some((rol) => !/^i-[0-9a-f]{8}(?:[0-9a-f]{9})?$/.test(ids[rol] ?? ''))) {
    throw new Error('Faltan los identificadores de las tres EC2 del tenant.');
  }
  const { Reservations } = await aws('ec2', 'describe-instances', '--instance-ids', ...Object.values(ids));
  const instancias = Reservations.flatMap(({ Instances }) => Instances);
  if (instancias.length !== esperado.length) throw new Error('AWS no devolvió las tres EC2 registradas.');
  return esperado.map((rol) => {
    const instancia = instancias.find(({ InstanceId }) => InstanceId === ids[rol]);
    const etiquetas = Object.fromEntries((instancia?.Tags ?? []).map(({ Key, Value }) => [Key, Value]));
    const volumen = instancia?.BlockDeviceMappings?.find(({ DeviceName }) => DeviceName === instancia.RootDeviceName)?.Ebs?.VolumeId;
    if (etiquetas.Project !== 'proyecto-final-modulo-2' || etiquetas.Tenant !== tenant ||
        etiquetas.Role !== rol || instancia?.RootDeviceType !== 'ebs' || !volumen) {
      throw new Error('Las EC2 o sus discos no coinciden con el tenant registrado.');
    }
    return { rol, id: instancia.InstanceId, estado: instancia.State.Name, volumen };
  });
}

export async function cambiarEstadoEc2({ config, tenant, tipo, infraestructura, progreso,
  ejecutarComando = ejecutar, pausar = esperar }) {
  if (tipo !== 'suspender' && tipo !== 'reanudar') throw new Error('Operación de EC2 desconocida.');
  const ids = Object.fromEntries(esperado.map((rol) => [rol, infraestructura?.instancias?.[rol]]));
  if (new Set(Object.values(ids)).size !== esperado.length ||
      Object.values(ids).some((id) => !/^i-[0-9a-f]{8}(?:[0-9a-f]{9})?$/.test(id ?? ''))) {
    throw new Error('Faltan los identificadores de EC2 del despliegue original.');
  }
  const { aws } = await conectarAws(config, ejecutarComando);
  const detener = tipo === 'suspender';
  const origen = detener ? 'running' : 'stopped';
  const objetivo = detener ? 'stopped' : 'running';
  const comando = detener ? 'stop-instances' : 'start-instances';
  let instancias = await describirInstancias(aws, tenant.identificador, ids);
  const volumenes = infraestructura.volumenes ??
    Object.fromEntries(instancias.map(({ rol, volumen }) => [rol, volumen]));
  const solicitadas = new Set();
  progreso(detener ? 'Deteniendo las tres EC2 y conservando sus discos.' : 'Encendiendo las tres EC2 del tenant.', 'ec2');
  for (let intento = 0; intento < 60; intento++) {
    for (const { rol, estado, volumen } of instancias) {
      if (!['running', 'stopped', 'pending', 'stopping'].includes(estado) || volumenes[rol] !== volumen) {
        throw new Error('AWS informó un cambio inesperado en las instancias o sus discos.');
      }
    }
    if (instancias.every(({ estado }) => estado === objetivo)) {
      if (!detener) {
        await comprobarArranque(aws, Object.fromEntries(instancias.map(({ rol, id }) => [rol, { id }])), progreso);
      }
      return { ...infraestructura, volumenes };
    }
    const pendientes = instancias.filter(({ estado, id }) => estado === origen && !solicitadas.has(id));
    if (pendientes.length) {
      await aws('ec2', comando, '--instance-ids', ...pendientes.map(({ id }) => id));
      for (const { id } of pendientes) solicitadas.add(id);
    }
    await pausar(5000);
    instancias = await describirInstancias(aws, tenant.identificador, ids);
  }
  throw new Error('AWS todavía no confirma el nuevo estado de todas las instancias. Puedes reintentar.');
}

function resumirRetiro(plan, tenant, infraestructura) {
  const cambios = (plan.resource_changes ?? []).filter(({ mode }) => mode === 'managed');
  const recursos = [];
  const discos = [];
  for (const { address, type, change } of cambios) {
    if (change.actions.join(',') === 'no-op') continue;
    const actual = change.before;
    const etiquetas = actual?.tags_all;
    if (change.actions.join(',') !== 'delete' || !actual ||
        (etiquetas && (etiquetas.Project !== 'proyecto-final-modulo-2' || etiquetas.Tenant !== tenant))) {
      throw new Error('El plan contiene recursos o cambios que requieren revisión en AWS.');
    }
    recursos.push({ direccion: address, identificador: actual.id });
    if (type !== 'aws_instance') continue;
    const rol = etiquetas?.Role;
    const disco = actual.root_block_device?.[0];
    if (!esperado.includes(rol) || infraestructura.instancias[rol] !== actual.id ||
        !disco?.volume_id || !disco.delete_on_termination ||
        (infraestructura.volumenes && infraestructura.volumenes[rol] !== disco.volume_id)) {
      throw new Error('Las EC2 o los discos del plan no coinciden con el despliegue registrado.');
    }
    discos.push({ rol, id: disco.volume_id, gib: disco.volume_size });
  }
  return { recursos, discos };
}

async function comprobarDiscosDelPlan(aws, discos, infraestructura) {
  if (!discos.length) return;
  const { Reservations } = await aws('ec2', 'describe-instances', '--instance-ids',
    ...discos.map(({ rol }) => infraestructura.instancias[rol]));
  const instancias = Reservations.flatMap(({ Instances }) => Instances);
  for (const { rol, id } of discos) {
    const instancia = instancias.find(({ InstanceId }) => InstanceId === infraestructura.instancias[rol]);
    const dispositivos = instancia?.BlockDeviceMappings ?? [];
    if (dispositivos.length !== 1 || dispositivos[0].DeviceName !== instancia.RootDeviceName ||
        dispositivos[0].Ebs?.VolumeId !== id || !dispositivos[0].Ebs.DeleteOnTermination) {
      throw new Error('La EC2 tiene discos distintos a los del plan. Revisa sus dispositivos en AWS.');
    }
  }
}

async function confirmarRetiroAws(aws, tenant, infraestructura, discosPlan) {
  const filtros = ['--filters', `Name=tag:Tenant,Values=${tenant}`];
  const discos = new Set([...Object.values(infraestructura.volumenes ?? {}), ...discosPlan.map(({ id }) => id)]);
  for (let intento = 0; intento < 8; intento++) {
    const [instancias, volumenes, vpcs, parametros] = await Promise.all([
      aws('ec2', 'describe-instances', ...filtros, 'Name=instance-state-name,Values=pending,running,stopping,stopped,shutting-down'),
      aws('ec2', 'describe-volumes', '--filters', discos.size ? `Name=volume-id,Values=${[...discos].join(',')}` : filtros[1]),
      aws('ec2', 'describe-vpcs', ...filtros),
      aws('ssm', 'describe-parameters', '--parameter-filters',
        `Key=Name,Option=BeginsWith,Values=/asistencia/proyecto-final-modulo-2/${tenant}/`),
    ]);
    if (!(instancias.Reservations.length || volumenes.Volumes.length || vpcs.Vpcs.length || parametros.Parameters.length)) return;
    await esperar(3000);
  }
  throw new Error('AWS todavía informa recursos del tenant. Revisa otro plan de retiro antes de reintentar.');
}

export async function gestionarRetiro({ config, tenant, datosTenant, tipo, trabajoId, retiro, infraestructura,
  progreso, ejecutarComando = ejecutar }) {
  if (!Number.isSafeInteger(retiro.despliegueId) || !infraestructura?.instancias) {
    throw new Error('Falta el despliegue original del tenant.');
  }
  const cwd = join(datosTenant, String(retiro.despliegueId), 'infra', 'opentofu');
  const { aws, env } = await conectarAws(config, ejecutarComando, cwd);
  const ejecutarTofu = (...args) => ejecutarComando('tofu', args, { cwd, env });
  const metadata = JSON.parse(await readFile(join(cwd, '.terraform', 'terraform.tfstate'), 'utf8'));
  if (metadata.backend?.type !== 's3' || metadata.backend.config.bucket !== config.bucket ||
      metadata.backend.config.key !== claveOpenTofu(tenant)) {
    throw new Error('El estado remoto no corresponde a este tenant.');
  }
  const preparando = tipo === 'preparar-retiro';
  const revision = preparando ? trabajoId : retiro.revision?.id;
  if (!Number.isSafeInteger(revision)) throw new Error('Prepara un plan nuevo antes de confirmar el retiro.');
  const archivo = `retiro-${revision}.tfplan`;
  if (preparando) {
    progreso('Generando el plan de retiro con OpenTofu.');
    await ejecutarTofu('plan', '-destroy', '-input=false', '-no-color', '-lock-timeout=30s',
      '-var-file=tenant.tfvars.json', `-out=${archivo}`);
  }
  const huella = createHash('sha256').update(await readFile(join(cwd, archivo))).digest('hex');
  const resumen = resumirRetiro(JSON.parse(await ejecutarTofu('show', '-json', archivo)), tenant.identificador, infraestructura);
  await comprobarDiscosDelPlan(aws, resumen.discos, infraestructura);
  if (preparando) return { ...resumen, huella };
  if (huella !== retiro.revision.huella) throw new Error('El plan cambió. Prepara un plan nuevo para revisarlo.');
  progreso('Aplicando el retiro confirmado en AWS.');
  if (resumen.recursos.length) {
    await ejecutarTofu('apply', '-input=false', '-no-color', '-lock-timeout=30s', archivo);
  }
  await confirmarRetiroAws(aws, tenant.identificador, infraestructura, resumen.discos);
  return { recursos: resumen.recursos.length, discos: resumen.discos.length };
}

export async function gestionarRetiroPulumi({ config, tenant, datosTenant, tipo, retiro, infraestructura, progreso,
  ejecutarComando = ejecutar }) {
  if (!infraestructura?.instancias || !infraestructura.volumenes) throw new Error('Falta el despliegue original de Pulumi.');
  const cwd = join(datosTenant, 'pulumi');
  verificarEntradaPulumi(JSON.parse(await readFile(join(cwd, 'tenant.pulumi.json'), 'utf8')), tenant, config.cuenta);
  const { aws, env } = await conectarAws(config, ejecutarComando, cwd);
  const pila = await abrirPilaPulumi({ ejecutar: ejecutarComando, env, config, cwd, tenant });
  progreso('Revisando el estado de Pulumi y los discos registrados en AWS.');
  const estado = JSON.parse(await pila.ejecutar('stack', 'export'));
  const { recursos, instancias, manifiesto } = inventarioPulumi(estado, tenant, infraestructura);
  const idsDiscos = instancias.map(({ rol }) => ({ rol, id: infraestructura.volumenes[rol] }));
  const ausentes = esperado.filter((rol) => !instancias.some((instancia) => instancia.rol === rol));
  if (ausentes.length) {
    const [ec2, ebs] = await Promise.all([
      aws('ec2', 'describe-instances', '--filters', `Name=instance-id,Values=${ausentes.map((rol) => infraestructura.instancias[rol]).join(',')}`,
        'Name=instance-state-name,Values=pending,running,stopping,stopped,shutting-down'),
      aws('ec2', 'describe-volumes', '--filters', `Name=volume-id,Values=${ausentes.map((rol) => infraestructura.volumenes[rol]).join(',')}`),
    ]);
    if (ec2.Reservations.length || ebs.Volumes.length) throw new Error('AWS conserva EC2 o discos fuera del estado de Pulumi.');
  }
  await comprobarDiscosDelPlan(aws, idsDiscos, infraestructura);
  const { Volumes } = idsDiscos.length
    ? await aws('ec2', 'describe-volumes', '--volume-ids', ...idsDiscos.map(({ id }) => id)) : { Volumes: [] };
  const discos = idsDiscos.map((disco) => {
    const volumen = Volumes.find(({ VolumeId }) => VolumeId === disco.id);
    if (!volumen) throw new Error('AWS no devolvió uno de los discos raíz del tenant.');
    return { ...disco, gib: volumen.Size };
  });
  const huella = createHash('sha256').update(JSON.stringify([manifiesto, recursos, discos])).digest('hex');
  if (tipo === 'preparar-retiro') return { recursos, discos, huella };
  if (huella !== retiro.revision?.huella) throw new Error('El estado de Pulumi cambió. Prepara y revisa un inventario nuevo.');
  progreso('Retirando los recursos confirmados de Pulumi.');
  if (recursos.length) await pila.ejecutar('destroy', '--yes');
  await confirmarRetiroAws(aws, tenant.identificador, infraestructura, discos);
  return { recursos: recursos.length, discos: discos.length };
}

export function ejecutarOperacionAws(trabajo) {
  const motor = trabajo.tenant.motor;
  if (!catalogo.motoresEjecutables.includes(motor)) {
    throw new Error('El motor de este tenant fue retirado del panel.');
  }
  if (trabajo.tipo === 'desplegar') {
    if (!trabajo.config.escaneos) {
      trabajo.progreso('Escaneos omitidos porque PFM2_ESCANEOS=0.', 'scanners', 'aviso');
    }
    if (motor === 'pulumi') return desplegarPulumi(trabajo);
    return desplegarOpenTofu(trabajo);
  }
  if (['suspender', 'reanudar'].includes(trabajo.tipo)) return cambiarEstadoEc2(trabajo);
  if (motor === 'pulumi') return gestionarRetiroPulumi(trabajo);
  return gestionarRetiro(trabajo);
}

export function iniciarTrabajador(registro, directorio, ejecutarTrabajo) {
  let ocupado = false;
  let cerrado = false;
  let activo = Promise.resolve();
  async function procesar() {
    if (ocupado || cerrado) return;
    ocupado = true;
    try {
      const trabajo = registro.reclamar();
      if (!trabajo) return;
      const tenant = registro.obtener(trabajo.tenant_id);
      let herramientaActual = ['suspender', 'reanudar'].includes(trabajo.tipo) ? 'ec2' : tenant.motor;
      const herramientaMotor = herramientaActual;
      const progreso = (fase, herramienta = herramientaMotor, nivel) => {
        herramientaActual = herramienta;
        registro.actualizar(trabajo.id, 'en-curso', fase, null, herramienta, nivel);
      };
      const latido = setInterval(() => registro.tocar(trabajo.id), 10_000);
      try {
        const datosTenant = join(directorio, tenant.identificador);
        const salida = await ejecutarTrabajo({
          directorio: join(datosTenant, String(trabajo.id)), datosTenant, tenant, progreso, tipo: trabajo.tipo,
          guardarEscaneos: (resultados) => registro.guardarEscaneos(trabajo.id, resultados),
          infraestructura: registro.obtenerInfraestructura(tenant.identificador), trabajoId: trabajo.id,
          retiro: registro.obtenerRetiro(tenant.identificador),
        });
        if (trabajo.tipo === 'suspender') {
          registro.actualizar(trabajo.id, 'suspendido', 'Las tres EC2 están detenidas y conservan sus discos.', salida);
        } else if (trabajo.tipo === 'preparar-retiro') {
          registro.actualizar(trabajo.id, 'retiro-pendiente', 'Revisa el plan antes de confirmar el retiro.', salida);
        } else if (trabajo.tipo === 'retirar') {
          registro.actualizar(trabajo.id, 'retirado', 'AWS confirmó el retiro de los recursos del tenant.', salida);
        } else {
          registro.actualizar(trabajo.id, 'listo', 'Los tres servicios están operativos.', salida);
        }
      } catch (error) {
        const mensaje = error.code === 'ENOENT' ? 'Comprueba las herramientas del motor y los archivos del despliegue.' :
          error.name === 'AbortError' ? 'El motor excedió el tiempo de espera.' :
          error.constructor === Error && !error.code ? error.message : 'El despliegue se interrumpió.';
        registro.actualizar(trabajo.id, 'error', mensaje, null, herramientaActual);
      } finally {
        clearInterval(latido);
      }
    } finally {
      ocupado = false;
    }
  }
  const intervalo = setInterval(() => {
    if (!ocupado) activo = procesar().catch(() => console.error('No se pudo procesar la cola de despliegues.'));
  }, 1500);
  intervalo.unref();
  return () => { cerrado = true; clearInterval(intervalo); return activo; };
}
