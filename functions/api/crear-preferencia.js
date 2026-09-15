import {
  getServiceClient,
  json,
  precioRegion,
  etiquetaBloque,
  seSolapan,
  liberarPendientesVencidos,
  GRID_COLS,
  GRID_ROWS,
} from "../_shared.js";

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "JSON inválido." }, 400);
  }

  const { x, y, w, h, title, link_url, image_url, buyer_email } = body ?? {};

  // --- Validaciones básicas del lado del servidor ---
  if (
    !Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(w) || !Number.isInteger(h) ||
    x < 0 || y < 0 || w < 1 || h < 1 || x + w > GRID_COLS || y + h > GRID_ROWS
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

  // Chequeo optimista de solapamiento (además del constraint de la base,
  // que es el que de verdad evita una doble venta si dos personas
  // reservan al mismo tiempo).
  const { data: existentes } = await supabase
    .from("blocks")
    .select("x,y,w,h")
    .in("status", ["pending", "sold"]);

  const nueva = { x, y, w, h };
  if ((existentes || []).some((b) => seSolapan(b, nueva))) {
    return json({ error: "Ese espacio ya no está disponible. Elegí otro." }, 409);
  }

  const precio = precioRegion(x, y, w, h);
  const label = etiquetaBloque(x, y, w, h);
  // Token secreto de gestión: funciona como comprobante de propiedad del
  // bloque (se manda por link/email) y habilita transferirlo más adelante.
  const manageToken = crypto.randomUUID();

  const { data: creado, error: insertError } = await supabase
    .from("blocks")
    .insert({
      x, y, w, h,
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
    .select()
    .single();

  if (insertError || !creado) {
    // El constraint de exclusión de la base (blocks_no_overlap) devuelve
    // un error acá si otra persona reservó el mismo espacio justo antes.
    return json({ error: "Ese espacio ya no está disponible. Elegí otro." }, 409);
  }

  // --- Crear preferencia de pago en Mercado Pago ---
  const siteUrl = env.SITE_URL.replace(/\/$/, "");
  const volverConToken = (estado) =>
    `${siteUrl}/?pago=${estado}&id=${creado.id}&t=${manageToken}`;

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
      external_reference: creado.id,
      metadata: { block_id: creado.id },
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
    // Revertimos la reserva para no dejar el espacio trabado.
    await supabase.from("blocks").delete().eq("id", creado.id);
    return json({ error: "No se pudo iniciar el pago. Probá de nuevo en un momento." }, 502);
  }

  const preference = await mpRes.json();

  await supabase
    .from("blocks")
    .update({ mp_preference_id: preference.id })
    .eq("id", creado.id);

  return json({ init_point: preference.init_point });
}
