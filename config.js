// Configuración pública del sitio.
// SUPABASE_ANON_KEY es seguro de exponer en el cliente: el acceso real está
// controlado por las políticas RLS definidas en supabase/schema.sql.
// Las claves secretas (Service Role, Mercado Pago) NUNCA van acá — esas
// viven como variables de entorno del lado del servidor (ver /functions).

window.CONFIG = {
  SUPABASE_URL: "https://xnrehfjlptzpdwvyrxpr.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhucmVoZmpscHR6cGR3dnlyeHByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxNTkxNjYsImV4cCI6MjEwNDczNTE2Nn0.LD4ExTlSm6V1t3IyRwqtqTsu-7RVQhH8Aj2j-hVb3eg",

  SITE_NAME: "El Lienzo",

  // Grilla base "de unidades" del lienzo. Es la MISMA para todos los
  // visitantes (así el bloque de cualquiera se ve en la misma posición
  // relativa para todo el mundo) — lo que cambia según la pantalla es
  // solo el tamaño en píxeles de cada unidad (vía CSS), no la cantidad.
  // Cada comprador elige un rectángulo de 1x1 unidad para arriba.
  GRID_COLS: 32,
  GRID_ROWS: 18,

  // Precio POR UNIDAD de grilla, según su posición (el centro es más caro
  // que los bordes — es el punto que más se ve de toda la página). El
  // precio de un bloque de varias unidades es la suma del precio de cada
  // unidad que ocupa. Esta MISMA fórmula vive también en
  // functions/_shared.js — si se cambia acá hay que cambiarla ahí también
  // para que lo que se muestra coincida con lo que se cobra de verdad.
  PRECIO_CENTRO_CENTS: 80000, // $800 ARS — la unidad más cara (centro)
  PRECIO_BORDE_CENTS: 15000,  // $150 ARS — la unidad más barata (bordes/esquinas)
  MONEDA: "ARS",
};
