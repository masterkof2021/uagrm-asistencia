import planes from './planes.json' with { type: 'json' };

export const catalogo = {
  region: 'us-east-2',
  entornos: [
    { id: 'pruebas', nombre: 'Pruebas' },
    { id: 'produccion', nombre: 'Producción' },
  ],
  motores: [
    { id: 'opentofu', nombre: 'OpenTofu' },
    { id: 'cloudformation', nombre: 'CloudFormation' },
    { id: 'terraform', nombre: 'Terraform' },
    { id: 'pulumi', nombre: 'Pulumi' },
  ],
  motoresEjecutables: ['opentofu', 'cloudformation', 'terraform', 'pulumi'],
  planes,
};
