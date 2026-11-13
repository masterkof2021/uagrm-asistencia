import { setTimeout as esperar } from 'node:timers/promises';
import { etiquetasPila, nombrePila } from '../infra/cloudformation/plantilla.js';

export async function consultarPila(aws, id) {
  try {
    const { Stacks } = await aws('cloudformation', 'describe-stacks', '--stack-name', id);
    if (Stacks.length !== 1) throw new Error('CloudFormation no devolvió una pila única.');
    return Stacks[0].StackStatus === 'DELETE_COMPLETE' ? null : Stacks[0];
  } catch (error) {
    if (error.pilaAusente) return null;
    throw error;
  }
}

function verificarEtiquetas(tags, tenant) {
  const actuales = new Map((tags ?? []).map(({ Key, Value }) => [Key, Value]));
  if (!etiquetasPila(tenant).every(({ Key, Value }) => actuales.get(Key) === Value)) {
    throw new Error('Las etiquetas de CloudFormation no corresponden a este tenant.');
  }
}

export function verificarPila(pila, tenant, id = pila.StackId) {
  if (pila.StackName !== nombrePila(tenant.identificador) || pila.StackId !== id || pila.RoleARN) {
    throw new Error('La pila de CloudFormation no coincide con el despliegue del panel.');
  }
  verificarEtiquetas(pila.Tags, tenant);
  if (!pila.Tags.some(({ Key, Value }) => Key === 'TemplateDigest' && /^[0-9a-f]{64}$/.test(Value))) {
    throw new Error('La pila carece de la huella de la plantilla del panel.');
  }
}

export async function recursosPila(aws, id) {
  const { StackResourceSummaries } = await aws('cloudformation', 'list-stack-resources', '--stack-name', id);
  return StackResourceSummaries.sort((a, b) => a.LogicalResourceId.localeCompare(b.LogicalResourceId));
}

async function consultarCambio(aws, pila, nombre) {
  try {
    return await aws('cloudformation', 'describe-change-set', '--stack-name', pila, '--change-set-name', nombre);
  } catch (error) {
    if (error.awsCode === 'ChangeSetNotFound') return null;
    throw error;
  }
}

async function esperarEstado(consultar, listo, pausar, mensaje) {
  for (let intento = 0; intento < 120; intento++) {
    const estado = await consultar();
    if (listo(estado)) return estado;
    await pausar(4000);
  }
  throw new Error(mensaje);
}

export async function borrarPila(aws, id, pausar = esperar) {
  const pila = await consultarPila(aws, id);
  if (!pila) return;
  if (pila.StackStatus !== 'DELETE_IN_PROGRESS') {
    await aws('cloudformation', 'delete-stack', '--stack-name', id);
  }
  await esperarEstado(() => consultarPila(aws, id), (actual) => {
    if (actual?.StackStatus === 'DELETE_FAILED') {
      throw new Error('CloudFormation no pudo eliminar todos los recursos. Revisa los eventos de la pila.');
    }
    return !actual;
  }, pausar, 'CloudFormation todavía está retirando la pila. Puedes consultar su estado en AWS.');
}

