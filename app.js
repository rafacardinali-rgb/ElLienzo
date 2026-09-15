// Lógica del lienzo: pinta la grilla, maneja la selección de un bloque
// (de una o varias unidades, arrastrando) y el modal de compra. Nunca
// escribe directo en la tabla `blocks` — todo lo que cambia estado pasa
// por las Cloudflare Functions (/api/...).

const {
  SUPABASE_URL, SUPABASE_ANON_KEY, SITE_NAME,
  GRID_COLS, GRID_ROWS, PRECIO_CENTRO_CENTS, PRECIO_BORDE_CENTS, MONEDA,
} = window.CONFIG;

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
gridEl.style.setProperty("--cols", GRID_COLS);
gridEl.style.setProperty("--rows", GRID_ROWS);

function formatPrecio(cents) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: MONEDA }).format(cents / 100);
}

// Precio de UNA unidad de grilla según su posición — el centro es el más
// caro (el punto que más se ve de la página) y baja hacia los bordes.
// ESTA FÓRMULA TIENE QUE COINCIDIR EXACTO con precioUnidad() en
// functions/_shared.js — una muestra el precio, la otra es la que cobra.
function precioUnidad(col, row) {
  const centroX = (GRID_COLS - 1) / 2;
  const centroY = (GRID_ROWS - 1) / 2;
  const maxDist = Math.sqrt(centroX ** 2 + centroY ** 2);
  const dist = Math.sqrt((col - centroX) ** 2 + (row - centroY) ** 2);
  const t = maxDist === 0 ? 1 : 1 - dist / maxDist;
  const precio = PRECIO_BORDE_CENTS + (PRECIO_CENTRO_CENTS - PRECIO_BORDE_CENTS) * t;
  return Math.round(precio / 10) * 10;
}

function precioRegion(x, y, w, h) {
  let total = 0;
  for (let row = y; row < y + h; row++) {
    for (let col = x; col < x + w; col++) {
      total += precioUnidad(col, row);
    }
  }
  return Math.round(total / 1000) * 1000;
}

// Notación tipo planilla de cálculo para columnas: A, B, ..., Z, AA, AB...
function letraColumna(col) {
  let n = col + 1;
  let s = "";
  while (n > 0) {
    const resto = (n - 1) % 26;
    s = String.fromCharCode(65 + resto) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function etiquetaBloque(x, y, w = 1, h = 1) {
  const base = `${letraColumna(x)}${y + 1}`;
  return w > 1 || h > 1 ? `${base} (${w}×${h})` : base;
}

document.getElementById("precio-pill").textContent =
  `Desde ${formatPrecio(PRECIO_BORDE_CENTS)} la unidad más chica · el precio depende del tamaño y la ubicación · pago único`;

let bloques = []; // lista de bloques pending/sold, tal como vienen de blocks_public
let ocupadas = new Set(); // "x,y" de cada unidad cubierta por algún bloque

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
    bloques = data || [];
    ocupadas = new Set();
    for (const b of bloques) {
      for (let row = b.y; row < b.y + b.h; row++) {
        for (let col = b.x; col < b.x + b.w; col++) {
          ocupadas.add(`${col},${row}`);
        }
      }
    }
    renderGrid();
    clearLoadError();
  } catch (err) {
    console.error("Error cargando bloques:", err);
    showLoadError("No pudimos cargar los espacios. Reintentando…");
  }
}

function celdaLibre(col, row) {
  if (col < 0 || row < 0 || col >= GRID_COLS || row >= GRID_ROWS) return false;
  return !ocupadas.has(`${col},${row}`);
}

function regionLibre(x, y, w, h) {
  for (let row = y; row < y + h; row++) {
    for (let col = x; col < x + w; col++) {
      if (!celdaLibre(col, row)) return false;
    }
  }
  return true;
}

function renderGrid() {
  gridEl.innerHTML = "";

  // Bloques ocupados (pending/sold): un solo elemento por bloque, spanneado
  // sobre todas las unidades que cubre.
  for (const b of bloques) {
    const cell = document.createElement("div");
    cell.className = "cell " + (b.status === "sold" ? "sold" : "pending");
    cell.style.gridColumn = `${b.x + 1} / span ${b.w}`;
    cell.style.gridRow = `${b.y + 1} / span ${b.h}`;
    const label = etiquetaBloque(b.x, b.y, b.w, b.h);
    if (b.status === "sold") {
      if (b.image_url) {
        const img = document.createElement("img");
        img.src = b.image_url;
        img.alt = b.title || `Bloque ${label}`;
        cell.appendChild(img);
      }
      cell.title = `${label} · ${b.title || ""}`;
      if (b.link_url) {
        cell.addEventListener("click", () => window.open(b.link_url, "_blank", "noopener"));
      }
    } else {
      cell.textContent = b.w * b.h > 3 ? label : "";
      cell.title = `${label} · Alguien está pagando este espacio ahora mismo`;
    }
    gridEl.appendChild(cell);
  }

  // Unidades libres: una celda chica clickeable/arrastrable por cada una.
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      if (!celdaLibre(col, row)) continue;
      const cell = document.createElement("div");
      cell.className = "cell available";
      cell.style.gridColumn = String(col + 1);
      cell.style.gridRow = String(row + 1);
      cell.dataset.col = String(col);
      cell.dataset.row = String(row);
      cell.title = `${etiquetaBloque(col, row)} · Disponible · ${formatPrecio(precioUnidad(col, row))}`;
      gridEl.appendChild(cell);
    }
  }
}

