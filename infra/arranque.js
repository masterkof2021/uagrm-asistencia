import { readFile } from 'node:fs/promises';

export const appCommit = 'ba7a8216be0c1c836925ea8964ad463295d961d0';
export const capas = {
  frontend: { nombre: 'Frontend', ip: '10.248.1.10' },
  backend: { nombre: 'Backend', ip: '10.248.1.20' },
  database: { nombre: 'MySQL', ip: '10.248.1.30' },
};
const inicio = new URL('./opentofu/cloud-init/', import.meta.url);

export async function scriptsArranque(prefijo, comandoSecretos) {
  const variables = {
    app_commit: appCommit, parameter_prefix: prefijo, frontend_ip: capas.frontend.ip, backend_ip: capas.backend.ip,
    database_ip: capas.database.ip, web_origin: 'http://127.0.0.1:8080', read_secret_command: comandoSecretos,
  };
  const comun = (await readFile(new URL('common.sh.tftpl', inicio), 'utf8'))
    .replace(/\$\{([a-z_]+)\}/g, (_, campo) => {
      if (!Object.hasOwn(variables, campo)) throw new Error('El script de arranque contiene una variable desconocida.');
      return variables[campo];
    });
  return Object.fromEntries(await Promise.all(Object.keys(capas).map(async (rol) => {
    const script = await readFile(new URL(`${rol}.sh`, inicio), 'utf8');
    return [rol, `${comun}\n${script}`.replaceAll('\r\n', '\n')];
  })));
}
