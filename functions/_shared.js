import { createClient } from "@supabase/supabase-js";

// Grilla base y precios por unidad. TIENE que ser IDÉNTICO a config.js del
// frontend — una calcula lo que se muestra en pantalla, esta calcula lo
// que se cobra de verdad — si se cambia acá, hay que cambiarla también del
// otro lado.
export const GRID_COLS = 32;
export const GRID_ROWS = 18;
export const PRECIO_CENTRO_CENTS = 80000; // $800 ARS — la unidad más cara (centro)
export const PRECIO_BORDE_CENTS = 15000; // $150 ARS — la unidad más barata (bordes)

// Precio de UNA unidad de grilla según su posición: el centro de la grilla
// es el más caro (el punto que más se ve de toda la página) y baja de
// forma gradual hacia los bordes/esquinas.
export function precioUnidad(col, row, gridCols = GRID_COLS, gridRows = GRID_ROWS) {
  const centroX = (gridCols - 1) / 2;
  const centroY = (gridRows - 1) / 2;
  const maxDist = Math.sqrt(centroX ** 2 + centroY ** 2);
  const dist = Math.sqrt((col - centroX) ** 2 + (row - centroY) ** 2);
  const t = maxDist === 0 ? 1 : 1 - dist / maxDist; // 1 en el centro, 0 en la esquina
  const precio = PRECIO_BORDE_CENTS + (PRECIO_CENTRO_CENTS - PRECIO_BORDE_CENTS) * t;
  return Math.round(precio / 10) * 10; // redondeo a $0,10 ARS (evita centavos sueltos al sumar)
}

// Precio de un bloque de w×h unidades a partir de (x,y): suma el precio de
// cada unidad individual que ocupa.
export function precioRegion(x, y, w, h, gridCols = GRID_COLS, gridRows = GRID_ROWS) {
  let total = 0;
  for (let row = y; row < y + h; row++) {
    for (let col = x; col < x + w; col++) {
      total += precioUnidad(col, row, gridCols, gridRows);
    }
  }
  return Math.round(total / 1000) * 1000; // redondeo final a $10 ARS
}

// Notación tipo planilla de cálculo para las columnas: A, B, ..., Z, AA,
// AB, ... (estilo Excel) — hace falta pasar de una sola letra porque la
// grilla tiene más de 26 columnas.
export function letraColumna(col) {
  let n = col + 1;
  let s = "";
  while (n > 0) {
    const resto = (n - 1) % 26;
    s = String.fromCharCode(65 + resto) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Etiqueta legible de un bloque: posición de su esquina superior izquierda
// y, si ocupa más de una unidad, el tamaño (ej: "B2" o "B2 (3×2)").
export function etiquetaBloque(x, y, w = 1, h = 1) {
  const base = `${letraColumna(x)}${y + 1}`;
  return w > 1 || h > 1 ? `${base} (${w}×${h})` : base;
}

// Dos rectángulos [x,y,w,h] se solapan si se superponen en ambos ejes.
export function seSolapan(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function getServiceClient(env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Libera (borra) reservas que quedaron 'pending' (alguien empezó a pagar y
// no terminó) hace más de RESERVA_MINUTOS. Como ahora "disponible" es
// simplemente la ausencia de una fila, liberar = borrar la fila, no
// actualizarla. Se llama de arrastre antes de reservar un bloque nuevo —
// así no hace falta infraestructura de cron aparte para el v1.
const RESERVA_MINUTOS = 20;

export async function liberarPendientesVencidos(supabase) {
  const limite = new Date(Date.now() - RESERVA_MINUTOS * 60 * 1000).toISOString();
  await supabase.from("blocks").delete().eq("status", "pending").lt("reserved_at", limite);
}
