import { getServiceClient, json, etiquetaBloque } from "../_shared.js";

// Mercado Pago llama a esta URL cuando cambia el estado de un pago.
// Soporta tanto el formato viejo (query params: ?topic=payment&id=...)
// como el nuevo (body JSON: { type: "payment", data: { id } }).
export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  let paymentId =
    url.searchParams.get("data.id") ||
    (url.searchParams.get("topic") === "payment" ? url.searchParams.get("id") : null);

  if (!paymentId) {
    try {
      const body = await request.json();
      if (body?.type === "payment" || body?.action?.startsWith("payment.")) {
        paymentId = body?.data?.id;
      }
    } catch {
      // sin body JSON válido, seguimos con lo que haya salido de la URL
    }
  }

  if (!paymentId) {
    // No es una notificación de pago que nos interese (ej. merchant_order).
    return json({ ok: true });
  }

  const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` },
  });

  if (!mpRes.ok) {
    console.error("No se pudo consultar el pago", paymentId, await mpRes.text());
    return json({ ok: true }); // devolvemos 200 igual para que MP no reintente en loop
  }

  const payment = await mpRes.json();
  const blockId = payment.external_reference || payment.metadata?.block_id;
  if (!blockId) return json({ ok: true });

  const supabase = getServiceClient(env);

  if (payment.status === "approved") {
    const { data: block } = await supabase
      .from("blocks")
      .update({
        status: "sold",
        approved: false, // Rafa revisa el contenido antes de que se muestre
        mp_payment_id: String(payment.id),
        sold_at: new Date().toISOString(),
      })
      .eq("id", blockId)
      .eq("status", "pending")
      .select()
      .single();
      // manage_token NO se toca acá: ya se generó en crear-preferencia.js y
      // es el comprobante de propiedad que el comprador ya tiene en su link
      // de retorno / va a recibir por email.

    if (block && env.RESEND_API_KEY) {
      await enviarEmails(env, block);
    }
  } else if (["rejected", "cancelled"].includes(payment.status)) {
    // Como "disponible" ahora es la ausencia de fila, cancelar = borrarla.
    await supabase.from("blocks").delete().eq("id", blockId).eq("status", "pending");
  }
  // Si está "pending" o "in_process" del lado de MP, no tocamos nada:
  // la limpieza de reservas vencidas en _shared.js se encarga si nunca se paga.

  return json({ ok: true });
}

async function enviarEmails(env, block) {
  const base = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
  };

  const siteUrl = (env.SITE_URL || "").replace(/\/$/, "");
  const label = etiquetaBloque(block.x, block.y, block.w, block.h);
  const linkComprobante = block.manage_token
    ? `${siteUrl}/certificado.html?id=${block.id}&t=${block.manage_token}`
    : null;

  // Confirmación al comprador
  await fetch("https://api.resend.com/emails", {
    ...base,
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: block.buyer_email,
      subject: `Tu bloque ${label} fue confirmado`,
      text:
        `¡Gracias por tu compra!\n\n` +
        `Tu bloque ${label} fue pagado y está en revisión — se publica apenas se aprueba ` +
        `el contenido, normalmente en poco tiempo.\n\n` +
        `Título: ${block.title}\nLink: ${block.link_url}\n\n` +
        (linkComprobante
          ? `Este es tu comprobante de propiedad — guardalo, es lo que necesitás si más ` +
            `adelante querés vender o transferir el bloque:\n${linkComprobante}\n`
          : ""),
    }),
  }).catch((e) => console.error("Error enviando email a comprador:", e));

  // Aviso a Rafa para que apruebe
  if (env.ADMIN_EMAIL) {
    await fetch("https://api.resend.com/emails", {
      ...base,
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: env.ADMIN_EMAIL,
        subject: `Nuevo bloque para aprobar (${label})`,
        text:
          `Se vendió un bloque nuevo.\n\n` +
          `Bloque: ${label}\nTítulo: ${block.title}\nLink: ${block.link_url}\nImagen: ${block.image_url}\n` +
          `Comprador: ${block.buyer_email}\nPrecio pagado: ${(block.price_cents / 100).toFixed(2)} ${block.currency}\n\n` +
          `Entrá a Supabase → tabla blocks → poné approved = true en la fila id ${block.id} para publicarlo.`,
      }),
    }).catch((e) => console.error("Error enviando email a admin:", e));
  }
}
