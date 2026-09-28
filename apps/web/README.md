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

Dónde está la empresa (país, ciudad y zona horaria; migración 0028, `lib/locations.ts`) se pide una vez al entrar si falta, es el primero de "Primeros pasos" y se cambia desde el botón de ubicación de la barra superior ("Tu empresa"); Cozte también lo pregunta y lo guarda con `setCompanyLocation`. El país fija el día y la hora de la empresa (`businessTimeZone`, con la moneda solo como respaldo), cómo habla Cozte (vos, tú o usted y palabras locales) y la moneda que se sugiere; no cambia costos. La moneda base de una empresa se elige antes de crear productos, costos o un mapa de producción; después queda bloqueada para evitar reinterpretar importes históricos. Cada insumo y gasto puede estar en otra moneda. El motor convierte con un tipo de cambio fechado y guarda moneda, importe original y tasa usada en las versiones y fotos. El mapa del asistente también admite precios y gastos extranjeros; sus fotos conservan las tasas usadas. `FXRatesAPI` sirve una publicación USD-base para todas las monedas admitidas; D1 coordina una sola consulta por hora para toda la plataforma. Si falla, BCRA permite una cobertura limitada; si tampoco hay una cotización válida, Cozte marca el costeo como incompleto. La fuente comercial es una **referencia de mercado**, no el tipo de cambio oficial de cada país. La precisión interna del piloto redondea los costos base a una unidad monetaria; confirmar importes de centavos solo cuando ese redondeo sea aceptable.

