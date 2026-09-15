import {
  getServiceClient,
  json,
  precioBloque,
  etiquetaBloque,
  liberarPendientesVencidos,
} from "../_shared.js";

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "JSON inválido." }, 400);
  }

  const { row_idx, col_idx, title, link_url, image_url, buyer_email } = body ?? {};

  // --- Validaciones básicas del lado del servidor ---
  if (
    !Number.isInteger(row_idx) || !Number.isInteger(col_idx) ||
    row_idx < 0 || row_idx > 9 || col_idx < 0 || col_idx > 9
  ) {
    return json({ error: "Coordenadas de bloque inválidas." }, 400);
  }
  if (!title || typeof title !== "string" || title.trim().length === 0 || title.length > 60) {
    return json({ error: "Título inválido (máx 60 caracteres)." }, 400);
  }
  if (!link_url || !/^https?:\/\//i.test(link_url)) {
    return json({ error: "El link tiene que empezar con http:// o https://" }, 400);
  }
  if (!buyer_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyer_email)) {
    return json({ error: "Email inválido." }, 400);
  }
  if (!image_url || !image_url.startsWith(env.SUPABASE_URL)) {
    return json({ error: "La imagen tiene que subirse primero al storage del sitio." }, 400);
  }

  const supabase = getServiceClient(env);

  // Limpieza de reservas vencidas antes de intentar tomar una nueva.
  await liberarPendientesVencidos(supabase);

  const precio = precioBloque(row_idx, col_idx);
  const label = etiquetaBloque(row_idx, col_idx);
  // Token secreto de gestión: funciona como comprobante de propiedad del
  // bloque (se manda por link/email) y habilita transferirlo más adelante.
  const manageToken = crypto.randomUUID();

  // Reserva atómica: solo pasa a 'pending' si seguía 'available'.
  const { data: updated, error: updateError } = await supabase
    .from("blocks")
    .update({
      status: "pending",
      title: title.trim(),
      link_url,
      image_url,
      buyer_email,
      price_cents: precio,
      currency: "ARS",
      manage_token: manageToken,
      reserved_at: new Date().toISOString(),
    })
    .eq("row_idx", row_idx)
    .eq("col_idx", col_idx)
    .eq("status", "available")
    .select()
    .single();

  if (updateError || !updated) {
    return json({ error: "Ese bloque ya no está disponible. Elegí otro." }, 409);
  }

  // --- Crear preferencia de pago en Mercado Pago ---
  const siteUrl = env.SITE_URL.replace(/\/$/, "");
  const volverConToken = (estado) =>
    `${siteUrl}/?pago=${estado}&r=${row_idx}&c=${col_idx}&t=${manageToken}`;

  const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      items: [
        {
          title: `Bloque ${label} — ${title.trim()}`,
          quantity: 1,
          unit_price: precio / 100,
          currency_id: "ARS",
        },
      ],
      payer: { email: buyer_email },
      external_reference: updated.id,
      metadata: { block_id: updated.id },
      notification_url: `${siteUrl}/api/webhook-mp`,
      back_urls: {
        success: volverConToken("success"),
        pending: volverConToken("pending"),
        failure: volverConToken("failure"),
      },
      auto_return: "approved",
    }),
  });

  if (!mpRes.ok) {
    const detalle = await mpRes.text();
    console.error("Error creando preferencia MP:", detalle);
    // Revertimos la reserva para no dejar el bloque trabado.
    await supabase
      .from("blocks")
      .update({
        status: "available", title: null, link_url: null, image_url: null,
        buyer_email: null, price_cents: null, manage_token: null, reserved_at: null,
      })
      .eq("id", updated.id);
    return json({ error: "No se pudo iniciar el pago. Probá de nuevo en un momento." }, 502);
  }

  const preference = await mpRes.json();

  await supabase
    .from("blocks")
    .update({ mp_preference_id: preference.id })
    .eq("id", updated.id);

  return json({ init_point: preference.init_point });
}
