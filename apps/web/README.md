# Cozte web

Aplicación Next.js 16 alojable en Vercel. Toda la API de producto, autenticación, cálculo y consumo de modelos vive aquí. Cloudflare solo conserva los datos (D1 y R2); el Worker `apps/data-bridge` es un adaptador privado y no una API de producto.

Para instalar y probar:

```bash
npm ci
npm run typecheck
npm run lint
npm run test
npm run build
npm run dev
```

La ruta `/` es la landing pública. `/sign-in` y `/sign-up` llevan a la aplicación autenticada en `/app`; `/demo` permite explorar tres productos sin credenciales de datos. La demostración es de solo lectura; sus cambios se simulan localmente.

Para usar datos reales, copia `.env.example` a `.env.local` y configura Clerk, la URL y secreto compartido del puente D1, `AI_GATEWAY_API_KEY` para MiniMax M3 y las credenciales R2 para documentos. No subas `.env.local` al repositorio. Cozte exige una clave explícita de AI Gateway tanto local como en Vercel; no depende de OIDC. El secreto `DATA_BRIDGE_SECRET` debe coincidir con el secreto del Worker; `CRON_SECRET` protege las tareas programadas. El asistente nunca confirma cambios: deja propuestas para revisión humana. El historial conserva fotos inmutables de cada cambio confirmado.

La moneda base de una empresa se elige antes de crear productos, costos o un mapa de producción; después queda bloqueada para evitar reinterpretar importes históricos. Cada insumo y gasto puede estar en otra moneda. El motor convierte con un tipo de cambio fechado y guarda moneda, importe original y tasa usada en las versiones y fotos. El mapa del asistente también admite precios y gastos extranjeros; sus fotos conservan las tasas usadas. `FXRatesAPI` sirve una publicación USD-base para todas las monedas admitidas; D1 coordina una sola consulta por hora para toda la plataforma. Si falla, BCRA permite una cobertura limitada; si tampoco hay una cotización válida, Cozte marca el costeo como incompleto. La fuente comercial es una **referencia de mercado**, no el tipo de cambio oficial de cada país. La precisión interna del piloto redondea los costos base a una unidad monetaria; confirmar importes de centavos solo cuando ese redondeo sea aceptable.

La clave FXRatesAPI es opcional: el endpoint público respondió sin ella en las pruebas. Para atribuir el consumo a tu cuenta, crea la clave en [FXRatesAPI](https://fxratesapi.com/), añádela en Vercel → Cozte → Settings → Environment Variables como `FXRATES_API_KEY` (Production, secreto del servidor) y haz un redeploy. Cozte la enviará como Bearer. Antes de invitar usuarios, verifica en el panel del proveedor que el plan gratuito incluya la resolución de 1 hora y el cupo mensual esperado; la página pública de precios no permitió confirmar esas condiciones de manera inequívoca. Si no las incluye, el sistema conserva la última publicación válida y puede usar BCRA como respaldo limitado.

El chat acepta una imagen PNG/JPEG/WebP de hasta 2 MB o una planilla `.xlsx` de hasta 1 MB. Del Excel se envía al modelo un extracto de la primera hoja (60 filas, 12 columnas, 5.500 caracteres); no se importan todos los datos ni se ejecutan fórmulas. La imagen se envía a MiniMax M3 mediante AI SDK 7. El dictado usa la función de reconocimiento de voz del navegador, cuando existe; reinicia sesiones que el navegador cierra por silencio y solo se detiene al pulsar Pausar. Una onda usa la amplitud real del micrófono mediante Web Audio, sin grabar ni almacenar el audio en Cozte. El texto queda editable antes de enviarlo; se debe pausar antes de enviar para no perder la última frase. Los archivos del chat no se archivan automáticamente como comprobantes en R2; esa carga permanece en la sección Comprobantes.

Cada envío al asistente guarda el mensaje antes de abrir el stream y genera un ID de ejecución. En D1, `assistant_runs` y `assistant_run_events` registran configuración efectiva (con `null` para parámetros no fijados, como temperatura/topK), pasos, llamadas y resultados de herramientas, uso de tokens, texto de respuesta, errores y estado final. La traza excluye claves, imágenes en base64 y razonamiento privado del modelo; los archivos se registran como metadatos y las cargas grandes se truncan. `GET /api/assistant/runs` devuelve las últimas 30 ejecuciones del usuario autenticado, y `GET /api/assistant/runs?id=<uuid>` sus eventos; ambas consultas están restringidas a su usuario y empresa. Una ejecución aún en `running` tras 90 segundos aparece como `interrupted`, útil para detectar cortes abruptos de Vercel o del navegador. El ID también figura en `x-cozte-run-id` y en el error de stream. No debe publicarse este endpoint sin autenticación ni copiar sus datos empresariales a logs públicos.

El proyecto `lightningteam/cozte` ya importa este repositorio con **Root Directory `apps/web`**. El propietario administra `cozte.com`. Consulta el README raíz para el estado de los servicios y los pasos pendientes.
