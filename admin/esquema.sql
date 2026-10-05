-- Presupuestos, ejecución y cotizaciones de eventos de Persistencia Digital.
--
-- Vive en el Supabase de la web (bd.persistenciadigital.com), que ya usa el
-- prefijo `pd_` para sus tablas. Se respeta esa convención.
--
-- RLS ACTIVADO Y SIN POLÍTICAS, a propósito. Las tablas que ya existían en esta
-- instancia (pd_projects y compañía) se leen enteras con la llave anónima —
-- comprobado el 2026-10-05. Aquí hay plata: lo que se cobra, lo que se gasta y
-- lo que falta por cobrar. Con RLS activado y ninguna política, PostgREST no
-- devuelve nada a la llave anónima, y solo el servidor del panel —que usa
-- service_role y salta RLS— puede leer y escribir. La llave maestra nunca baja
-- al navegador.
--
-- Idempotente: se puede correr las veces que haga falta.

-- ───────────────────────────── eventos ─────────────────────────────

create table if not exists pd_eventos (
    id            uuid primary key default gen_random_uuid(),
    nombre        text not null,
    cliente       text,
    sede          text,
    fecha         date,
    -- cotizado → confirmado → en_curso → cerrado, o perdido en cualquier punto
    estado        text not null default 'cotizado',
    moneda        text not null default 'COP',
    notas         text,
    creado        timestamptz not null default now(),
    actualizado   timestamptz not null default now()
);

-- ──────────────────── presupuesto: lo PROYECTADO ────────────────────

create table if not exists pd_presupuesto (
    id             uuid primary key default gen_random_uuid(),
    evento_id      uuid not null references pd_eventos(id) on delete cascade,
    tipo           text not null check (tipo in ('ingreso', 'gasto')),
    categoria      text,
    concepto       text not null,
    cantidad       numeric not null default 1,
    valor_unitario numeric not null default 0,
    proveedor      text,
    nota           text,
    orden          int not null default 0
);

-- El total NO se guarda: se calcula. Un total guardado se desincroniza del
-- día en que alguien corrige la cantidad y olvida el total.

-- ───────────────────── movimientos: lo EJECUTADO ─────────────────────

create table if not exists pd_movimientos (
    id           uuid primary key default gen_random_uuid(),
    evento_id    uuid not null references pd_eventos(id) on delete cascade,
    -- opcional: contra qué línea del presupuesto se imputa. Sin esto también
    -- sirve (entra en "fuera de presupuesto", que es justo lo que hay que ver).
    linea_id     uuid references pd_presupuesto(id) on delete set null,
    tipo         text not null check (tipo in ('ingreso', 'gasto')),
    categoria    text,
    concepto     text not null,
    valor        numeric not null default 0,
    fecha        date not null default current_date,
    proveedor    text,
    comprobante  text,
    nota         text,
    creado       timestamptz not null default now()
);

-- ───────────────────────── cobros: la CARTERA ─────────────────────────

create table if not exists pd_cobros (
    id             uuid primary key default gen_random_uuid(),
    evento_id      uuid not null references pd_eventos(id) on delete cascade,
    concepto       text not null,
    valor          numeric not null default 0,   -- facturado
    pagado         numeric not null default 0,   -- abonado hasta hoy
    fecha_factura  date,
    vence          date,
    fecha_pago     date,
    medio          text,
    nota           text
);

-- ─────────────────────────── cotizaciones ───────────────────────────

create table if not exists pd_cotizaciones (
    id          uuid primary key default gen_random_uuid(),
    -- una cotización puede nacer suelta y amarrarse a un evento después
    evento_id   uuid references pd_eventos(id) on delete set null,
    numero      text,
    cliente     text not null,
    contacto    text,
    titulo      text not null,
    resumen     text,
    -- el cuerpo editable de la propuesta, en bloques
    incluye     jsonb not null default '[]'::jsonb,
    condiciones jsonb not null default '[]'::jsonb,
    -- pasos de pago: [{"pct":50,"cuando":"a la firma"}, ...]
    pagos       jsonb not null default '[]'::jsonb,
    validez_dias int not null default 15,
    estado      text not null default 'borrador',  -- borrador|enviada|aprobada|perdida
    fecha       date not null default current_date,
    creado      timestamptz not null default now()
);

