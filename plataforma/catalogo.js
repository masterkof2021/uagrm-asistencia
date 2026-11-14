import planes from './planes.json' with { type: 'json' };

const motores = [
  { id: 'opentofu', nombre: 'OpenTofu' },
  { id: 'pulumi', nombre: 'Pulumi' },
];

export const catalogo = {
  region: 'us-east-2',
  entornos: [
    { id: 'pruebas', nombre: 'Pruebas' },
    { id: 'produccion', nombre: 'Producción' },
  ],
  motores,
  motoresEjecutables: motores.map(({ id }) => id),
  planes,
};
