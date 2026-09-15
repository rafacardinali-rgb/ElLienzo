import { getServiceClient, json, etiquetaBloque } from "../_shared.js";

// Devuelve los datos del comprobante de propiedad de un bloque. Requiere el
// manage_token secreto (viene en el link que se manda por email / se
// muestra después de pagar) — sin el token correcto no se puede ver nada.
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const row_idx = Number(url.searchParams.get("r"));
  const col_idx = Number(url.searchParams.get("c"));
  const token = url.searchParams.get("t");

  if (
    !Number.isInteger(row_idx) || !Number.isInteger(col_idx) ||
    row_idx < 0 || row_idx > 9 || col_idx < 0 || col_idx > 9 || !token
  ) {
    return json({ error: "Faltan datos del comprobante." }, 400);
  }

  const supabase = getServiceClient(env);
  const { data: block, error } = await supabase
    .from("blocks")
    .select("row_idx,col_idx,status,title,link_url,image_url,buyer_email,price_cents,currency,sold_at,manage_token")
    .eq("row_idx", row_idx)
    .eq("col_idx", col_idx)
    .single();

  if (error || !block || !block.manage_token || block.manage_token !== token) {
    return json({ error: "Comprobante no encontrado. Revisá el link." }, 404);
  }
  if (block.status !== "sold") {
    return json({ error: "Este bloque todavía no está confirmado como vendido." }, 409);
  }

  return json({
    label: etiquetaBloque(block.row_idx, block.col_idx),
    row_idx: block.row_idx,
    col_idx: block.col_idx,
    title: block.title,
    link_url: block.link_url,
    image_url: block.image_url,
    buyer_email: block.buyer_email,
    price_cents: block.price_cents,
    currency: block.currency,
    sold_at: block.sold_at,
  });
}
