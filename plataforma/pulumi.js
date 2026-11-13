import { createHash, randomBytes } from 'node:crypto';
import { copyFile, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appCommit, capas, scriptsArranque } from '../infra/arranque.js';

const modulo = fileURLToPath(new URL('../infra/pulumi/', import.meta.url));
const nombreProyecto = 'pfm2-tenants';
const tipoInstancia = 'aws:ec2/instance:Instance';
const archivos = ['index.cjs', 'package.json', 'package-lock.json'];
const paquetesPulumi = ['@pulumi/aws', '@pulumi/pulumi'];
const sufijoUrn = (urn) => urn.split('::').at(-1);

async function crearArchivo(ruta, contenido, mode) {
  try {
    await writeFile(ruta, contenido, { flag: 'wx', mode });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  return readFile(ruta, 'utf8');
}

async function verificarDependencias(cwd, dependencias) {
  const { packages } = JSON.parse(await readFile(join(cwd, 'package-lock.json'), 'utf8'));
  for (const paquete of paquetesPulumi) {
    const { version } = JSON.parse(await readFile(join(dependencias, paquete, 'package.json'), 'utf8'));
    if (version !== packages[`node_modules/${paquete}`]?.version) {
      throw new Error('Las dependencias instaladas de Pulumi no coinciden con el programa fijado del tenant.');
    }
  }
}

export async function prepararProgramaPulumi(datosTenant, tenant, { ami, cuenta, limite }) {
  const cwd = join(datosTenant, 'pulumi');
  await mkdir(cwd, { recursive: true });
  const destino = join(cwd, 'node_modules');
  const dependencias = join(modulo, 'node_modules');
  try {
    await Promise.all(paquetesPulumi.map((paquete) => realpath(join(dependencias, paquete, 'package.json'))));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error('Instala las dependencias con npm ci --prefix infra/pulumi.');
  }
  try {
    await symlink(dependencias, destino, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  if (await realpath(destino) !== await realpath(dependencias)) {
    throw new Error('Las dependencias de la pila no coinciden con el módulo Pulumi del proyecto.');
  }

  const entrada = join(cwd, 'tenant.pulumi.json');
  let guardada;
  try {
    guardada = JSON.parse(await readFile(entrada, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (guardada !== undefined) {
    verificarEntradaPulumi(guardada, tenant, cuenta);
    await verificarDependencias(cwd, dependencias);
    return cwd;
  }
  await Promise.all(archivos.map((archivo) => copyFile(join(modulo, archivo), join(cwd, archivo))));
  await verificarDependencias(cwd, dependencias);
  const prefijo = `/asistencia/proyecto-final-modulo-2/${tenant.identificador}/pulumi`;
  const scripts = await scriptsArranque(prefijo,
    'aws ssm get-parameter --region us-east-2 --with-decryption --name "$parameter_prefix/$1" --query Parameter.Value --output text');
  const servidores = Object.fromEntries(Object.entries(capas).map(([rol, { nombre, ip }]) => {
    const recurso = tenant.plan.recursos.find((recurso) => recurso.rol === nombre);
    if (!recurso) throw new Error('Falta una capa en el plan del tenant.');
    return [rol, { ip, instancia: recurso.instancia, discoGiB: recurso.discoGiB, script: scripts[rol] }];
  }));
  await writeFile(join(cwd, 'Pulumi.yaml'), JSON.stringify({ name: nombreProyecto, runtime: 'nodejs', main: 'index.cjs' }));
  await crearArchivo(entrada, JSON.stringify({
    cuenta, limite, ami, tenant: tenant.identificador, entorno: tenant.entorno, capas: servidores, prefijo, appCommit,
  }));
  return cwd;
}

export function verificarEntradaPulumi(entrada, tenant, cuenta) {
  if (entrada?.tenant !== tenant.identificador || entrada.entorno !== tenant.entorno || entrada.cuenta !== cuenta) {
    throw new Error('El programa de Pulumi guardado pertenece a otra cuenta o tenant.');
  }
}

export async function abrirPilaPulumi({ ejecutar, env, config, cwd, tenant, crear = false }) {
  const entorno = Object.fromEntries(Object.entries(env).filter(([nombre]) =>
    !nombre.startsWith('PULUMI_') || nombre === 'PULUMI_HOME'));
  entorno.PULUMI_BACKEND_URL = `s3://${config.bucket}/tenants/panel/pulumi?region=us-east-2`;
  entorno.PULUMI_SKIP_UPDATE_CHECK = 'true';
  const invocar = (...args) => ejecutar('pulumi', [...args, '--non-interactive', '--color', 'never'], { cwd, env: entorno });
  const pila = tenant.identificador;
  const pilas = JSON.parse(await invocar('stack', 'ls', '--json'));
  const existe = pilas.some(({ name }) => name.split('/').at(-1) === pila);
  if (!existe && !crear) throw new Error('Falta el estado remoto de la pila de Pulumi del tenant.');
  const ruta = join(cwd, 'clave.local');
  let clave;
  try {
    clave = await readFile(ruta, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (existe) throw new Error('Falta la clave local que permite abrir la pila de Pulumi.');
    clave = await crearArchivo(ruta, randomBytes(32).toString('hex'), 0o600);
  }
  if (!/^[a-f0-9]{64}$/.test(clave)) throw new Error('La clave local de Pulumi tiene un formato inválido.');
  entorno.PULUMI_CONFIG_PASSPHRASE = clave;
  if (!existe) await invocar('stack', 'init', pila, '--secrets-provider', 'passphrase');
  return {
    ejecutar: (...args) => invocar(...args, '--stack', pila),
    version: () => invocar('version'),
  };
}

function esUrnDelTenant(urn, tenant) {
  return typeof urn === 'string' && urn.startsWith(`urn:pulumi:${tenant.identificador}::${nombreProyecto}::`);
}

export function revisarPreviewPulumi(preview, tenant) {
  const pasos = preview.steps;
  if (!Array.isArray(pasos) || pasos.some(({ op, urn }) =>
    !['create', 'same'].includes(op) || !esUrnDelTenant(urn, tenant))) {
    throw new Error('El plan de Pulumi contiene cambios distintos al despliegue inicial del tenant.');
  }
  const instancias = pasos.filter(({ urn }) => urn.includes(`::${tipoInstancia}::`));
  if (instancias.length !== 3 || !Object.keys(capas).every((rol) => instancias.some(({ urn }) => sufijoUrn(urn) === rol))) {
    throw new Error('El plan de Pulumi no contiene las tres capas previstas.');
  }
}

export function inventarioPulumi(estado, tenant, infraestructura) {
  const despliegue = estado.deployment;
  if (!Array.isArray(despliegue?.resources) || despliegue.pending_operations?.length ||
      despliegue.resources.some(({ urn, type, delete: pendiente }) =>
        !esUrnDelTenant(urn, tenant) || pendiente ||
        !(type?.startsWith('aws:') || ['pulumi:pulumi:Stack', 'pulumi:providers:aws'].includes(type)))) {
    throw new Error('El estado de Pulumi no coincide con el tenant o tiene operaciones pendientes.');
  }
  const aws = despliegue.resources.filter(({ type }) => type.startsWith('aws:'));
  if (aws.some(({ id, custom }) => !id || !custom)) throw new Error('Pulumi devolvió un recurso sin identidad confirmada.');
  const instancias = aws.filter(({ type }) => type === tipoInstancia).map(({ urn, id }) => ({ rol: sufijoUrn(urn), id }));
  if (instancias.some(({ rol, id }) => !Object.hasOwn(capas, rol) || id !== infraestructura.instancias[rol])) {
    throw new Error('Las EC2 de Pulumi no coinciden con el despliegue registrado.');
  }
  const recursos = aws.map(({ urn, id }) => ({ direccion: urn.split('::').slice(2).join('::'), identificador: id }))
    .sort((a, b) => a.direccion.localeCompare(b.direccion));
  return { recursos, instancias, manifiesto: despliegue.manifest };
}

export async function huellaPulumi(cwd) {
  const hash = createHash('sha256');
  for (const archivo of ['index.cjs', 'package-lock.json', 'tenant.pulumi.json']) {
    hash.update(await readFile(join(cwd, archivo)));
  }
  return hash.digest('hex');
}
