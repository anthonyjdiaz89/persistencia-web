// El servidor del panel.
//
// NO sirve el sitio: de eso sigue encargándose nginx, con sus tipos MIME para
// glb/mind/wasm, su caché de 30 días y sus URLs limpias. Esa configuración ya
// está probada en producción y las experiencias AR dependen de ella — moverla
// para añadir un panel de presupuestos sería apostar el sitio vivo por una
// comodidad. Aquí solo vive /api, y nginx le pasa esas rutas.
//
// Si este proceso se cae, el sitio sigue en pie. Solo el panel deja de
// responder.

import express from 'express';
import crypto from 'node:crypto';
import { bd, baseViva } from './datos.js';
import { resumen, porCategoria } from './calculos.js';
import { exportarEvento, exportarEventos, importarEvento } from './excel.js';
import { cotizacionHTML, COTIZACION_EN_BLANCO } from './cotizacion.js';
import { verificar, publico, filaDesdeFormulario } from './usuarios.js';

const app = express();
const PUERTO = Number(process.env.PUERTO || 3000);
const CLAVE = process.env.CLAVE_ADMIN || '';
const SECRETO = process.env.SECRETO_SESION || crypto.randomBytes(32).toString('hex');

if (!CLAVE) {
  console.error('FALTA CLAVE_ADMIN — sin clave el panel quedaría abierto. No arranco.');
  process.exit(1);
}

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

// ───────────────────────────── sesión ─────────────────────────────
//
// Cookie firmada, sin tabla de sesiones. Dentro va QUIÉN entró y con qué rol,
// y la firma cubre todo el paquete: cambiar el rol dentro de la cookie la
// invalida. La caducidad también va firmada, así que una cookie guardada no
// sirve pasada la jornada.

const firmar = (datos) => {
  const cuerpo = Buffer.from(JSON.stringify(datos)).toString('base64url');
  return `${cuerpo}.${crypto.createHmac('sha256', SECRETO).update(cuerpo).digest('hex')}`;
};

function abrirSesion(cookie) {
  if (!cookie) return null;
  const corte = String(cookie).lastIndexOf('.');
  if (corte < 1) return null;
  const cuerpo = String(cookie).slice(0, corte);
  const firma = String(cookie).slice(corte + 1);
  const esperada = crypto.createHmac('sha256', SECRETO).update(cuerpo).digest('hex');
  // timingSafeEqual exige mismo largo: una firma truncada no debe tirar excepción
  if (firma.length !== esperada.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) return null;
  try {
    const sesion = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
    return Number(sesion.hasta) > Date.now() ? sesion : null;
  } catch {
    return null;
  }
}

const leerCookie = (req, nombre) =>
  (req.headers.cookie || '')
    .split(';')
    .map((c) => c.trim().split('='))
    .find(([k]) => k === nombre)?.[1];

const JORNADA = 12 * 60 * 60 * 1000;

const ponerCookie = (res, sesion) => res.setHeader('Set-Cookie',
  `pd_panel=${firmar(sesion)}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=${JORNADA / 1000}`);

/** La clave maestra, comparada en tiempo constante. */
const esMaestra = (dada) => Boolean(CLAVE)
  && dada.length === CLAVE.length
  && crypto.timingSafeEqual(Buffer.from(dada), Buffer.from(CLAVE));

/**
 * Entrar: con correo y clave de un usuario, o con la clave maestra sola.
 *
 * La maestra NO se retira al crear usuarios, a propósito. Si se retirara, un
 * fallo en la tabla de usuarios —o alguien que se borre a sí mismo— dejaría a
 * la casa fuera de su propio panel sin forma de volver a entrar.
 */
