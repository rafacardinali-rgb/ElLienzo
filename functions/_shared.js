import { createClient } from "@supabase/supabase-js";

// Precio dinámico por posición: el bloque MÁS CARO es el del centro de la
// grilla (el punto que más se ve de toda la página) y el precio baja de
// forma gradual hacia los bordes/esquinas. Esta fórmula tiene que ser
// IDÉNTICA a la de public/app.js (y public/config.js para las constantes):
// una calcula lo que se muestra en pantalla, esta calcula lo que se cobra
// de verdad — si se cambia acá, hay que cambiarla también del otro lado.
export const GRID_SIZE = 10;
export const PRECIO_CENTRO_CENTS = 500000; // $5.000 ARS — el/los bloque(s) centrales
export const PRECIO_BORDE_CENTS = 150000; // $1.500 ARS — las esquinas

export function precioBloque(row_idx, col_idx, gridSize = GRID_SIZE) {
  const centro = (gridSize - 1) / 2;
  const maxDist = Math.sqrt(2) * centro;
  const dist = Math.sqrt((row_idx - centro) ** 2 + (col_idx - centro) ** 2);
  const t = maxDist === 0 ? 1 : 1 - dist / maxDist; // 1 en el centro, 0 en la esquina
  const precio = PRECIO_BORDE_CENTS + (PRECIO_CENTRO_CENTS - PRECIO_BORDE_CENTS) * t;
  return Math.round(precio / 1000) * 1000; // redondeo a $10 ARS
}

// Notación tipo planilla de cálculo: columnas con letras (A, B, C...),
// filas con números (1, 2, 3...). Ej: fila 1 / columna B → "B2".
export function etiquetaBloque(row_idx, col_idx) {
  const letra = String.fromCharCode(65 + col_idx);
  return `${letra}${row_idx + 1}`;
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

// Libera bloques que quedaron 'pending' (alguien empezó a pagar y no
// terminó) hace más de RESERVA_MINUTOS. Se llama de arrastre antes de
// reservar un bloque nuevo — así no hace falta infraestructura de cron
// aparte para el v1.
const RESERVA_MINUTOS = 20;

export async function liberarPendientesVencidos(supabase) {
  const limite = new Date(Date.now() - RESERVA_MINUTOS * 60 * 1000).toISOString();
  await supabase
    .from("blocks")
    .update({
      status: "available",
      title: null,
      image_url: null,
      link_url: null,
      buyer_email: null,
      price_cents: null,
      mp_preference_id: null,
      manage_token: null,
      reserved_at: null,
    })
    .eq("status", "pending")
    .lt("reserved_at", limite);
}
