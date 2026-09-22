# Cozte

MVP de costeo continuo para PyMEs manufactureras con varios productos, insumos compartidos y gastos de taller repartidos por horas o unidades. La interfaz combina un dashboard, detalle por producto, planilla editable, revisión de impacto, comprobantes, asistente y auditoría.

## Arquitectura

| Capa | Ubicación | Función |
| --- | --- | --- |
| Web y API de producto | `apps/web`, Vercel | Next.js, Clerk, motor de costos, AI SDK 7, rutas privadas y cron. |
| Persistencia | Cloudflare D1 | Empresas, productos, insumos, precios versionados, gastos, decisiones, auditoría y alertas. |
| Archivos | Cloudflare R2 | Comprobantes privados por empresa. |
| Adaptador de datos | `apps/data-bridge`, Cloudflare Worker | Ejecuta consultas D1 firmadas con HMAC desde la API en Vercel; no expone endpoints de negocio. |

El motor de costos es determinístico: un precio compartido se registra una vez y recalcula todos los productos que lo consumen. Los gastos se registran una vez por período activo; el reparto usa horas de producción o unidades de lote. Un dato esencial faltante impide mostrar un costo aparentemente exacto. Cozte entrevista a la empresa con MiniMax M3 mediante AI SDK 7, configura un perfil estructurado y deja los cambios para aprobación; Jev de TypeSafe ayuda a identificar insumos ambiguos. La IA no hace la aritmética financiera.

El perfil de producción registra ubicación, etapas, productos, categorías acordadas, conversión compra/consumo y reparto de gastos mensuales, trimestrales o anuales. Se puede revisar en cualquier momento. Cada confirmación del perfil guarda una versión inmutable con su costeo calculado; cada cambio confirmado de la planilla guarda una foto del costo y los datos usados para cada producto. El historial muestra variación y una explicación inicial de su principal componente.

La planilla permite buscar y filtrar por tipo o categoría editable. Nombres, proveedor, unidad y base de reparto se guardan al salir de la celda; los cambios de unidad o reparto que afectan productos requieren confirmación. Los importes se autoguardan como **borrador privado en D1** y solo cambian los costos vigentes después de revisar el impacto, indicar fuente y fecha, y confirmar.

## Estado de la infraestructura

- Cloudflare **Lightning CloudWave** (`b16b057db473a7ca309e70724394acb6`): D1 `claro-costos-db` creado; migraciones `0001` a `0009` aplicadas remotamente.
- Worker `cozte-d1-bridge` desplegado con `DATA_BRIDGE_SECRET`; la conexión firmada desde Vercel fue verificada. Su URL se utiliza solo desde el servidor de Vercel.
- R2 está habilitado y el bucket privado `cozte-documents` fue creado. Las variables S3 están en Vercel Production; falta verificar una carga autenticada desde la aplicación.
- La aplicación Clerk **Cozte** (`app_3Jf9dlY7bLusslTQ1YTsxlPCbxG`) tiene instancia de producción (`ins_3JfBfzn3opJsD1vzLOLZyZJwexb`), organizaciones habilitadas e ingreso por correo. Las claves de producción están en Vercel; los cinco CNAME requeridos se crearon en Vercel DNS y Clerk verificó DNS, SSL y correo. Google OAuth queda desactivado por decisión del equipo.
- El proyecto Vercel `lightningteam/cozte` importa `main` con Root Directory `apps/web`. `cozte.com` y `www.cozte.com` responden; las rutas privadas exigen sesión.

## Desarrollo local

1. Instala dependencias en `apps/web` y `apps/data-bridge` con `npm ci`.
2. En `apps/data-bridge`, ejecuta `npm run db:local` y `npm run dev`; para pruebas locales, configura `DATA_BRIDGE_SECRET` en `.dev.vars` (mínimo 32 caracteres; no lo subas).
3. En `apps/web`, copia `.env.example` a `.env.local` y configura Clerk, `DATA_BRIDGE_URL` y el mismo secreto. Ejecuta `npm run dev`.
4. Visita `/demo` sin necesidad de D1 o R2. Para app real, activa una organización en Clerk.

Comprobaciones: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build` en `apps/web`; `npm run typecheck`, `npm run deploy:dry`, `npm run smoke` en `apps/data-bridge`. La prueba visual web es `npm run smoke` con el servidor en `localhost:3000`; si Playwright no tiene Chromium instalado, instala su navegador o usa `CHROME_PATH` para apuntar a Chrome.

## Puesta en marcha del proyecto Vercel existente

1. El repositorio y **Root Directory `apps/web`** ya están enlazados. Las variables de `apps/web/.env.example` van en Vercel como secretos, nunca en código.
2. El secreto `DATA_BRIDGE_SECRET` ya está instalado en Cloudflare y Vercel Production y la conexión firmada fue verificada. `DATA_BRIDGE_URL` también está configurada.
3. El primer usuario y su empresa ya ingresaron en producción; se verificaron el dashboard, la membresía en D1 y consultas privadas con respuesta 200. El piloto usa correo con código; Google OAuth no está activado.
4. Verificar una carga autenticada de PDF/imagen pequeña. El token R2 con permiso **Object Read & Write** limitado a `cozte-documents` y las cuatro variables `R2_*` ya están en Vercel Production, pero las variables sensibles no se exportan a pruebas locales.
5. `CRON_SECRET` y `AI_GATEWAY_API_KEY` están configurados en Vercel Production. Cozte exige esta clave explícita, también en desarrollo, para atribuir el consumo al proyecto. Los cron en `apps/web/vercel.json` revisan a diario insumos sin precio y publican/revalorizan cotizaciones cada hora.
6. `FXRATES_API_KEY` es opcional y permite asociar consultas FXRatesAPI a una cuenta propia; el endpoint público funciona sin clave. Añádela solo en Vercel Production y vuelve a desplegar. Verifica el cupo y la frecuencia del plan en el panel del proveedor antes de depender del nivel gratuito.
7. Probar alta de empresa, carga de varios productos, actualización compartida, gastos, chat, archivos y revisión de permisos antes de invitar usuarios. El propietario gestiona el dominio y sus DNS.

## Alcance del piloto y límites

Se implementó el flujo principal de costeo y actualización. El perfil estructurado calcula una estimación vigente; el costo real por lote y el escenario/objetivo aún no tienen captura independiente. Las pérdidas extraordinarias se detectan como brecha de rendimiento, pero no se cuantifican en una cuenta separada; tampoco se calcula capacidad ociosa. La carga de evidencias almacena archivos privados, pero **no extrae automáticamente datos de facturas**; el chat lee un extracto de Excel, no una importación masiva. Las reglas fiscales, integraciones con proveedores y conciliación no están incluidos. La moneda base y los costos en moneda extranjera ya funcionan para las monedas disponibles, pero no hay reglas fiscales ni tipos de cambio oficiales de cada país; VES no aparece en el catálogo actual del proveedor. No usar el resultado como sustituto de contabilidad o asesoría profesional.

El [plan de implementación](PLAN_IMPLEMENTACION_MVP.md) desarrolla producto, hipótesis y evolución. El [mockup HTML](MOCKUPS_UX_MVP.html) conserva la exploración de UX.
