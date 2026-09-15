import { getServiceClient, json, etiquetaBloque } from "../_shared.js";

// Transferencia / reventa de un bloque. El "dueño" es quien tiene el
// manage_token (el comprobante) — no hace falta login, el token secreto
// hace de prueba de propiedad. Al transferir se emite un token nuevo y el
// anterior queda inválido, así el vínculo de propiedad pasa entero al
// nuevo dueño (el vendedor deja de poder gestionarlo).
export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "JSON inválido." }, 400);
  }

  const { row_idx, col_idx, manage_token, new_email, new_title, new_link_url } = body ?? {};

  if (
    !Number.isInteger(row_idx) || !Number.isInteger(col_idx) ||
    row_idx < 0 || row_idx > 9 || col_idx < 0 || col_idx > 9 || !manage_token
  ) {
    return json({ error: "Faltan datos del comprobante." }, 400);
  }
  if (!new_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(new_email)) {
    return json({ error: "Email del nuevo dueño inválido." }, 400);
  }
  if (new_title && (typeof new_title !== "string" || new_title.length > 60)) {
    return json({ error: "Título inválido (máx 60 caracteres)." }, 400);
  }
  if (new_link_url && !/^https?:\/\//i.test(new_link_url)) {
    return json({ error: "El link tiene que empezar con http:// o https://" }, 400);
  }

  const supabase = getServiceClient(env);

  const { data: block, error: fetchError } = await supabase
    .from("blocks")
    .select("*")
    .eq("row_idx", row_idx)
    .eq("col_idx", col_idx)
    .single();

  if (fetchError || !block || block.status !== "sold" || block.manage_token !== manage_token) {
    return json({ error: "Comprobante inválido. No se puede transferir este bloque." }, 403);
  }

  const nuevoTitulo = new_title && new_title.trim() ? new_title.trim() : block.title;
  const nuevoLink = new_link_url || block.link_url;
  const contentChanged = nuevoTitulo !== block.title || nuevoLink !== block.link_url;
  const nuevoToken = crypto.randomUUID();

  const { data: updated, error: updateError } = await supabase
    .from("blocks")
    .update({
      buyer_email: new_email,
      title: nuevoTitulo,
      link_url: nuevoLink,
      manage_token: nuevoToken,
      approved: contentChanged ? false : block.approved,
    })
    .eq("id", block.id)
    .eq("manage_token", manage_token) // evita una doble transferencia simultánea con el mismo token
    .select()
    .single();

  if (updateError || !updated) {
    return json({ error: "No se pudo completar la transferencia. Probá de nuevo." }, 409);
  }

  const label = etiquetaBloque(row_idx, col_idx);

  if (env.RESEND_API_KEY && env.ADMIN_EMAIL) {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: env.ADMIN_EMAIL,
        subject: `Bloque ${label} transferido`,
        text:
          `El bloque ${label} cambió de dueño.\nNuevo email: ${new_email}` +
          (contentChanged
            ? `\n\nEl título o el link cambiaron — queda pendiente de aprobación de nuevo.`
            : ""),
      }),
    }).catch((e) => console.error("Error avisando transferencia:", e));
  }

  return json({
    ok: true,
    label,
    manage_token: nuevoToken,
    pendiente_de_aprobacion: contentChanged,
  });
}
