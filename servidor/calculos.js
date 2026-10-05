// Las cuentas de un evento.
//
// Todo se calcula aquí y nada se guarda calculado. Un total guardado es un
// total que miente el día en que alguien corrige una cantidad y olvida el
// total — y en un presupuesto esa mentira se firma.

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export const totalLinea = (l) => num(l.cantidad) * num(l.valor_unitario);

/**
 * El resumen de un evento: lo proyectado, lo ejecutado, la desviación y la
 * cartera.
 *
 * La desviación se mira en GASTO con signo operativo: positiva significa que
 * se gastó MÁS de lo presupuestado, que es la que duele. En ingreso es al
 * revés, así que se nombra distinto para que nadie las sume por error.
 */
export function resumen({ presupuesto = [], movimientos = [], cobros = [] }) {
  const sumaPres = (tipo) =>
    presupuesto.filter((l) => l.tipo === tipo).reduce((t, l) => t + totalLinea(l), 0);
  const sumaMov = (tipo) =>
    movimientos.filter((m) => m.tipo === tipo).reduce((t, m) => t + num(m.valor), 0);

  const ingresoPlan = sumaPres('ingreso');
  const gastoPlan = sumaPres('gasto');
  const ingresoReal = sumaMov('ingreso');
  const gastoReal = sumaMov('gasto');

  const facturado = cobros.reduce((t, c) => t + num(c.valor), 0);
  const pagado = cobros.reduce((t, c) => t + num(c.pagado), 0);

  const hoy = new Date().toISOString().slice(0, 10);
  const vencido = cobros
    .filter((c) => c.vence && c.vence < hoy && num(c.pagado) < num(c.valor))
    .reduce((t, c) => t + (num(c.valor) - num(c.pagado)), 0);

  const utilidadPlan = ingresoPlan - gastoPlan;
  const utilidadReal = ingresoReal - gastoReal;

  return {
    ingresoPlan,
    gastoPlan,
    utilidadPlan,
    margenPlan: ingresoPlan ? utilidadPlan / ingresoPlan : 0,

    ingresoReal,
    gastoReal,
    utilidadReal,
    margenReal: ingresoReal ? utilidadReal / ingresoReal : 0,

    // lo que de verdad se quiere ver de un vistazo
    sobrecosto: gastoReal - gastoPlan,
    ingresoFaltante: ingresoPlan - ingresoReal,
    utilidadDiferencia: utilidadReal - utilidadPlan,

    facturado,
    pagado,
    porCobrar: facturado - pagado,
    vencido,
  };
}

/**
 * Presupuestado contra ejecutado, categoría por categoría.
 *
 * Incluye las categorías que SOLO aparecen en el gasto real: eso es el gasto
 * que nadie presupuestó, y es justo lo que hay que poder ver.
 */
export function porCategoria({ presupuesto = [], movimientos = [] }, tipo = 'gasto') {
  const mapa = new Map();
  const tomar = (cat) => {
    const c = (cat || 'sin categoría').trim() || 'sin categoría';
    if (!mapa.has(c)) mapa.set(c, { categoria: c, plan: 0, real: 0 });
    return mapa.get(c);
  };

  presupuesto.filter((l) => l.tipo === tipo).forEach((l) => {
    tomar(l.categoria).plan += totalLinea(l);
  });
  movimientos.filter((m) => m.tipo === tipo).forEach((m) => {
    tomar(m.categoria).real += num(m.valor);
  });

  return [...mapa.values()]
    .map((f) => ({ ...f, desviacion: f.real - f.plan, sinPresupuestar: f.plan === 0 && f.real > 0 }))
    .sort((a, b) => b.real - a.real || b.plan - a.plan);
}

/** Pesos colombianos como se escriben aquí: sin decimales, con punto de miles. */
export const pesos = (v) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
    .format(num(v));
