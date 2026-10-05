// Usuarios del panel.
//
// La clave se guarda con scrypt y sal propia por usuario: lo que queda en la
// base NO sirve para entrar, y si alguien leyera la tabla no tendría las
// claves. scrypt y no SHA a secas porque SHA es rápido, y lo que se quiere
// aquí es justo lo contrario: que probar millones de claves cueste.
//
// Va en su propio archivo para que el día que haya que subir el coste de
// derivación (N) se toque un sitio y no el servidor entero.

import crypto from 'node:crypto';

const ETIQUETA = 's1';
const N = 16384;   // ~16 MB y unos 50 ms por intento en el VPS
const R = 8;
const P = 1;
const LARGO = 32;

export const ROLES = ['admin', 'editor', 'lector'];

/** Devuelve "s1$N$sal$hash". El formato lleva N dentro para poder subirlo luego. */
export function cifrar(clave) {
  const sal = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(clave), sal, LARGO, { N, r: R, p: P });
  return `${ETIQUETA}$${N}$${sal.toString('hex')}$${hash.toString('hex')}`;
}

/** Comparación en tiempo constante: el tiempo de respuesta no dice si acertó. */
export function verificar(clave, guardado) {
  const partes = String(guardado || '').split('$');
  if (partes.length !== 4 || partes[0] !== ETIQUETA) return false;
  const [, n, salHex, hashHex] = partes;
  try {
    const esperado = Buffer.from(hashHex, 'hex');
    const hash = crypto.scryptSync(
      String(clave), Buffer.from(salHex, 'hex'), esperado.length,
      { N: Number(n) || N, r: R, p: P },
    );
    return crypto.timingSafeEqual(hash, esperado);
  } catch {
    return false;
  }
}

/**
 * Lo que de un usuario puede salir hacia el navegador.
 *
 * Una sola función, usada por todas las rutas: así no hay una respuesta que se
 * olvide de quitar la columna `clave`. Esa es la fuga que se escribe sola.
 */
export const publico = (u) => u && {
  id: u.id, nombre: u.nombre, correo: u.correo, rol: u.rol,
  activo: u.activo, creado: u.creado, ultimo_acceso: u.ultimo_acceso,
};

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const MINIMO_CLAVE = 8;

/**
 * Valida lo que llega del formulario y devuelve la fila lista para la base.
 *
 * Lanza con el motivo exacto, que el panel muestra tal cual. Un "datos
 * inválidos" obliga a adivinar qué campo era.
 */
export function filaDesdeFormulario(cuerpo, { nuevo }) {
  const nombre = String(cuerpo?.nombre || '').trim();
  const correo = String(cuerpo?.correo || '').trim().toLowerCase();
  const rol = String(cuerpo?.rol || 'editor');
  const clave = String(cuerpo?.clave || '');

  if (!nombre) throw Object.assign(new Error('Falta el nombre.'), { estado: 400 });
  if (!CORREO.test(correo)) throw Object.assign(new Error(`"${correo}" no parece un correo.`), { estado: 400 });
  if (!ROLES.includes(rol)) throw Object.assign(new Error(`Rol desconocido: ${rol}.`), { estado: 400 });
  if (nuevo && !clave) throw Object.assign(new Error('Falta la clave.'), { estado: 400 });
  if (clave && clave.length < MINIMO_CLAVE) {
    throw Object.assign(
      new Error(`La clave necesita al menos ${MINIMO_CLAVE} caracteres.`), { estado: 400 });
  }

  const fila = { nombre, correo, rol, activo: cuerpo?.activo !== false };
  // Sin clave en el cuerpo, la que había se queda. Así se puede cambiar el rol
  // de alguien sin tener que inventarle una clave nueva.
  if (clave) fila.clave = cifrar(clave);
  return fila;
}
