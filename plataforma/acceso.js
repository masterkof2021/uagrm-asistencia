import { randomBytes, scryptSync, timingSafeEqual, scrypt } from 'node:crypto';
import { promisify } from 'node:util';

const derivar = promisify(scrypt);
const duracion = 8 * 60 * 60 * 1000;
const nombreCookie = 'pfm2_sesion';

export function configurarAcceso(env = process.env) {
  const usuario = env.PFM2_ADMIN_USUARIO?.trim();
  const clave = env.PFM2_ADMIN_CLAVE;
  if (!/^[a-zA-Z0-9_.-]{2,64}$/.test(usuario ?? '') || !clave || clave.length < 12 || clave.length > 256) {
    throw new Error('Configura PFM2_ADMIN_USUARIO y PFM2_ADMIN_CLAVE (12 a 256 caracteres) antes de iniciar el panel.');
  }
  const sal = randomBytes(16);
  const hash = scryptSync(clave, sal, 64);
  const sesiones = new Map();
  let siguienteIntento = 0;

  function token(req) {
    return (req.headers.cookie ?? '').match(/(?:^|;\s*)pfm2_sesion=([a-f0-9]{64})(?=;|$)/)?.[1];
  }
  function cookie(valor, segundos) {
    return `${nombreCookie}=${valor}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${segundos}`;
  }
  return {
    operador(req) {
      const id = token(req);
      const vence = sesiones.get(id);
      if (vence > Date.now()) return usuario;
      sesiones.delete(id);
      return null;
    },
    async ingresar(req, res, datos) {
      const ahora = Date.now();
      if (ahora < siguienteIntento) return 429;
      siguienteIntento = ahora + 1000;
      if (typeof datos?.clave !== 'string' || datos.clave.length > 256) return 401;
      const intento = await derivar(datos.clave, sal, 64);
      if (!timingSafeEqual(intento, hash) || datos.usuario !== usuario) return 401;
      sesiones.delete(token(req));
      for (const [id, vence] of sesiones) if (vence <= ahora) sesiones.delete(id);
      if (sesiones.size >= 64) sesiones.delete(sesiones.keys().next().value);
      const id = randomBytes(32).toString('hex');
      sesiones.set(id, Date.now() + duracion);
      res.setHeader('Set-Cookie', cookie(id, duracion / 1000));
      return 200;
    },
    salir(req, res) {
      sesiones.delete(token(req));
      res.setHeader('Set-Cookie', cookie('', 0));
    },
  };
}