// --- Selección de un rectángulo arrastrando (funciona con mouse y con
// dedo, gracias a Pointer Events) ---
let seleccionando = false;
let inicio = null; // {col, row}
let selEl = null;

function coordenadasDesdeEvento(e) {
  const rect = gridEl.getBoundingClientRect();
  const cellW = rect.width / GRID_COLS;
  const cellH = rect.height / GRID_ROWS;
  const col = Math.min(GRID_COLS - 1, Math.max(0, Math.floor((e.clientX - rect.left) / cellW)));
  const row = Math.min(GRID_ROWS - 1, Math.max(0, Math.floor((e.clientY - rect.top) / cellH)));
  return { col, row };
}

function actualizarSeleccion(actual) {
  const x = Math.min(inicio.col, actual.col);
  const y = Math.min(inicio.row, actual.row);
  const w = Math.abs(actual.col - inicio.col) + 1;
  const h = Math.abs(actual.row - inicio.row) + 1;
  const valida = regionLibre(x, y, w, h);

  if (!selEl) {
    selEl = document.createElement("div");
    selEl.className = "cell selection";
    gridEl.appendChild(selEl);
  }
  selEl.classList.toggle("invalida", !valida);
  selEl.style.gridColumn = `${x + 1} / span ${w}`;
  selEl.style.gridRow = `${y + 1} / span ${h}`;
  selEl.textContent = w * h > 1 ? `${etiquetaBloque(x, y, w, h)}` : "";
  return { x, y, w, h, valida };
}

function terminarSeleccion() {
  seleccionando = false;
  inicio = null;
  if (selEl) {
    selEl.remove();
    selEl = null;
  }
}

gridEl.addEventListener("pointerdown", (e) => {
  const target = e.target.closest(".cell.available");
  if (!target) return;
  e.preventDefault();
  gridEl.setPointerCapture(e.pointerId);
  seleccionando = true;
  inicio = { col: Number(target.dataset.col), row: Number(target.dataset.row) };
  actualizarSeleccion(inicio);
});

gridEl.addEventListener("pointermove", (e) => {
  if (!seleccionando) return;
  actualizarSeleccion(coordenadasDesdeEvento(e));
});

gridEl.addEventListener("pointerup", (e) => {
  if (!seleccionando) return;
  const resultado = actualizarSeleccion(coordenadasDesdeEvento(e));
  terminarSeleccion();
  if (resultado.valida) {
    openModal(resultado);
  }
});

gridEl.addEventListener("pointercancel", terminarSeleccion);

let selectedRegion = null;

function openModal(region) {
  selectedRegion = region;
  const label = etiquetaBloque(region.x, region.y, region.w, region.h);
  const precio = precioRegion(region.x, region.y, region.w, region.h);
  modalCoordsEl.textContent = label;
  modalPrecioEl.textContent = `Precio: ${formatPrecio(precio)} — pago único. Vas a recibir un comprobante que te acredita como dueño del bloque.`;
  formMsgEl.textContent = "";
  formMsgEl.className = "msg";
  formEl.reset();
  overlayEl.classList.add("open");
}

function closeModal() {
  overlayEl.classList.remove("open");
  selectedRegion = null;
}

btnCancelar.addEventListener("click", closeModal);
overlayEl.addEventListener("click", (e) => {
  if (e.target === overlayEl) closeModal();
});

formEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!selectedRegion) return;

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
    const { x, y, w, h } = selectedRegion;
    const ext = file.name.split(".").pop();
    const path = `${x}-${y}-${w}x${h}-${Date.now()}.${ext}`;
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
      body: JSON.stringify({ x, y, w, h, title, link_url, image_url, buyer_email: email }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "No se pudo iniciar el pago.");

    window.location.href = data.init_point;
  } catch (err) {
    console.error(err);
    showFormError(err.message || "Algo salió mal. Probá de nuevo.");
    btnPagar.disabled = false;
    // Alguien pudo habernos ganado de mano el espacio mientras subíamos la
    // imagen — refrescamos para que la grilla se vea al día.
    fetchBlocks();
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
// ?pago=&id=&t=). Si vino con token, ofrecemos el link directo al
// comprobante de propiedad del bloque.
function checkPaymentRedirect() {
  const params = new URLSearchParams(window.location.search);
  const pago = params.get("pago");
  if (!pago) return;

  const id = params.get("id");
  const t = params.get("t");
  const linkComprobante = id && t ? `certificado.html?id=${id}&t=${t}` : null;

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
    banner.textContent = "El pago no se completó. El espacio sigue disponible, podés intentar de nuevo.";
  }
  bannerAreaEl.appendChild(banner);

  // Limpia el query param de la URL sin recargar.
  window.history.replaceState({}, "", window.location.pathname);
}

fetchBlocks();
checkPaymentRedirect();
setInterval(fetchBlocks, 20000); // refresco liviano para que se vea lo que compran otros
