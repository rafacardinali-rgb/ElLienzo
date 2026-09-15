// Lógica del lienzo: pinta la grilla, maneja el modal de compra y dispara
// el flujo de pago. Nunca escribe directo en la tabla `blocks` — todo lo
// que cambia estado pasa por las Cloudflare Functions (/api/...).

const { SUPABASE_URL, SUPABASE_ANON_KEY, SITE_NAME, GRID_SIZE, PRECIO_CENTRO_CENTS, PRECIO_BORDE_CENTS, MONEDA } =
  window.CONFIG;

let sb = null;
try {
  if (!window.supabase) throw new Error("La librería de Supabase no cargó (vendor/supabase.js).");
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (err) {
  console.error("No se pudo inicializar Supabase:", err);
}

const gridEl = document.getElementById("grid");
const overlayEl = document.getElementById("overlay");
const formEl = document.getElementById("form-compra");
const modalCoordsEl = document.getElementById("modal-coords");
const modalPrecioEl = document.getElementById("modal-precio");
const formMsgEl = document.getElementById("form-msg");
const btnPagar = document.getElementById("btn-pagar");
const btnCancelar = document.getElementById("btn-cancelar");
const bannerAreaEl = document.getElementById("banner-area");

document.getElementById("site-title").textContent = SITE_NAME;
document.title = SITE_NAME;

function formatPrecio(cents) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: MONEDA }).format(cents / 100);
}

// Precio por posición: el centro de la grilla es el más caro (el punto que
// más se ve de la página) y baja gradualmente hacia los bordes/esquinas.
// ESTA FÓRMULA TIENE QUE COINCIDIR EXACTO con precioBloque() en
// functions/_shared.js — una muestra el precio, la otra es la que cobra.
function precioBloque(row_idx, col_idx) {
  const centro = (GRID_SIZE - 1) / 2;
  const maxDist = Math.sqrt(2) * centro;
  const dist = Math.sqrt((row_idx - centro) ** 2 + (col_idx - centro) ** 2);
  const t = maxDist === 0 ? 1 : 1 - dist / maxDist;
  const precio = PRECIO_BORDE_CENTS + (PRECIO_CENTRO_CENTS - PRECIO_BORDE_CENTS) * t;
  return Math.round(precio / 1000) * 1000;
}

// Notación tipo planilla de cálculo: columnas con letras (A, B, C...),
// filas con números (1, 2, 3...). Ej: fila idx 1 / columna idx 1 → "B2".
function etiquetaBloque(row_idx, col_idx) {
  const letra = String.fromCharCode(65 + col_idx);
  return `${letra}${row_idx + 1}`;
}

document.getElementById("precio-pill").textContent =
  `Precios desde ${formatPrecio(PRECIO_BORDE_CENTS)} (bordes) hasta ${formatPrecio(PRECIO_CENTRO_CENTS)} (centro) · pago único`;

let blocksById = new Map();
let selectedBlock = null;

let loadErrorBannerEl = null;
function showLoadError(text) {
  if (!loadErrorBannerEl) {
    loadErrorBannerEl = document.createElement("div");
    loadErrorBannerEl.className = "banner error";
    bannerAreaEl.appendChild(loadErrorBannerEl);
  }
  loadErrorBannerEl.textContent = text;
}
function clearLoadError() {
  if (loadErrorBannerEl) {
    loadErrorBannerEl.remove();
    loadErrorBannerEl = null;
  }
}

async function fetchBlocks() {
  if (!sb) {
    showLoadError("No pudimos conectar con el servidor. Probá recargar la página en un rato.");
    return;
  }
  try {
    const { data, error } = await sb.from("blocks_public").select("*");
    if (error) throw error;
    blocksById = new Map(data.map((b) => [`${b.row_idx}-${b.col_idx}`, b]));
    renderGrid();
    clearLoadError();
  } catch (err) {
    console.error("Error cargando bloques:", err);
    showLoadError("No pudimos cargar los precios. Reintentando…");
  }
}

function renderGrid() {
  gridEl.innerHTML = "";

  // Esquina vacía (arriba a la izquierda).
  gridEl.appendChild(document.createElement("div")).className = "corner";

  // Encabezado de columnas: A, B, C...
  for (let c = 0; c < GRID_SIZE; c++) {
    const colHeader = document.createElement("div");
    colHeader.className = "col-header";
    colHeader.textContent = String.fromCharCode(65 + c);
    gridEl.appendChild(colHeader);
  }

  for (let r = 0; r < GRID_SIZE; r++) {
    // Encabezado de fila: 1, 2, 3...
    const rowHeader = document.createElement("div");
    rowHeader.className = "row-header";
    rowHeader.textContent = String(r + 1);
    gridEl.appendChild(rowHeader);

    for (let c = 0; c < GRID_SIZE; c++) {
      const block = blocksById.get(`${r}-${c}`);
      const cell = document.createElement("div");
      cell.className = "cell";
      const label = etiquetaBloque(r, c);

      if (!block || block.status === "available") {
        cell.classList.add("available");
        cell.textContent = "+";
        cell.title = `${label} · Disponible · ${formatPrecio(precioBloque(r, c))}`;
        cell.addEventListener("click", () => openModal(block ?? { row_idx: r, col_idx: c, status: "available" }));
      } else if (block.status === "pending") {
        cell.classList.add("pending");
        cell.textContent = label;
        cell.title = `${label} · Alguien está pagando este bloque ahora mismo`;
      } else if (block.status === "sold") {
        cell.classList.add("sold");
        if (block.image_url) {
          const img = document.createElement("img");
          img.src = block.image_url;
          img.alt = block.title || `Bloque ${label}`;
          cell.appendChild(img);
        }
        cell.title = `${label} · ${block.title || ""}`;
        if (block.link_url) {
          cell.addEventListener("click", () => window.open(block.link_url, "_blank", "noopener"));
        }
      }
      gridEl.appendChild(cell);
    }
  }
}

