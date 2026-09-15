import { getServiceClient, json, etiquetaBloque } from "../_shared.js";

// Devuelve los datos del comprobante de propiedad de un bloque. Requiere el
// manage_token secreto (viene en el link que se manda por email / se
// muestra después de pagar) — sin el token correcto no se puede ver nada.
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const token = url.searchParams.get("t");

  if (!id || !token) {
    return json({ error: "Faltan datos del comprobante." }, 400);
  }

  const supabase = getServiceClient(env);
  const { data: block, error } = await supabase
    .from("blocks")
    .select("id,x,y,w,h,status,title,link_url,image_url,buyer_email,price_cents,currency,sold_at,manage_token")
    .eq("id", id)
    .single();

  if (error || !block || !block.manage_token || block.manage_token !== token) {
    return json({ error: "Comprobante no encontrado. Revisá el link." }, 404);
  }
  if (block.status !== "sold") {
    return json({ error: "Este bloque todavía no está confirmado como vendido." }, 409);
  }

  return json({
    id: block.id,
    label: etiquetaBloque(block.x, block.y, block.w, block.h),
    x: block.x,
    y: block.y,
    w: block.w,
    h: block.h,
    title: block.title,
    link_url: block.link_url,
    image_url: block.image_url,
    buyer_email: block.buyer_email,
    price_cents: block.price_cents,
    currency: block.currency,
    sold_at: block.sold_at,
  });
}
