import { readFile } from 'node:fs/promises';

export const appCommit = 'ba7a8216be0c1c836925ea8964ad463295d961d0';
export const capas = {
  frontend: { nombre: 'Frontend', ip: '10.248.1.10' },
  backend: { nombre: 'Backend', ip: '10.248.1.20' },
  database: { nombre: 'MySQL', ip: '10.248.1.30' },
};
const inicio = new URL('./opentofu/cloud-init/', import.meta.url);

export function origenLocal(puerto = null) {
  return `http://127.0.0.1:${puerto ?? 8080}`;
}

export async function scriptsArranque(prefijo, comandoSecretos, ansible = false, puerto = null) {
  const variables = {
    app_commit: appCommit, parameter_prefix: prefijo, frontend_ip: capas.frontend.ip, backend_ip: capas.backend.ip,
    database_ip: capas.database.ip, web_origin: origenLocal(puerto), read_secret_command: comandoSecretos,
  };
  const comun = (await readFile(new URL('common.sh.tftpl', inicio), 'utf8'))
    .replace(/\$\{([a-z_]+)\}/g, (_, campo) => {
      if (!Object.hasOwn(variables, campo)) throw new Error('El script de arranque contiene una variable desconocida.');
      return variables[campo];
    });
  return Object.fromEntries(await Promise.all(Object.keys(capas).map(async (rol) => {
    const script = await readFile(new URL(`${rol}.sh`, inicio), 'utf8');
    if (!ansible) return [rol, `${comun}\n${script}`.replaceAll('\r\n', '\n')];
    const leer = (archivo) => readFile(new URL(archivo, inicio), 'utf8');
    const capa = rol === 'frontend' ? [] : [await leer('capa.sh'), script, 'PFM2_CAPA'];
    const partes = [comun, ...capa, `pfm2_rol=${rol}`, await leer('ansible.sh'),
      await leer(`${rol}.yml`), await leer('ejecutar-ansible.sh')];
    return [rol, partes.map((parte) => parte.trimEnd()).join('\n').replaceAll('\r\n', '\n') + '\n'];
  })));
}