export async function aprovisionarPila(aws, { tenant, plantilla, archivo, huella, progreso, pausar = esperar }) {
  const nombre = nombrePila(tenant.identificador);
  const nombreCambio = `crear-${huella.slice(0, 12)}`;
  const etiquetas = [...etiquetasPila(tenant), { Key: 'TemplateDigest', Value: huella }];
  let pila = await consultarPila(aws, nombre);

  if (pila && pila.StackStatus !== 'REVIEW_IN_PROGRESS') verificarPila(pila, tenant);
  if (pila?.StackStatus === 'ROLLBACK_IN_PROGRESS') {
    pila = await esperarEstado(() => consultarPila(aws, pila.StackId),
      (actual) => actual?.StackStatus !== 'ROLLBACK_IN_PROGRESS', pausar, 'CloudFormation sigue revirtiendo la creación.');
  }
  if (pila?.StackStatus === 'ROLLBACK_COMPLETE') {
    const recursos = await recursosPila(aws, pila.StackId);
    if (recursos.some(({ ResourceStatus, PhysicalResourceId }) =>
      PhysicalResourceId && ResourceStatus !== 'DELETE_COMPLETE')) {
      throw new Error('La reversión conserva recursos. Revisa la pila en AWS antes de reintentar.');
    }
    await borrarPila(aws, pila.StackId, pausar);
    pila = null;
  }

  if (!pila || pila.StackStatus === 'REVIEW_IN_PROGRESS') {
    progreso('Generando y revisando el conjunto de cambios de CloudFormation.');
    let cambio = pila && await consultarCambio(aws, nombre, nombreCambio);
    if (pila && !cambio) throw new Error('Ya existe una revisión de CloudFormation con otra plantilla. Revisa la pila en AWS.');
    if (cambio?.Status === 'FAILED') {
      verificarEtiquetas(cambio.Tags, tenant);
      await aws('cloudformation', 'delete-change-set', '--stack-name', nombre, '--change-set-name', nombreCambio);
      cambio = null;
    }
    if (!cambio) {
      const creado = await aws('cloudformation', 'create-change-set', '--stack-name', nombre,
        '--change-set-name', nombreCambio, '--change-set-type', 'CREATE', '--capabilities', 'CAPABILITY_NAMED_IAM',
        '--template-body', `file://${archivo}`, '--tags', JSON.stringify(etiquetas));
      cambio = { ChangeSetId: creado.Id, StackId: creado.StackId };
    }
    const revision = await esperarEstado(() => consultarCambio(aws, cambio.StackId, cambio.ChangeSetId),
      (actual) => ['CREATE_COMPLETE', 'FAILED'].includes(actual?.Status), pausar,
      'CloudFormation todavía está preparando el conjunto de cambios.');
    verificarEtiquetas(revision.Tags, tenant);
    const recursos = revision.Changes?.map(({ ResourceChange }) => ResourceChange) ?? [];
    if (revision.Status !== 'CREATE_COMPLETE' || revision.ExecutionStatus !== 'AVAILABLE' || revision.NextToken ||
        revision.StackId !== cambio.StackId || !revision.Tags.some(({ Key, Value }) => Key === 'TemplateDigest' && Value === huella) ||
        recursos.length !== Object.keys(plantilla.Resources).length ||
        new Set(recursos.map(({ LogicalResourceId }) => LogicalResourceId)).size !== recursos.length ||
        recursos.some(({ Action, LogicalResourceId, ResourceType }) =>
          Action !== 'Add' || plantilla.Resources[LogicalResourceId]?.Type !== ResourceType)) {
      throw new Error('CloudFormation no aprobó el conjunto de altas previsto. Revisa su validación en AWS.');
    }
    progreso('Ejecutando el conjunto de cambios de CloudFormation.');
    await aws('cloudformation', 'execute-change-set', '--stack-name', revision.StackId, '--change-set-name', revision.ChangeSetId);
    pila = { StackId: revision.StackId, StackStatus: 'CREATE_IN_PROGRESS' };
  }

  if (pila.StackStatus === 'CREATE_IN_PROGRESS') {
    progreso('Esperando la red y las tres instancias de CloudFormation.');
    pila = await esperarEstado(() => consultarPila(aws, pila.StackId),
      (actual) => !['REVIEW_IN_PROGRESS', 'CREATE_IN_PROGRESS', 'ROLLBACK_IN_PROGRESS'].includes(actual?.StackStatus),
      pausar, 'CloudFormation sigue aprovisionando la pila. Puedes reintentar la comprobación.');
  }
  if (pila?.StackStatus !== 'CREATE_COMPLETE') {
    throw new Error(`CloudFormation no completó la pila (${pila?.StackStatus ?? 'sin estado'}). Revisa los eventos en AWS.`);
  }
  verificarPila(pila, tenant);
  return pila;
}