function openModal(block) {
  selectedBlock = block;
  const label = etiquetaBloque(block.row_idx, block.col_idx);
  const precio = precioBloque(block.row_idx, block.col_idx);
  modalCoordsEl.textContent = label;
  modalPrecioEl.textContent = `Precio: ${formatPrecio(precio)} — pago único. Vas a recibir un comprobante que te acredita como dueño del bloque.`;
  formMsgEl.textContent = "";
  formMsgEl.className = "msg";
  formEl.reset();
  overlayEl.classList.add("open");
}

function closeModal() {
  overlayEl.classList.remove("open");
  selectedBlock = null;
}

btnCancelar.addEventListener("click", closeModal);
overlayEl.addEventListener("click", (e) => {
  if (e.target === overlayEl) closeModal();
});

formEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!selectedBlock) return;

  const title = document.getElementById("title").value.trim();
  const link_url = document.getElementById("link_url").value.trim();
  const email = document.getElementById("email").value.trim();
  const file = document.getElementById("image").files[0];

  if (!file) {
    showFormError("Elegí una imagen.");
    return;
  }

  btnPagar.disabled = true;
  showFormMsg("Subiendo imagen…");

  try {
    const ext = file.name.split(".").pop();
    const path = `${selectedBlock.row_idx}-${selectedBlock.col_idx}-${Date.now()}.${ext}`;
    const { error: uploadError } = await sb.storage
      .from("bloques-imagenes")
      .upload(path, file, { upsert: false });

    if (uploadError) throw new Error(`No se pudo subir la imagen: ${uploadError.message}`);

    const { data: pub } = sb.storage.from("bloques-imagenes").getPublicUrl(path);
    const image_url = pub.publicUrl;

    showFormMsg("Creando el pago…");

    const res = await fetch("/api/crear-preferencia", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        row_idx: selectedBlock.row_idx,
        col_idx: selectedBlock.col_idx,
        title,
        link_url,
        image_url,
        buyer_email: email,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "No se pudo iniciar el pago.");

    window.location.href = data.init_point;
  } catch (err) {
    console.error(err);
    showFormError(err.message || "Algo salió mal. Probá de nuevo.");
    btnPagar.disabled = false;
  }
});

function showFormMsg(text) {
  formMsgEl.textContent = text;
  formMsgEl.className = "msg";
}
function showFormError(text) {
  formMsgEl.textContent = text;
  formMsgEl.className = "msg error";
}

// Mensaje según el resultado del pago (Mercado Pago redirige acá con
// ?pago=&r=&c=&t=). Si vino con token, ofrecemos el link directo al
// comprobante de propiedad del bloque.
function checkPaymentRedirect() {
  const params = new URLSearchParams(window.location.search);
  const pago = params.get("pago");
  if (!pago) return;

  const r = params.get("r");
  const c = params.get("c");
  const t = params.get("t");
  const linkComprobante = r !== null && c !== null && t ? `certificado.html?r=${r}&c=${c}&t=${t}` : null;

  const banner = document.createElement("div");
  banner.className = "banner";
  if (pago === "success") {
    banner.innerHTML =
      "¡Listo! Tu pago se está confirmando — el bloque va a aparecer publicado en cuanto se apruebe " +
      "(puede tardar unos minutos)." +
      (linkComprobante
        ? ` Guardá tu <a href="${linkComprobante}">comprobante de propiedad</a> — también te lo mandamos por email.`
        : "");
  } else if (pago === "pending") {
    banner.textContent = "Tu pago está pendiente de confirmación. Te va a llegar un email cuando se acredite, con tu comprobante de propiedad.";
  } else {
    banner.className = "banner error";
    banner.textContent = "El pago no se completó. El bloque sigue disponible, podés intentar de nuevo.";
  }
  bannerAreaEl.appendChild(banner);

  // Limpia el query param de la URL sin recargar.
  window.history.replaceState({}, "", window.location.pathname);
}

fetchBlocks();
checkPaymentRedirect();
setInterval(fetchBlocks, 20000); // refresco liviano para que se vea lo que compran otros