create table if not exists pd_cotizacion_items (
    id             uuid primary key default gen_random_uuid(),
    cotizacion_id  uuid not null references pd_cotizaciones(id) on delete cascade,
    concepto       text not null,
    detalle        text,
    cantidad       numeric not null default 1,
    valor_unitario numeric not null default 0,
    orden          int not null default 0
);

-- ──────────────────────────── índices ────────────────────────────

create index if not exists pd_presupuesto_evento on pd_presupuesto (evento_id);
create index if not exists pd_movimientos_evento on pd_movimientos (evento_id);
create index if not exists pd_cobros_evento      on pd_cobros (evento_id);
create index if not exists pd_coti_items_coti    on pd_cotizacion_items (cotizacion_id);
create index if not exists pd_eventos_fecha      on pd_eventos (fecha desc);

-- ──────────────────────── RLS: todo cerrado ────────────────────────
--
-- Sin políticas. Solo service_role (que salta RLS) ve estas tablas.

alter table pd_eventos          enable row level security;
alter table pd_presupuesto      enable row level security;
alter table pd_movimientos      enable row level security;
alter table pd_cobros           enable row level security;
alter table pd_cotizaciones     enable row level security;
alter table pd_cotizacion_items enable row level security;

revoke all on pd_eventos, pd_presupuesto, pd_movimientos,
              pd_cobros, pd_cotizaciones, pd_cotizacion_items
       from anon;

-- ═══════════════════ 2026-10-05 · fechas, días y usuarios ═══════════════════
--
-- Todo lo de abajo se añadió sobre el esquema ya desplegado. Se usa
-- `add column if not exists` en vez de reescribir las tablas: en producción ya
-- hay datos y un `create table` nuevo los perdería.

-- Un evento puede durar varios días: la fecha de arriba es el primer día.
alter table pd_eventos add column if not exists fecha_fin date;

-- La fecha de una línea NO va dentro del concepto. Escribir «Montaje 14 de
-- marzo» en el texto es lo que obliga después a leer a mano para saber qué se
-- gasta cada día, y no se puede ordenar ni sumar por fecha.
alter table pd_presupuesto add column if not exists fecha date;

-- Días que dura esa línea. El total es cantidad × días × valor unitario: dos
-- pantallas durante tres días son seis días de alquiler, y antes había que
-- hacer esa multiplicación de cabeza y escribir el resultado en la cantidad.
alter table pd_presupuesto      add column if not exists dias numeric not null default 1;
alter table pd_cotizacion_items add column if not exists dias numeric not null default 1;

-- ───────────────────────────── usuarios ─────────────────────────────
--
-- Hasta ahora el panel entraba con una sola clave compartida. Eso no dice
-- quién tocó qué y obliga a cambiársela a todos cuando se va una persona.
--
-- La clave se guarda con scrypt y sal por usuario: lo que hay en la columna no
-- sirve para entrar. CLAVE_ADMIN sigue valiendo como clave maestra —si no
-- siguiera valiendo, un error en esta tabla dejaría a la casa fuera de su
-- propio panel.
--
--   admin  → todo, incluidos los usuarios
--   editor → todo menos los usuarios
--   lector → solo mirar y descargar; no escribe nada

create table if not exists pd_usuarios (
    id            uuid primary key default gen_random_uuid(),
    nombre        text not null,
    correo        text not null unique,
    rol           text not null default 'editor'
                  check (rol in ('admin', 'editor', 'lector')),
    -- scrypt: "s1$N$sal$hash". Nunca sale de esta tabla hacia el navegador.
    clave         text not null,
    activo        boolean not null default true,
    creado        timestamptz not null default now(),
    ultimo_acceso timestamptz
);

alter table pd_usuarios enable row level security;
revoke all on pd_usuarios from anon, authenticated;