app.post('/api/entrar', async (req, res, sig) => {
  try {
    const correo = String(req.body?.correo || '').trim().toLowerCase();
    const clave = String(req.body?.clave || '');
    let quien = null;

    if (correo) {
      // Si la tabla de usuarios todavía no existe (esquema sin aplicar), esto
      // falla: se deja pasar a la clave maestra en vez de tumbar la entrada.
      const filas = await bd.listar('pd_usuarios',
        `correo=eq.${encodeURIComponent(correo)}&select=*&limit=1`).catch(() => []);
      const u = filas?.[0];
      if (u && u.activo && verificar(clave, u.clave)) {
        quien = { id: u.id, nombre: u.nombre, correo: u.correo, rol: u.rol };
        // Anotar la hora no debe poder impedir la entrada.
        bd.actualizar('pd_usuarios', u.id,
          { ultimo_acceso: new Date().toISOString() }).catch(() => {});
      }
    } else if (esMaestra(clave)) {
      quien = { id: 'maestra', nombre: 'Clave maestra', correo: '', rol: 'admin' };
    }

    if (!quien) {
      // Demora fija ante el fallo: hace cara la fuerza bruta sin castigar al
      // que simplemente se equivocó al teclear. Y el mensaje no distingue
      // entre "ese correo no existe" y "la clave está mal".
      return setTimeout(() => res.status(401).json({ error: 'Correo o clave incorrectos' }), 700);
    }

    const sesion = { ...quien, hasta: Date.now() + JORNADA };
    ponerCookie(res, sesion);
    res.json({ ok: true, yo: quien });
  } catch (e) { sig(e); }
});

