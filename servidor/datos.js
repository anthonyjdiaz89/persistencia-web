// Acceso a la base de Persistencia Digital.
//
// La llave de servicio vive SOLO aquí. Nunca se manda al navegador, nunca se
// escribe en una respuesta, nunca entra a un log. Es la que salta RLS: con ella
// se lee todo, y lo que hay en estas tablas es la plata de la casa.
//
// Se habla con PostgREST por HTTP en vez de con el cliente oficial de Supabase
// a propósito: son cuatro verbos y un `fetch`, y así el contenedor no carga una
// dependencia más para hacer lo mismo.

const URL_BASE = (process.env.SB_PD_URL || '').replace(/\/$/, '');
const LLAVE = process.env.SB_PD_SERVICE_KEY || '';

if (!URL_BASE || !LLAVE) {
  // Morir aquí y no al primer uso: un panel que arranca sin base y falla
  // media hora después, en mitad de un presupuesto, es peor que uno que no
  // arranca.
  console.error('FALTA SB_PD_URL o SB_PD_SERVICE_KEY — el panel no puede trabajar sin base.');
  process.exit(1);
}

const CABECERAS = {
  apikey: LLAVE,
  Authorization: `Bearer ${LLAVE}`,
  'Content-Type': 'application/json',
};

async function pedir(ruta, opciones = {}) {
  const r = await fetch(`${URL_BASE}/rest/v1/${ruta}`, {
    ...opciones,
    headers: { ...CABECERAS, ...(opciones.headers || {}) },
  });
  const texto = await r.text();
  if (!r.ok) {
    // El cuerpo de PostgREST explica el porqué (columna que no existe, check
    // que falla). Se propaga tal cual: un "error al guardar" no sirve a nadie.
    throw Object.assign(new Error(texto || `HTTP ${r.status}`), { estado: r.status });
  }
  return texto ? JSON.parse(texto) : null;
}

export const bd = {
  listar: (tabla, consulta = '') => pedir(`${tabla}?${consulta}`),

  uno: async (tabla, id, consulta = 'select=*') => {
    const filas = await pedir(`${tabla}?id=eq.${id}&${consulta}`);
    return filas?.[0] || null;
  },

  crear: async (tabla, fila) => {
    const filas = await pedir(tabla, {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(fila),
    });
    return Array.isArray(filas) ? filas[0] : filas;
  },

  // Inserción en lote: la importación de Excel mete decenas de líneas y
  // hacerlo de una evita decenas de viajes.
  crearVarias: (tabla, filas) =>
    filas.length
      ? pedir(tabla, {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(filas),
        })
      : [],

  actualizar: async (tabla, id, cambios) => {
    const filas = await pedir(`${tabla}?id=eq.${id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(cambios),
    });
    return Array.isArray(filas) ? filas[0] : filas;
  },

  borrar: (tabla, id) => pedir(`${tabla}?id=eq.${id}`, { method: 'DELETE' }),

  borrarPorEvento: (tabla, eventoId) =>
    pedir(`${tabla}?evento_id=eq.${eventoId}`, { method: 'DELETE' }),
};

/** Para el chequeo de salud: confirma que la base responde de verdad. */
export async function baseViva() {
  try {
    await pedir('pd_eventos?select=id&limit=1');
    return true;
  } catch {
    return false;
  }
}
