// Configuración pública del sitio.
// SUPABASE_ANON_KEY es seguro de exponer en el cliente: el acceso real está
// controlado por las políticas RLS definidas en supabase/schema.sql.
// Las claves secretas (Service Role, Mercado Pago) NUNCA van acá — esas
// viven como variables de entorno del lado del servidor (ver /functions).

window.CONFIG = {
  SUPABASE_URL: "https://xnrehfjlptzpdwvyrxpr.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhucmVoZmpscHR6cGR3dnlyeHByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxNTkxNjYsImV4cCI6MjEwNDczNTE2Nn0.LD4ExTlSm6V1t3IyRwqtqTsu-7RVQhH8Aj2j-hVb3eg",

  SITE_NAME: "El Lienzo",
  GRID_SIZE: 10, // 10x10 bloques

  // Precio por posición: el bloque más caro es el del centro (el punto que
  // más se ve de toda la página) y baja gradualmente hacia los bordes.
  // Esta MISMA fórmula vive también en functions/_shared.js — si se cambia
  // acá hay que cambiarla ahí también para que lo que se muestra coincida
  // con lo que se cobra de verdad.
  PRECIO_CENTRO_CENTS: 500000, // $5.000 ARS — bloque(s) centrales
  PRECIO_BORDE_CENTS: 150000,  // $1.500 ARS — esquinas
  MONEDA: "ARS",
};