La clave FXRatesAPI es opcional: el endpoint público respondió sin ella en las pruebas. Para atribuir el consumo a tu cuenta, crea la clave en [FXRatesAPI](https://fxratesapi.com/), añádela en Vercel → Cozte → Settings → Environment Variables como `FXRATES_API_KEY` (Production, secreto del servidor) y haz un redeploy. Cozte la enviará como Bearer. Antes de invitar usuarios, verifica en el panel del proveedor que el plan gratuito incluya la resolución de 1 hora y el cupo mensual esperado; la página pública de precios no permitió confirmar esas condiciones de manera inequívoca. Si no las incluye, el sistema conserva la última publicación válida y puede usar BCRA como respaldo limitado.

El chat acepta una imagen PNG/JPEG/WebP de hasta 2 MB o una planilla `.xlsx` de hasta 1 MB. Del Excel se envía al modelo un extracto de la primera hoja (60 filas, 12 columnas, 5.500 caracteres); no se importan todos los datos ni se ejecutan fórmulas. La imagen se envía a MiniMax M3 mediante AI SDK 7. El dictado usa la función de reconocimiento de voz del navegador, cuando existe; reinicia sesiones que el navegador cierra por silencio y solo se detiene al pulsar Pausar. Una onda usa la amplitud real del micrófono mediante Web Audio, sin grabar ni almacenar el audio en Cozte. El texto queda editable antes de enviarlo; se debe pausar antes de enviar para no perder la última frase. Los archivos del chat no se archivan como comprobantes en R2. La sección Comprobantes está retirada del espacio de trabajo por ahora: el componente y la API de documentos siguen en el repositorio para una versión más operativa.

Cada envío al asistente guarda el mensaje antes de abrir el stream y genera un ID de ejecución. En D1, `assistant_runs` y `assistant_run_events` registran configuración efectiva (con `null` para parámetros no fijados, como temperatura/topK), pasos, llamadas y resultados de herramientas, uso de tokens, texto de respuesta, errores y estado final. La traza excluye claves, imágenes en base64 y razonamiento privado del modelo; los archivos se registran como metadatos y las cargas grandes se truncan. `GET /api/assistant/runs` devuelve las últimas 30 ejecuciones del usuario autenticado, y `GET /api/assistant/runs?id=<uuid>` sus eventos; ambas consultas están restringidas a su usuario y empresa. Una ejecución aún en `running` tras 90 segundos aparece como `interrupted`, útil para detectar cortes abruptos de Vercel o del navegador. El ID también figura en `x-cozte-run-id` y en el error de stream. No debe publicarse este endpoint sin autenticación ni copiar sus datos empresariales a logs públicos.

El proyecto `lightningteam/cozte` ya importa este repositorio con **Root Directory `apps/web`**. El propietario administra `cozte.com`. Consulta el README raíz para el estado de los servicios y los pasos pendientes.

## Módulos del negocio

Además del costo de producir, el espacio de trabajo cubre lo que cuesta vender y sostener la empresa:

- **Ventas** (`/app/ventas`): tabla editable y filtrable de las ventas del mes, la más reciente primero (fecha, canal, cliente, producto, cantidad, precio, costo de entrega, nota). Corregir una venta conserva el precio cobrado y el costo de cada producto del día de la venta (`repriceSale`); cambiar el canal recalcula comisión y entrega. También canales de venta y cuánto queda por unidad en cada canal.
- **Entregas** (`/app/entregas`): cada venta que tiene que llegar al cliente tiene su entrega (tabla `deliveries`: fecha, franja, estado, quién recibe, dirección, contacto, quién la lleva, seguimiento, nota). Se crea sola al registrar una venta por un canal que entrega (o con datos de entrega). Tabla editable con filtros rápidos (por entregar, hoy, atrasadas, con problema, entregadas), búsqueda y orden por cercanía a hoy; resumen del día, la semana y el costo del mes. El costo de entregar vive en la venta, así que el resultado del mes sigue cada cambio.
  - **Zonas de entrega** (migración 0030: `delivery_zones`, `deliveries.zone_id`): cada zona es reparto propio, transportista o retiro en el local, con quién lleva los pedidos, los barrios o ciudades que cubre, costo por pedido, días de salida, días desde la venta y, opcionalmente, "todo lo demás" para las direcciones sin otra zona.
  - **Asignación:** cada entrega nueva toma la zona de la dirección del cliente (`matchZone` en `lib/delivery-zones.ts`: la ciudad o el barrio de la dirección, después un lugar nombrado tras la calle y por último la zona de todo lo demás). De la zona salen la forma, quién la lleva, el próximo día de salida (`nextDeliveryDay`) y el costo, salvo que se indiquen. Cambiar la zona de una entrega (o poner una dirección que cae en otra) aplica el costo de esa zona; "Deshacer" lo revierte. Al crear o cambiar una zona, las entregas abiertas sin zona o en la de todo lo demás que caen en ella se suman.
  - **Pantalla:** tarjetas por zona con lo que cubre, dónde hay clientes, cómo les fue en el mes y lo que queda por entregar; los lugares de clientes sin zona se crean con un toque; columna y filtro de zona en la tabla y selector al programar una entrega. El costo del canal queda para las direcciones fuera de zonas con costo propio.
  - **Hoja de ruta** (migración 0032: `deliveries.route_position`, `organizations.route_origin`): las entregas abiertas del día (hoy, mañana o cualquier fecha; hoy suma las atrasadas abiertas) agrupadas por zona (`routeSheet` en `lib/delivery-routes.ts`).
    - **Reparto propio y sin zona:** en orden de manejo sugerido (`suggestRouteOrder`: primero las franjas de la mañana, barrio por barrio; las sin franja se suman donde ya se va a su barrio). Se reordena con flechas y el orden queda guardado en cada entrega (`save-route-order`); volver a "orden sugerido" con un toque. Reprogramar una entrega la saca del orden.
    - **Salida:** links de Google Maps con todas las paradas (`mapsRouteLinks`, tramos de hasta 10 paradas, con el país agregado a cada dirección) desde el punto de partida ("Las rutas salen desde", o desde donde esté el repartidor), texto para WhatsApp y copiar.
    - **Modo repartidor:** una parada a la vez con Cómo llegar, Llamar, "Avisar que voy en camino" por WhatsApp al cliente, Entregada y No se pudo (con motivo).
    - **Transportistas:** lista de despacho con código de seguimiento editable, copiar, WhatsApp, Excel y "marcar como despachadas". Los retiros en el local tienen su lista y las que no se pudieron entregar se reprograman con un toque.
    - **Cozte:** `planRoute` arma la ruta del día (con quién va primero o al final), guarda el orden y devuelve las paradas con los links de Maps. Sin servicio de mapas pago: el orden es una sugerencia que se ajusta.
  - **Cozte:** `saveDeliveryZone`; `readDeliveries` trae las zonas y los lugares sin zona; `updateDelivery` acepta `zone`. La demo reparte en Santiago con moto propia, a regiones con Starken y ofrece retiro en el taller.
- **Clientes** (`/app/clientes`): una ficha por cliente (migración 0029: `customers`, `customer_addresses`, `sales.customer_id`, `deliveries.customer_address_id`) con teléfono, email, notas y direcciones de entrega con su zona (la principal primero).
  - **Alta automática:** se arman solos la primera vez con los nombres ya escritos en ventas y las direcciones de sus entregas, uniendo el mismo nombre escrito distinto (`customersFromHistory`). Después, cada venta busca o crea su cliente por nombre (`resolveCustomer`), cada dirección nueva de una entrega queda en su ficha y una entrega sin dirección usa la principal (`customerAddressFor`).
  - **Lista:** estado (frecuente, activo, nuevo, en riesgo, inactivo, sin compras; `customerStats`), un treemap de quién compra más con la concentración y a quién conviene escribir, y tabla o tarjetas con búsqueda, filtros y Excel.
  - **Ficha:** compras por mes, direcciones, ventas con su entrega, registrar venta, unir duplicados y archivar.
  - **Cozte:** usa `readCustomers` y `saveCustomer`.
  - **Demo:** trae clientes recurrentes en su historia de ejemplo.
- **Proveedores** (`/app/proveedores`): una ficha por proveedor (migración 0031: `suppliers`, `purchases.supplier_id`, `delivery_zones.supplier_id`) con tipo (insumos, envíos, servicios u otro), contacto, teléfono, email y notas.
  - **Alta automática:** se arman solos la primera vez con los nombres escritos en compras, el proveedor habitual de cada insumo y los transportistas de las zonas (`suppliersFromHistory`). Después, cada compra busca o crea su proveedor por nombre (`resolveSupplier`) y cada zona de transportista apunta al suyo; cambiar el proveedor de una compra la vuelve a ligar.
  - **Precios:** el precio por unidad de compra de cada insumo cada vez que se compró con cantidad (`materialPrices`), con el primero, el último y el cambio.
  - **Pantalla:** un treemap de a quién se le compra más (color por tipo), lo que conviene mirar (`supplierInsights`: insumos que subieron o bajaron, insumos con un solo proveedor, concentración), líneas de precio por insumo y proveedor, y tabla o tarjetas con filtros por tipo y Excel. La ficha muestra compras por mes, qué vende con sus precios, las compras y, si lleva pedidos, sus zonas, entregas, puntualidad y costo. Renombrar actualiza sus compras y zonas; se pueden unir duplicados y archivar.
  - **Cozte:** `readSuppliers` y `saveSupplier`.
  - **Demo:** trae compras de insumos desde abril, con el papel subiendo y el anillado bajando.
- **Gastos de la empresa** (`/app/gastos`): gastos mensuales por área (entregas, ventas, administración). Solo los de producción se reparten en el costo de cada unidad; las inversiones se reparten en su vida útil.
- **Compras** (`/app/compras`): compras del día a día clasificadas como insumo (actualiza su precio), gasto del mes, pago de un gasto fijo o inversión, con su comprobante.
- **Resultado del mes** (`/app/resultado`): ventas, lo que dejó cada venta, gastos fijos, compras del mes, parte de las inversiones, resultado y punto de equilibrio.

Ventas, Entregas y Compras comparten el mismo patrón: tabla editable con búsqueda, filtros recordados, encabezado y primera columna fijos, "Deshacer" en cada cambio, historial por registro (quién cambió qué, desde `audit_events`) y "Descargar Excel" (CSV con punto y coma y coma decimal) de lo filtrado; en el celular se ven como tarjetas con un diálogo para editar. Costos de producción también descarga su Excel: el costo por unidad de cada producto (desglosado, con precio, margen y estado) o los conceptos de costo con los filtros aplicados; Resultado del mes descarga su cascada. Los campos de cliente, dirección, quién entrega y proveedor sugieren lo usado antes (`/api/customers`). Las ventas con costo incompleto se pueden completar con el costo de hoy. El Dashboard abre con "Primeros pasos" (hasta completarlos) y "Hoy" (entregas del día, atrasadas y ventas de hoy). La demo edita en memoria con el mismo motor (`lib/demo-store.ts`) y tiene su propio reloj. Las tablas usan las celdas editables y la barra de búsqueda de `components/business/data-table.tsx`; los desplegables de toda la app son `components/ui/dropdown.tsx` (base-ui, misma API que un select nativo: opciones como hijos, `onChange`, `name`/`defaultValue` en formularios) y las fechas y meses son `DatePicker` y `MonthSelect` de `components/ui/date-picker.tsx` (calendario propio con teclado, Hoy/Ayer/Mañana, valores AAAA-MM-DD y AAAA-MM, `name` y `required` en formularios). En el celular, las tablas anchas (canales, lo que queda por unidad, fichas de productos, desglose del lote, gastos por área) pasan a listas y Costos de producción abre en vista Lista. El nombre de la empresa se sincroniza desde la organización de Clerk (`ensureOrganization`, recordado 10 minutos por instancia) y es el que muestran las portadas de las presentaciones, también las guardadas antes. Las fechas de "hoy" son las del negocio (`businessToday`, por la moneda) o las del navegador, nunca UTC.

El motor está en `lib/business.ts` (puro) y la persistencia en `lib/server/business.ts`. Cozte registra canales, compras y ventas (con su entrega), corrige ventas (`updateSale`) y gestiona entregas (`updateDelivery`, `readDeliveries`) con sus herramientas; las imágenes y PDF enviados al chat se guardan en R2 como documentos para adjuntarlos al registro que respaldan, por lo que el despliegue necesita `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID` y `R2_SECRET_ACCESS_KEY`. Sin R2 el chat funciona igual, pero los comprobantes no quedan adjuntos.

## Análisis del negocio

`/app/analisis` muestra el negocio mes a mes (3, 6 o 12 meses) con pestañas Resumen, Ventas, Costos, Gastos y Entregas. `GET /api/analysis/business?months=6` resume cada mes con el mismo motor que las secciones (`summarizeMonth` en `lib/business-analytics.ts`: ventas, lo que costó cada venta, gastos fijos, resultado, canales, productos, días de la semana, compras, gastos por concepto y entregas a tiempo). La demo usa una historia de ejemplo de abril a agosto (`demoHistorySales`). Los gráficos son SVG propios (`components/analysis/charts.tsx`) con la paleta de datos de Cozte (`--data-1…6`, validada para daltonismo en claro y oscuro):
- Un flujo de a dónde va la plata de las ventas y otro por canal, con píldoras de cada mes.
- Barras por mes con el mes elegido resaltado y sparklines en las tarjetas.
- Treemaps de productos y de gastos.
- Un radar de días de la semana contra el mes anterior.
- Líneas de ventas contra gastos fijos y de entregas a tiempo.
- Barras apiladas de compras, de entregas por estado y del costo de entregar por zona.
- Filas por zona o por quién entrega: cuántas entregas, cómo salieron, qué parte llegó a tiempo y el costo de cada una (`byZone` y `byCarrier` de `summarizeMonth`).

Todo responde al pasar el mouse, un clic en cualquier mes enfoca el análisis entero, las leyendas ocultan series y cada gráfico tiene "Ver tabla". El Resumen agrega lo que se destaca del mes en palabras (`analysisInsights`) y el punto de equilibrio; la pestaña Costos (`components/cost-analysis-view.tsx`) usa la misma familia de gráficos:
- Tarjetas por producto con sparkline y barra de qué está hecho el costo; tocar una elige el producto.
- Líneas de costo por unidad.
- Un río de cómo se arma el costo del producto (por tipo, categoría o concepto).
- Un treemap de dónde se va cada peso en el período elegido.
- Barras divergentes de qué explica el cambio.
- Barras del costo total de producción.
- "Costos en una fecha" con la proporción de cada producto.

## Cozte: nivel, tablero y calidad

- Cada persona elige cómo le explica Cozte (Simple, Medio, Avanzado); cambia la profundidad y el vocabulario, nunca las acciones ni la verificación.
- El tablero junto al chat guarda widgets con datos en vivo del mismo motor que las presentaciones (`lib/cozte-widgets.ts`): Tu mes, cifras clave a elección (hasta 4), resultado en cascada, punto de equilibrio, ventas por canal/producto/día, lo que queda por canal, entregas, costo por unidad, desglose de un producto, márgenes, producción, evolución, gastos por área y compras. Cada uno puede seguir el mes en curso o un mes fijo, tener un título propio, ampliarse, reordenarse o mandarse a Cozte como pregunta.
- La persona los agrega desde un catálogo por tema con vista previa en vivo; Cozte los muestra con `showVisual` (con sus cifras y conclusión, que respaldan su respuesta), los fija con `pin: true` y ordena el tablero con `manageBoard` (quitar, mover, renombrar, vaciar). Cozte ve el tablero en su contexto. Fijar cuenta como un guardado para el verificador.
- Mientras un turno corre, nada de lo escrito es definitivo (el verificador o la revisión de calidad pueden retirarlo), así que el chat no muestra borradores: muestra un título animado que sigue la fase del turno (`liveStatus` en `lib/cozte-turn-activity.ts`: pensar, cada herramienta, redactar, revisar, corregir, mejorar), cada fase al menos 0,9 s y con títulos que rotan en las fases largas. Al terminar, la respuesta final se escribe palabra por palabra (`StreamedAnswer` en `components/cozte/live-status.tsx`); las cargadas del historial, con la pestaña en segundo plano o con movimiento reducido aparecen completas. El detalle del trabajo sigue disponible, plegado, durante el turno.
- "Nueva conversación" archiva el chat anterior; costos, registros y notas siguen.
- Tiempo y memoria: cada mensaje es una fila de `assistant_messages` (migración 0027) con la hora en que se escribió; el chat viejo (un solo JSON) y sus archivos se importan solos la primera vez, fechados con `assistant_runs` (`lib/server/cozte-messages.ts`). Cozte lee en cada turno los últimos 30 mensajes (hasta ~60 KB, `modelWindow`); cada mensaje de la persona le llega con "[Escrito el día dd/mm/aaaa hh:mm]" en la hora de la empresa, y el contexto le dice qué día y hora es ahora y cuándo fue el mensaje anterior. Lo más viejo lo busca con `searchConversation` (toda la conversación y las archivadas, sin importar tildes); lo que debe recordar siempre va en sus notas (`saveNote`), que ve en cada turno. Los datos del negocio los lee siempre con sus herramientas.
- El chat carga los últimos 20 mensajes (`GET /api/assistant`) y trae 20 más cada vez que la persona llega arriba (`?before=<id>`), sin mover lo que está leyendo. Cada mensaje muestra su hora (con fecha completa al pasar el mouse) y un separador marca cada día ("Hoy", "Ayer", "Jueves, 25 de septiembre"), en la zona horaria de quien mira.
- Cada turno terminado se puntúa con TypeSafe Jev vía AI Gateway (evento `quality_scored`): responde lo pedido, explica supuestos, enseña, nivel adecuado y claridad. Si encuentra una falla clara (no responde, decidió sin explicar en un turno que guardó algo, nivel inadecuado, poco clara), Cozte reescribe el mensaje final una vez; la versión nueva debe pasar el verificador o vuelve la original. `COZTE_QUALITY=observe` solo puntúa y `off` lo desactiva. Si el turno ya tardó más de `COZTE_QUALITY_MAX_MS` (40 s por defecto) solo se puntúa, sin reescribir; cada turno registra `turn_timing` (duración total, hasta la respuesta y de la revisión). El verificador determinista sigue controlando la verdad (guardados, cifras, identificadores).

## Presentaciones

- Sección `/app/presentaciones`: informes en diapositivas con los datos del negocio. Se crean al instante desde una plantilla (ventas, costos, producción, entregas, resultado) o se le piden a Cozte, que las arma y las itera con `createPresentation`, `editPresentation` (agregar, cambiar, quitar, mover, duplicar, estilo, mes, recalcular, deshacer), `readPresentation` y `sharePresentation`.
- Los gráficos y cifras los calcula el motor (`lib/decks.ts`) y quedan congelados en la presentación; "Actualizar datos" los recalcula. Cozte escribe títulos, conclusiones y notas; si un texto trae montos que el motor no respalda, el resultado de la herramienta lo avisa para que los corrija.
- En una misma edición, los números de diapositiva se refieren a la presentación como estaba antes del cambio.
- Cada cambio guarda la versión anterior (`presentation_versions`, últimas 30) y se puede deshacer.
- Link público `/p/<token>`: sin cuenta, sin notas del presentador, fuera de buscadores; desactivarlo invalida el link. El origen del link sale de `NEXT_PUBLIC_SITE_URL`, o del dominio de producción de Vercel.
- Sistema de diseño en `lib/deck-design.ts`: estructura, cuándo usar cada diseño, qué gráfico responde cada pregunta, estilos, colores con significado y cómo escribir. Lo lee Cozte en sus instrucciones y la persona en "Guía de diseño" del editor. Estilos: Cozte, Noche, Claro y Terracota (`app/deck.css`).
- Presentar a pantalla completa (flechas, deslizar, F) y descargar en PDF (una diapositiva por página).

## Página de inicio

`app/page.tsx` presenta el producto completo (costos, Cozte AI, resultado y análisis, entregas y rutas, clientes y proveedores) con mockups animados en `components/landing/`:
- Usan los mismos componentes que el espacio de trabajo (`ChartCard`, `MonthBars`, `LineChart`, `Treemap`, `Sparkline`, `Stat`, `ZoneModeChip`) y números calculados por el motor sobre la demo (`landing-data.ts`), así que se ven y suman igual que la app.
- Cada escena es una línea de tiempo (`useSceneTime` en `scene.tsx`) que corre solo mientras el mockup está en pantalla, con cursor, conteos, el chat de Cozte trabajando y la ruta recorriéndose. Con "reducir movimiento" queda quieta en un cuadro terminado.
- `?escena=<ms>` congela todas las escenas en ese momento, para capturas y para revisar un cuadro.

## Pendiente

- **Optimización automática de rutas (etapa 4 de logística):** hoy la hoja de ruta sugiere el orden por franja horaria y barrio, sin coordenadas, y Google Maps sigue ese orden sin optimizarlo. Queda para después:
  - Geocodificar las direcciones de clientes una vez y guardarlas (latitud y longitud en `customer_addresses`).
  - Calcular el orden óptimo con una API de rutas paga (Google Routes API con `optimizeWaypointOrder`, Mapbox Optimization u OpenRouteService), respetando franjas horarias y el punto de partida.
  - Usarlo en `planRoute` y en "Usar orden sugerido", con tiempos y kilómetros estimados por parada y de la ruta completa.
  - Mantener el orden actual como respaldo cuando no haya coordenadas o falle el servicio, y medir el costo por consulta antes de activarlo para todas las cuentas.
- **Link público para el repartidor:** hoy el modo repartidor necesita una cuenta; un link sin cuenta (como `/p/<token>` de presentaciones) permitiría marcar entregas desde el celular del repartidor.
- **Proveedor en los insumos al renombrar:** renombrar un proveedor actualiza sus compras y zonas, pero no el campo proveedor de cada insumo en Costos de producción (necesita pasar por una mutación del motor de costos).

