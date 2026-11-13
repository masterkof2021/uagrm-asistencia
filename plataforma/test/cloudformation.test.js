import assert from 'node:assert/strict';
import { test } from 'node:test';
import { etiquetasPila, generarPlantilla, nombrePila } from '../../infra/cloudformation/plantilla.js';
import { catalogo } from '../catalogo.js';
import { aprovisionarPila } from '../cloudformation.js';

const tenant = { identificador: 'demo-cloudformation', entorno: 'pruebas', plan: catalogo.planes[1] };
const StackName = nombrePila(tenant.identificador);
const StackId = `arn:aws:cloudformation:us-east-2:123456789012:stack/${StackName}/demo`;
const huella = 'a'.repeat(64);
const Tags = [...etiquetasPila(tenant), { Key: 'TemplateDigest', Value: huella }];

test('la plantilla aplica el catálogo y el aislamiento de las tres capas', async () => {
  const plantilla = await generarPlantilla(tenant, {
    ami: 'ami-00000000000000000', discoRaiz: '/dev/xvda', limite: 'limite-del-proyecto',
  });
  const { Resources: recursos } = plantilla;
  const { InstanciaFrontend: frontend, InstanciaBackend: backend, InstanciaDatabase: database } = recursos;
  assert.deepEqual([frontend, backend, database].map(({ Properties }) => [
    Properties.InstanceType, Properties.BlockDeviceMappings[0].Ebs.VolumeSize,
    Properties.BlockDeviceMappings[0].Ebs.DeleteOnTermination, Properties.MetadataOptions.HttpTokens,
  ]), [['t3.micro', 12, true, 'required'], ['t3.micro', 20, true, 'required'], ['t3.small', 32, true, 'required']]);
  assert.deepEqual(recursos.EntradaDatabase.Properties.SourceSecurityGroupId, { Ref: 'SeguridadBackend' });
  assert.deepEqual(recursos.EntradaBackend.Properties.SourceSecurityGroupId, { Ref: 'SeguridadFrontend' });
  assert.equal(recursos.SeguridadFrontend.Properties.SecurityGroupIngress, undefined);
  assert.match(database.Properties.UserData['Fn::Base64'], /secretsmanager get-secret-value/);
  assert.equal(recursos.SecretoDb.Properties.GenerateSecretString.PasswordLength, 48);
  assert.equal(recursos.RolDatabase.Properties.PermissionsBoundary, 'limite-del-proyecto');
});

test('CloudFormation reusa la pila creada y rechaza cambios que no sean altas del tenant', async () => {
  const plantilla = { Resources: { Red: { Type: 'AWS::EC2::VPC' } } };
  const opciones = { tenant, plantilla, archivo: 'tenant.json', huella, progreso() {}, pausar: async () => {} };
  const pila = { StackName, StackId, StackStatus: 'CREATE_COMPLETE', Tags };
  assert.equal(await aprovisionarPila(async (_, accion) => {
    assert.equal(accion, 'describe-stacks');
    return { Stacks: [pila] };
  }, opciones), pila);

  const acciones = [];
  await assert.rejects(aprovisionarPila(async (_, accion) => {
    acciones.push(accion);
    if (accion === 'describe-stacks') throw Object.assign(new Error(), { pilaAusente: true });
    if (accion === 'create-change-set') return { Id: 'cambio', StackId };
    if (accion === 'describe-change-set') return {
      StackId, ChangeSetId: 'cambio', Tags, Status: 'CREATE_COMPLETE', ExecutionStatus: 'AVAILABLE',
      Changes: [{ ResourceChange: { Action: 'Remove', LogicalResourceId: 'Red', ResourceType: 'AWS::EC2::VPC' } }],
    };
    assert.fail('El conjunto de cambios inválido nunca debe ejecutarse.');
  }, opciones), /no aprobó el conjunto de altas/);
  assert.deepEqual(acciones, ['describe-stacks', 'create-change-set', 'describe-change-set']);
});