app.post('/api/salir', (_req, res) => {
  res.setHeader('Set-Cookie', 'pd_panel=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/salud', async (_req, res) => {
  res.json({ ok: true, base: await baseViva() });
});

// ──────────────────────────── permisos ────────────────────────────

app.use('/api', (req, res, siguiente) => {
  const sesion = abrirSesion(leerCookie(req, 'pd_panel'));
  if (!sesion) return res.status(401).json({ error: 'sin sesión' });
  req.yo = sesion;
  siguiente();
});

// Un lector mira y descarga; no escribe. Se controla por método y no ruta por
// ruta: así una ruta nueva queda protegida sin acordarse de protegerla.
app.use('/api', (req, res, siguiente) => {
  if (req.method !== 'GET' && req.yo.rol === 'lector') {
    return res.status(403).json({ error: 'Tu cuenta es de solo lectura.' });
  }
  siguiente();
});

/** Quién soy: con esto el panel decide qué pestañas y botones muestra. */
app.get('/api/yo', (req, res) => res.json({
  id: req.yo.id, nombre: req.yo.nombre, correo: req.yo.correo, rol: req.yo.rol,
}));

// ──────────────────────────── usuarios ────────────────────────────
//
// Solo un administrador. El panel además esconde la pestaña, pero esconder un
// botón no es un permiso: quien sepa la ruta la llama igual.

app.use('/api/usuarios', (req, res, siguiente) => {
  if (req.yo.rol !== 'admin') {
    return res.status(403).json({ error: 'Solo un administrador gestiona usuarios.' });
  }
  siguiente();
});

const listarUsuarios = () => bd.listar('pd_usuarios', 'select=*&order=activo.desc,nombre');

/**
 * Cuántos administradores activos quedarían si se aplicara este cambio.
 *
 * Es la comprobación que evita el accidente de verdad: quitarse el último
 * admin y dejar la gestión de usuarios cerrada para todos.
 */
async function adminsTras(cambio) {
  const todos = await listarUsuarios();
  return todos.filter((u) => (u.id === cambio.id
    ? cambio.rol === 'admin' && cambio.activo
    : u.rol === 'admin' && u.activo)).length;
}

app.get('/api/usuarios', async (_req, res, sig) => {
  try { res.json((await listarUsuarios()).map(publico)); } catch (e) { sig(e); }
});

app.post('/api/usuarios', async (req, res, sig) => {
  try {
    const fila = filaDesdeFormulario(req.body, { nuevo: true });
    res.json(publico(await bd.crear('pd_usuarios', fila)));
  } catch (e) { sig(e); }
});

app.put('/api/usuarios/:id', async (req, res, sig) => {
  try {
    const antes = await bd.uno('pd_usuarios', req.params.id);
    if (!antes) return res.status(404).json({ error: 'ese usuario no existe' });

    const fila = filaDesdeFormulario(req.body, { nuevo: false });
    if (await adminsTras({ id: antes.id, rol: fila.rol, activo: fila.activo }) === 0) {
      return res.status(409).json({
        error: 'Quedaría sin ningún administrador activo. Nombra otro admin antes de cambiar este.',
      });
    }
    res.json(publico(await bd.actualizar('pd_usuarios', antes.id, fila)));
  } catch (e) { sig(e); }
});

app.delete('/api/usuarios/:id', async (req, res, sig) => {
  try {
    if (req.params.id === req.yo.id) {
      return res.status(409).json({ error: 'No puedes borrar tu propia cuenta.' });
    }
    const u = await bd.uno('pd_usuarios', req.params.id);
    if (!u) return res.status(404).json({ error: 'ese usuario no existe' });
    if (await adminsTras({ id: u.id, rol: null, activo: false }) === 0) {
      return res.status(409).json({
        error: 'Es el último administrador activo. Nombra otro antes de borrarlo.',
      });
    }
    await bd.borrar('pd_usuarios', u.id);
    res.json({ ok: true });
  } catch (e) { sig(e); }
});

// ──────────────────────────── eventos ────────────────────────────

/** Trae el evento con todo lo suyo; es lo que necesita la ficha completa. */
async function eventoCompleto(id) {
  const [evento, presupuesto, movimientos, cobros] = await Promise.all([
    bd.uno('pd_eventos', id),
    bd.listar('pd_presupuesto', `evento_id=eq.${id}&order=orden,concepto`),
    bd.listar('pd_movimientos', `evento_id=eq.${id}&order=fecha.desc`),
    bd.listar('pd_cobros', `evento_id=eq.${id}&order=vence`),
  ]);
  if (!evento) return null;
  const datos = { evento, presupuesto, movimientos, cobros };
  return { ...datos, resumen: resumen(datos), categorias: porCategoria(datos, 'gasto') };
}

app.get('/api/eventos', async (_req, res, sig) => {
  try {
    const eventos = await bd.listar('pd_eventos', 'select=*&order=fecha.desc.nullslast,creado.desc');
    // Una pasada por tabla en vez de una por evento: con 50 eventos, lo otro
    // son 150 viajes a la base.
    const [pres, movs, cobs] = await Promise.all([
      bd.listar('pd_presupuesto', 'select=evento_id,tipo,cantidad,dias,valor_unitario'),
      bd.listar('pd_movimientos', 'select=evento_id,tipo,valor'),
      bd.listar('pd_cobros', 'select=evento_id,valor,pagado,vence'),
    ]);
    const por = (filas) => filas.reduce((m, f) => {
      (m[f.evento_id] ||= []).push(f); return m;
    }, {});
    const [p, m, c] = [por(pres), por(movs), por(cobs)];
    res.json(eventos.map((evento) => ({
      ...evento,
      resumen: resumen({
        presupuesto: p[evento.id] || [], movimientos: m[evento.id] || [], cobros: c[evento.id] || [],
      }),
    })));
  } catch (e) { sig(e); }
});

app.get('/api/eventos/:id', async (req, res, sig) => {
  try {
    const todo = await eventoCompleto(req.params.id);
    todo ? res.json(todo) : res.status(404).json({ error: 'ese evento no existe' });
  } catch (e) { sig(e); }
});

app.post('/api/eventos', async (req, res, sig) => {
  try { res.json(await bd.crear('pd_eventos', req.body)); } catch (e) { sig(e); }
});

app.put('/api/eventos/:id', async (req, res, sig) => {
  try {
    res.json(await bd.actualizar('pd_eventos', req.params.id,
      { ...req.body, actualizado: new Date().toISOString() }));
  } catch (e) { sig(e); }
});

app.delete('/api/eventos/:id', async (req, res, sig) => {
  try { await bd.borrar('pd_eventos', req.params.id); res.json({ ok: true }); } catch (e) { sig(e); }
});

// ────────────── líneas, movimientos y cobros: mismo trato ──────────────

const TABLAS = {
  presupuesto: 'pd_presupuesto',
  movimientos: 'pd_movimientos',
  cobros: 'pd_cobros',
};

app.post('/api/:cosa(presupuesto|movimientos|cobros)', async (req, res, sig) => {
  try { res.json(await bd.crear(TABLAS[req.params.cosa], req.body)); } catch (e) { sig(e); }
});

app.put('/api/:cosa(presupuesto|movimientos|cobros)/:id', async (req, res, sig) => {
  try { res.json(await bd.actualizar(TABLAS[req.params.cosa], req.params.id, req.body)); }
  catch (e) { sig(e); }
});

app.delete('/api/:cosa(presupuesto|movimientos|cobros)/:id', async (req, res, sig) => {
  try { await bd.borrar(TABLAS[req.params.cosa], req.params.id); res.json({ ok: true }); }
  catch (e) { sig(e); }
});

// ───────────────────────────── Excel ─────────────────────────────

const nombreArchivo = (s) =>
  String(s || 'evento').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();

app.get('/api/eventos/:id/excel', async (req, res, sig) => {
  try {
    const todo = await eventoCompleto(req.params.id);
    if (!todo) return res.status(404).json({ error: 'ese evento no existe' });
    const buffer = await exportarEvento(todo);
    res.setHeader('Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',
      `attachment; filename="${nombreArchivo(todo.evento.nombre)}.xlsx"`);
    res.send(buffer);
  } catch (e) { sig(e); }
});

app.get('/api/excel', async (_req, res, sig) => {
  try {
    const eventos = await bd.listar('pd_eventos', 'select=*&order=fecha.desc.nullslast');
    const filas = [];
    for (const e of eventos) {
      const todo = await eventoCompleto(e.id);
      if (todo) filas.push({ evento: todo.evento, resumen: todo.resumen });
    }
    const buffer = await exportarEventos(filas);
    res.setHeader('Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="eventos-persistencia.xlsx"');
    res.send(buffer);
  } catch (e) { sig(e); }
});

/**
 * Importa un libro contra un evento.
 *
 * `?reemplazar=1` borra lo que hubiera antes en las hojas que traiga el libro.
 * Sin eso, suma. Por defecto SUMA: borrar es lo irreversible, y un clic
 * distraído no debería vaciar un presupuesto.
 */
app.post('/api/eventos/:id/excel',
  express.raw({ type: '*/*', limit: '20mb' }),
  async (req, res, sig) => {
    try {
      const evento = await bd.uno('pd_eventos', req.params.id);
      if (!evento) return res.status(404).json({ error: 'ese evento no existe' });

      const { presupuesto, movimientos, cobros, avisos } = await importarEvento(req.body);
      const reemplazar = req.query.reemplazar === '1';
      const metidas = {};

      const guardar = async (tabla, filas, clave) => {
        if (!filas) return;                         // hoja ausente: no se toca nada
        if (reemplazar) await bd.borrarPorEvento(tabla, evento.id);
        const conEvento = filas.map((f) => ({ ...f, evento_id: evento.id }));
        await bd.crearVarias(tabla, conEvento);
        metidas[clave] = conEvento.length;
      };

      await guardar('pd_presupuesto', presupuesto, 'presupuesto');
      await guardar('pd_movimientos', movimientos, 'movimientos');
      await guardar('pd_cobros', cobros, 'cobros');

      res.json({ ok: true, metidas, avisos, reemplazo: reemplazar });
    } catch (e) { sig(e); }
  });

// ─────────────────────────── cotizaciones ───────────────────────────

app.get('/api/cotizaciones', async (_req, res, sig) => {
  try {
    res.json(await bd.listar('pd_cotizaciones', 'select=*&order=fecha.desc,creado.desc'));
  } catch (e) { sig(e); }
});

app.get('/api/cotizaciones/nueva', (_req, res) => res.json(COTIZACION_EN_BLANCO));

app.get('/api/cotizaciones/:id', async (req, res, sig) => {
  try {
    const [cot, items] = await Promise.all([
      bd.uno('pd_cotizaciones', req.params.id),
      bd.listar('pd_cotizacion_items', `cotizacion_id=eq.${req.params.id}&order=orden`),
    ]);
    cot ? res.json({ ...cot, items }) : res.status(404).json({ error: 'no existe' });
  } catch (e) { sig(e); }
});

/** Crea o reemplaza: la cotización llega entera con sus ítems. */
async function guardarCotizacion(id, cuerpo) {
  const { items = [], ...cab } = cuerpo;
  const cot = id
    ? await bd.actualizar('pd_cotizaciones', id, cab)
    : await bd.crear('pd_cotizaciones', cab);
  await bd.listar('pd_cotizacion_items', `cotizacion_id=eq.${cot.id}&select=id`)
    .then((v) => Promise.all(v.map((f) => bd.borrar('pd_cotizacion_items', f.id))));
  await bd.crearVarias('pd_cotizacion_items',
    items.map((i, n) => ({ ...i, cotizacion_id: cot.id, orden: n })));
  return cot;
}

app.post('/api/cotizaciones', async (req, res, sig) => {
  try { res.json(await guardarCotizacion(null, req.body)); } catch (e) { sig(e); }
});

app.put('/api/cotizaciones/:id', async (req, res, sig) => {
  try { res.json(await guardarCotizacion(req.params.id, req.body)); } catch (e) { sig(e); }
});

app.delete('/api/cotizaciones/:id', async (req, res, sig) => {
  try { await bd.borrar('pd_cotizaciones', req.params.id); res.json({ ok: true }); }
  catch (e) { sig(e); }
});

/** La propuesta lista para imprimir. Ctrl+P → PDF y se manda. */
app.get('/api/cotizaciones/:id/html', async (req, res, sig) => {
  try {
    const [cot, items] = await Promise.all([
      bd.uno('pd_cotizaciones', req.params.id),
      bd.listar('pd_cotizacion_items', `cotizacion_id=eq.${req.params.id}&order=orden`),
    ]);
    if (!cot) return res.status(404).send('no existe');
    res.type('html').send(cotizacionHTML(cot, items));
  } catch (e) { sig(e); }
});

/**
 * De cotización aprobada a evento con presupuesto.
 *
 * Es el paso que en la práctica se hacía copiando a mano, y donde se perdían
 * los números: lo cotizado entra como el INGRESO proyectado del evento, que es
 * exactamente lo que es.
 */
app.post('/api/cotizaciones/:id/a-evento', async (req, res, sig) => {
  try {
    const [cot, items] = await Promise.all([
      bd.uno('pd_cotizaciones', req.params.id),
      bd.listar('pd_cotizacion_items', `cotizacion_id=eq.${req.params.id}&order=orden`),
    ]);
    if (!cot) return res.status(404).json({ error: 'no existe' });

    const evento = await bd.crear('pd_eventos', {
      nombre: cot.titulo, cliente: cot.cliente, estado: 'confirmado',
      fecha: req.body?.fecha || null,
      fecha_fin: req.body?.fecha_fin || null,
      notas: `Desde la cotización ${cot.numero || cot.id}`,
    });
    await bd.crearVarias('pd_presupuesto', items.map((i, n) => ({
      evento_id: evento.id, tipo: 'ingreso', categoria: 'cotizado',
      concepto: i.concepto, cantidad: i.cantidad, dias: Number(i.dias) || 1,
      valor_unitario: i.valor_unitario, fecha: req.body?.fecha || null,
      nota: i.detalle || null, orden: n,
    })));
    await bd.actualizar('pd_cotizaciones', cot.id, { estado: 'aprobada', evento_id: evento.id });
    res.json({ ok: true, evento });
  } catch (e) { sig(e); }
});

// ──────────────────────────── errores ────────────────────────────
//
// Se devuelve el motivo real. Un "error al guardar" obliga a abrir los logs
// del servidor para saber que faltaba un campo.

app.use((err, _req, res, _sig) => {
  console.error('[panel]', err?.message || err);
  res.status(err?.estado && err.estado < 500 ? err.estado : 500)
    .json({ error: String(err?.message || err).slice(0, 600) });
});

// En producción el panel lo sirve nginx como archivos estáticos; esto es para
// poder levantarlo entero en una sola máquina sin montar nginx:
//   SERVIR_ADMIN=1 node index.js
if (process.env.SERVIR_ADMIN === '1') {
  app.use('/admin', express.static(new URL('../admin', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));
  app.get('/', (_req, res) => res.redirect('/admin/'));
}

app.listen(PUERTO, process.env.SERVIR_ADMIN === '1' ? '0.0.0.0' : '127.0.0.1', () =>
  console.log(`[panel] escuchando en 127.0.0.1:${PUERTO}`));
