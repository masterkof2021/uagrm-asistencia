import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inventarioPulumi, revisarPreviewPulumi } from '../pulumi.js';

const tenant = { identificador: 'demo-pulumi' };
const roles = ['backend', 'database', 'frontend'];
const tipo = 'aws:ec2/instance:Instance';
const urn = (rol) => `urn:pulumi:demo-pulumi::pfm2-tenants::${tipo}::${rol}`;

test('Pulumi permite altas y reintentos sin cambios y bloquea sustituciones y otras pilas', () => {
  const pasos = roles.map((rol) => ({ urn: urn(rol), op: 'create' }));
  revisarPreviewPulumi({ steps: pasos }, tenant);
  revisarPreviewPulumi({ steps: pasos.map((paso) => ({ ...paso, op: 'same' })) }, tenant);
  assert.throws(() => revisarPreviewPulumi({ steps: [...pasos, { urn: urn('frontend'), op: 'replace' }] }, tenant),
    /distintos al despliegue inicial/);
  assert.throws(() => revisarPreviewPulumi({ steps: [...pasos, {
    urn: urn('frontend').replace('demo-pulumi', 'otro-tenant'), op: 'create',
  }] }, tenant), /distintos al despliegue inicial/);
});

test('Pulumi inventaría las EC2 registradas y rechaza otra identidad o un borrado pendiente', () => {
  const infraestructura = { instancias: Object.fromEntries(roles.map((rol, i) => [rol, `i-0000000${i}`])) };
  const resources = roles.map((rol) => ({ urn: urn(rol), type: tipo, custom: true, id: infraestructura.instancias[rol] }));
  const estado = { deployment: { resources, manifest: { time: '2026-11-12T00:00:00Z' } } };
  assert.equal(inventarioPulumi(estado, tenant, infraestructura).recursos.length, 3);
  assert.throws(() => inventarioPulumi({ deployment: { resources: [{ ...resources[0], id: 'i-00000009' }] } },
    tenant, infraestructura), /no coinciden con el despliegue/);
  assert.throws(() => inventarioPulumi({ deployment: { resources: [{ ...resources[0], delete: true }] } },
    tenant, infraestructura), /operaciones pendientes/);
});
