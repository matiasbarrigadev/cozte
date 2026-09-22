# Cozte — plan de implementación del MVP de costeo continuo

**Versión:** 1.5 — 22 de septiembre de 2026
**Estado:** plan de trabajo para revisión del equipo
**Marca y dominio:** Cozte · cozte.com, conectado a Vercel.
**Infraestructura base:** Vercel y Cloudflare
**Capa de modelos:** Vercel AI SDK 7 y AI Gateway con clave explícita; MiniMax M3 para la entrevista y Jev de TypeSafe AI para juicios de identificación acotados.

**Decisión vigente de producto:** Cozte entrevista y reevalúa el proceso continuamente, sin etapas cerradas. La persona puede informar cambios de fabricación en cualquier momento. El alcance termina en el producto apto, empacado y listo para despacho. Cada cambio confirmado genera una foto inmutable de datos, reglas y costo calculado; el historial compara fotos y no recalcula el pasado con criterios actuales. Una foto es un snapshot de datos, no una captura visual de pantalla.

## 1. Resumen ejecutivo

Construiremos una aplicación para pequeñas manufactureras que elaboran **productos físicos repetibles**, compran insumos a distintos proveedores y producen por lotes. El producto las ayudará a reconstruir el costo de fabricación, detectar datos faltantes o vencidos y entender el efecto de cada cambio sobre el margen y el precio.

El usuario comenzará con un producto para aprender el flujo y añadirá **dos o más variantes/productos** antes de cerrar el costeo inicial. Los insumos tendrán un catálogo común a la empresa; cada producto definirá su propio consumo, rendimiento, trabajo y precio de venta. Los gastos del taller que benefician a varios productos se registrarán una vez por período y se distribuirán mediante criterios explícitos. El dashboard mostrará los costos de todos los productos y las dependencias compartidas.

La promesa del MVP es concreta:

> Conocer el costo de cada producto, entender qué insumos y gastos comparten, y actualizar todos los productos afectados por un cambio sin rehacer varias planillas.

El MVP no pretende reemplazar un ERP, un sistema contable ni el criterio de un profesional. Su función inicial es mantener **viva y verificable la economía de cada producto**.

## 2. Cliente inicial y límites del problema

### Perfil de cliente piloto

- Empresa pequeña con producción propia o tercerizada parcialmente.
- Producto relativamente estandarizado, fabricado en lotes o series cortas.
- Dos o más productos o variantes con materiales o gastos de producción compartidos, aunque sus consumos y rendimientos difieran.
- Compras a varios proveedores, con unidades de compra distintas de las unidades consumidas.
- Costeo actual en planillas, cuadernos, memoria o mediante trabajo manual de un asesor.
- Decisiones recurrentes de precio, compra, volumen, canal o mezcla de productos.

Podrían participar fabricantes de cosmética, productos de limpieza, textiles estandarizados o alimentos elaborados. **El criterio de selección será la similitud del proceso de costeo**, no la pertenencia a un rubro. Para la primera cohorte conviene evitar empresas cuyos productos se diseñan de cero para cada pedido.

### Problema a validar

La hipótesis es que estas empresas venden o cotizan con costos incompletos o desactualizados porque reunir datos, convertir unidades, asignar trabajo y gastos, y repetir el cálculo requiere un esfuerzo que no logran sostener. Debemos comprobarlo con registros y decisiones reales, no solo con entrevistas sobre interés.

### Resultado observable

El usuario termina el primer recorrido con:

1. Un dashboard de productos con costo, precio, margen y estado de datos por producto.
2. Un desglose trazable por producto y un catálogo de insumos reutilizados con sus productos dependientes.
3. Gastos compartidos del período, regla de asignación y participación de cada producto sin doble cómputo.
4. Costos variables y costo completo estimado, claramente diferenciados cuando la clasificación lo permita.
5. Lista de datos confirmados, estimados, faltantes y desactualizados, con fuente, fecha y unidad.

La segunda prueba de valor ocurre cuando cambia el precio de un insumo compartido y el usuario ve, revisa y confirma el impacto en varios productos sin asistencia intensiva del equipo.

## 3. Decisiones de producto para la primera versión

| Decisión | Alcance del MVP | Motivo |
| --- | --- | --- |
| Unidad inicial | Onboarding progresivo: un producto primero y al menos dos variantes/productos adicionales en el piloto; la estructura admite más sin duplicar insumos | Valida el caso real de costos compartidos y el impacto transversal de una actualización. |
| Datos comunes | Catálogo de insumos y precios por empresa; gastos compartidos por período, con regla de reparto visible | Una fuente de verdad, varios productos dependientes y ninguna erogación duplicada. |
| Tipo de producción | Lotes o series repetibles | Comparte una lógica de materiales, rendimiento y costo unitario. |
| Datos de entrada | Planilla web editable para insumos, precios y gastos; carga guiada, archivos de evidencia y extracción asistida de comprobantes simples | Aprovecha el hábito de trabajo en hojas de cálculo sin duplicar datos entre productos. |
| IA | AI SDK 7 para todas las llamadas; Jev para decisiones semánticas acotadas y un modelo generativo para lectura/explicación cuando haga falta | Reduce trabajo cognitivo sin delegar a modelos el cálculo financiero ni la aprobación de datos. |
| Cálculo | Motor determinístico, versionado y probado | Cada resultado debe poder auditarse. |
| Actualización | En celdas de la planilla o por chat, siempre como borrador; impacto previo en todos los productos dependientes y alertas de vigencia | Prueba el hábito sin depender de integraciones con proveedores o bancos. |
| Alcance geográfico | Un país y una moneda por empresa en el piloto | Evita introducir reglas tributarias y cambiarias que todavía no se han validado. |

### Fuera del MVP

Inventario en tiempo real, compras y órdenes de producción, facturación, contabilidad, conciliación bancaria, costeo de proyectos únicos, optimización automática de precios, impuestos de todos los países, predicción de demanda y reemplazo de asesoría contable. Las integraciones con proveedores quedarán para una etapa posterior, cuando sepamos cuáles generan ahorro real.

## 4. Recorrido principal del usuario

1. **Ingreso.** El equipo invita a la empresa piloto. El usuario crea su espacio, define moneda, país y periodicidad de revisión.
2. **Productos.** Crea un primer producto y luego añade variantes reutilizando su estructura; cada uno conserva consumo, rendimiento, trabajo y precio propios.
3. **Proceso.** El asistente propone materiales, etapas, rendimiento, merma, empaque y costos comerciales. El usuario corrige y confirma; los insumos coincidentes se enlazan al catálogo común.
4. **Precios.** Revisa y edita una tabla de insumos con presentación, proveedor, precio vigente, precio nuevo y productos afectados. Puede adjuntar un comprobante; la IA propone los datos extraídos y el usuario los aprueba.
5. **Trabajo y gastos.** Registra tiempos por producto y edita otra tabla de gastos compartidos del período una sola vez —electricidad, gas, espacio—; confirma cómo repartirlos entre productos.
6. **Diagnóstico.** Revisa faltantes y estimaciones, incluidos los criterios de reparto. Si un dato imprescindible falta, el producto no presenta una cifra aparentemente precisa.
7. **Dashboard y detalle.** Compara todos los productos y entra a cada uno para ver costo por lote, costo unitario, margen, fuentes y asignaciones.
8. **Actualización.** Edita una o varias celdas, o registra un cambio por chat. La vista de revisión agrupa las filas modificadas y muestra el efecto por producto; solo una aprobación explícita crea una nueva versión y conserva las anteriores.
9. **Decisión.** Guarda una acción tomada o descartada y su motivo: ajustar precio, cambiar proveedor, modificar proceso o aceptar menor margen.

### Pantallas mínimas

Dashboard multiproducto; asistente de alta y creación de variantes; detalle y desglose por producto; planilla editable de insumos/precios y gastos compartidos; revisión tabular de cambios e impacto transversal; precios y comprobantes; diagnóstico de calidad; historial de cambios; simulador simple.

El diseño debe funcionar en móvil, pero el piloto puede priorizar escritorio para la carga inicial. El flujo de actualización debe ser cómodo en móvil, porque es el uso recurrente que interesa validar.

### Patrón de interfaz: planilla familiar, datos controlados

- **Una fila por entidad real:** un insumo con su presentación/proveedor y precio de compra; un gasto compartido por período. No crear una copia por producto.
- **Dos columnas inequívocas:** «Vigente» es solo lectura y «Nuevo» es editable. La edición genera un borrador local a la sesión de trabajo, no altera el costo oficial al salir de la celda.
- **Revisión antes de aplicar:** una tabla reúne todas las filas cambiadas y otra compara costo vigente, simulado y diferencia para cada producto afectado. Fuente, fecha, unidad y regla de reparto deben quedar verificadas antes de confirmar.
- **Interacción de hoja de cálculo sin prometer Excel completo:** Tab y teclado para recorrer celdas, validación junto al dato, números alineados y filtros/búsqueda cuando el volumen lo exija. En móvil se priorizan columnas críticas y un detalle por fila, sin ocultar la diferencia entre vigente y borrador.
- **IA como asistente de la misma planilla:** chat, extracción y Jev pueden proponer una fila, correspondencia o clasificación; la persona ve la propuesta en la tabla y aprueba. El motor determinístico calcula el impacto; el modelo no escribe montos ni confirma cambios.

El prototipo en `MOCKUPS_UX_MVP.html` demuestra edición y simulación en memoria, sin persistencia. La aplicación real deberá guardar borradores, fuentes, aprobaciones y versiones con control de concurrencia y trazabilidad.

## 5. Requerimientos funcionales y criterios de aceptación

### F1. Empresa, usuarios y acceso

- Crear una organización por empresa piloto, con país, moneda, zona horaria y un responsable.
- Invitar al menos a un segundo usuario cuando el piloto lo requiera.
- Separar roles de propietario, editor y lector; el equipo interno tendrá acceso de soporte explícito y auditado.
- Aislar todos los datos por organización, incluso en búsquedas, archivos y trabajos asíncronos.

**Aceptación:** un usuario de la empresa A no puede leer ni modificar datos de la empresa B mediante la interfaz ni llamando directamente a una API.

### F2. Producto y proceso

- Crear producto, unidad vendible y versión de la lista de materiales.
- Crear variantes a partir de otro producto sin copiar precios ni gastos compartidos; admitir al menos tres productos activos por empresa piloto.
- Registrar etapas, insumos consumidos, mano de obra, producción bruta, unidades vendibles y rechazo/merma.
- Reutilizar un mismo insumo en varios productos con cantidades distintas por versión; mostrar desde la ficha del insumo todos los productos que lo consumen. Permitir una preparación intermedia simple si aparece en los pilotos.
- Conservar versiones para explicar qué cambió en la composición.

**Aceptación:** tres productos pueden consumir el mismo insumo con cantidades diferentes; cambiar la cantidad o rendimiento de uno no modifica a los demás ni altera su historial.

### F3. Compras, unidades y fuentes

- Registrar proveedor, presentación de compra, cantidad contenida, precio, moneda, fecha efectiva y fuente.
- Mantener el precio de compra en el insumo compartido, no en cada producto; permitir excepciones explícitas por proveedor, calidad o presentación sin fusionar materiales distintos.
- Mostrar insumos y precios en una tabla editable con vigente, borrador, unidad/presentación, proveedor, fuente y número de productos dependientes. Editar varias filas antes de revisar el impacto; validar importes no negativos y unidad compatible.
- Convertir entre unidades compatibles: masa, volumen y unidades discretas. Las conversiones de densidad o equivalencias no evidentes requieren un factor confirmado por el usuario.
- Adjuntar PDF o imagen de un comprobante simple en un bucket privado.
- Mostrar la propuesta de extracción de IA antes de guardarla como dato confirmado.
- Evitar precios duplicados para el mismo insumo, proveedor y comprobante.

**Aceptación:** comprar 10 kg y consumir 250 g produce el costo proporcional correcto; cambiar la fecha o proveedor no sobrescribe el registro anterior.

### F4. Trabajo, gastos y canales

- Registrar tiempo por etapa y costo por hora, incluido el trabajo del dueño aunque no exista un pago formal.
- Separar **salida de caja** de **costo económico** cuando corresponda.
- Registrar costos variables de venta: comisión, medio de pago, empaque final y entrega atribuible.
- Registrar gastos comunes del taller **una sola vez por período** —por ejemplo, electricidad, gas y espacio— con fuente, fecha, importe y centro de costo.
- Mostrar gastos comunes en una tabla editable por período con importe vigente, borrador, fuente, base de reparto y productos alcanzados; una edición no crea gastos duplicados.
- Para cada gasto común, elegir una base de reparto aprobada por la empresa: unidades, horas de trabajo o de máquina; guardar la actividad de todos los productos del mismo período, el total denominador y la porción asignada a cada uno.
- Clasificar cada costo en dos ejes independientes: fijo/variable/mixto y directo/indirecto. Si es mixto, separar sus componentes con evidencia o marcar el margen de contribución como incompleto; no inferir que «compartido» equivale a «fijo».
- Impedir que una misma erogación se cargue dos veces como costo de lote y gasto mensual, o una vez por cada producto. Diferenciar costo de fabricación, costo variable de venta y gasto asignado.

**Aceptación:** al asignar un gasto común de $94.000 por 47 horas de producción —20, 15 y 12 horas para tres productos— las porciones son $40.000, $30.000 y $24.000; suman exactamente el gasto original. Cambiar el reparto de la parte fija no altera el margen de contribución, pero sí puede cambiar el costo completo estimado.

### F5. Motor de costos y resultados

- Calcular costo del lote y costo por unidad vendible con aritmética decimal, no con números binarios de punto flotante como fuente final.
- Mostrar margen sobre precio y recargo sobre costo como indicadores distintos.
- Mostrar precio que cubre costos variables y precio objetivo que incorpora el criterio de asignación elegido.
- Calcular el punto de equilibrio solo cuando el conjunto de costos fijos y el supuesto de mezcla/volumen permitan interpretarlo. En caso contrario, mostrar la limitación y no un número engañoso.
- Guardar un `snapshot` inmutable de cada cálculo, con versión de reglas, entradas y fecha.
- Permitir un escenario temporal que no modifique datos oficiales hasta confirmación.
- Recalcular la vista previa mientras se editan celdas válidas y bloquear la confirmación si alguna fila carece de importe, unidad, fuente o regla requerida.
- Recalcular una dependencia insumo→productos una sola vez por cambio aprobado y mostrar el antes/después de cada producto afectado.

**Aceptación:** cada resultado puede abrirse hasta llegar a sus cantidades, precios, fuentes y reglas; las pruebas automatizadas cubren redondeos, cero unidades, costo faltante, merma, cambios de proveedor, dependencias compartidas y conservación del total repartido.

### F6. Asistente de IA y diagnóstico

- Hacer preguntas adaptativas según el tipo de producto y las respuestas previas.
- Proponer costos que suelen omitirse, indicando por qué la pregunta es relevante.
- Extraer campos de comprobantes dentro de un esquema estructurado y citar la página/fragmento de origen cuando sea posible.
- Proponer, sin aplicar automáticamente, la clasificación de cada concepto de costo en los ejes fijo/variable/mixto y directo/indirecto, con opción «información insuficiente» y contexto del proceso, período y volumen relevante.
- Sugerir correspondencias entre la descripción de un comprobante y un insumo/proveedor ya registrado; no crear una identidad nueva ni fusionar registros solo por similitud textual.
- Etiquetar cada dato como `confirmado`, `estimado`, `faltante` o `desactualizado`.
- Explicar diferencias de costo y margen en lenguaje simple, usando cifras ya calculadas por el motor.
- Exigir confirmación humana antes de crear o modificar datos económicos persistentes.

**Aceptación:** la IA no puede inventar un precio ni escribir directamente un cálculo financiero. Ante un documento ambiguo, devuelve una propuesta incompleta y solicita confirmación.

### F7. Monitoreo e historial

- Definir una política de vigencia inicial por tipo de dato; el usuario o el equipo podrá ajustarla durante el piloto.
- Detectar insumos sin precio reciente y productos afectados.
- Mostrar en una sola vista todos los productos afectados por un insumo compartido, con el efecto individual antes de confirmar el nuevo precio.
- Reunir en una tabla de revisión los cambios de varias filas, mostrando qué cambió, quién lo propuso y si vino de edición manual o IA; conservar el valor vigente hasta la confirmación explícita.
- Comparar importes, fechas y unidades con reglas determinísticas; usar IA solo para proponer si una nueva línea documental corresponde a un insumo conocido o explica un cambio que las reglas no pueden interpretar.
- Mostrar variación entre snapshots: costo unitario, margen y principales causas.
- Enviar un recordatorio dentro de la aplicación; correo solo si la cohorte demuestra que lo necesita.
- Registrar si el usuario revisó, pospuso o resolvió la alerta.

**Aceptación:** una actualización de precio genera un solo evento de cambio, recalcula todos los productos afectados y conserva el antes/después, incluso si el trabajo asíncrono se reintenta.

### F8. Registro de decisiones

- Permitir registrar la decisión asociada a un cálculo o alerta.
- Registrar fecha, tipo de acción, precio anterior/nuevo cuando aplique y observación breve.
- Distinguir una decisión tomada de una sugerencia de la IA.

**Aceptación:** el equipo puede reconstruir qué información vio el usuario al decidir y medir si el cálculo tuvo una consecuencia real.

### Prioridad de entrega

**P0 para abrir el piloto:** organización e invitación; dashboard y al menos tres productos por empresa; creación de variantes; catálogo único de materiales/precios con consumo por producto; **planillas web editables de insumos, precios y gastos con columnas vigente/borrador y revisión tabular**; conversiones, rendimiento y merma; trabajo directo; gastos comunes registrados una vez por período y asignados con base explícita; motor de costos; diagnóstico de datos; fuentes y snapshots; actualización de un insumo con impacto en todos sus productos; historial y registro de decisiones. La entrevista con IA forma parte de P0, aunque durante la primera cohorte pueda complementarse con acompañamiento del equipo.

**P1 dentro del piloto:** importación y pegado masivo desde Excel/CSV con mapeo y deduplicación revisables; extracción automática de comprobantes, preparaciones intermedias, simulador, centros de costo o repartos avanzados y alertas automatizadas. Estas funciones se incorporan según los obstáculos observados; la existencia de P1 no retrasa una primera prueba de P0 con datos reales. Los comprobantes pueden adjuntarse como evidencia y cargarse manualmente antes de habilitar su extracción.

El punto de equilibrio por producto queda condicionado a que el equipo apruebe un supuesto de mezcla y costos fijos defendible. Si no lo hace, el piloto mostrará contribución y costo completo estimado, pero no publicará un punto de equilibrio por producto.

## 6. Reglas financieras que deben quedar cerradas antes de programar

El especialista de costos del equipo aprobará una **especificación de fórmulas con ejemplos**. La implementación no comenzará a presentar precios sugeridos hasta superar ese control.

| Concepto | Regla inicial |
| --- | --- |
| Costo de material del lote | Cantidad efectivamente consumida × costo por unidad base, con precio efectivo a la fecha del cálculo. |
| Costo de fabricación del lote | Materiales + mano de obra directa + costos de fabricación atribuibles + porción justificada de gastos indirectos compartidos. |
| Unidad vendible | Producción bruta menos unidades rechazadas; si el rendimiento ya incorpora merma, no volver a cargarla como un segundo costo. |
| Costo de fabricación unitario | Costo de fabricación del lote ÷ unidades vendibles. No calcular si el denominador es cero o desconocido. |
| Costo variable unitario total | Costo de fabricación variable unitario —incluida la porción variable de gastos comunes cuando esté identificada— + costos variables de venta por canal. |
| Margen de contribución | Precio neto de venta − costo variable unitario total. |
| Margen sobre precio | Margen de contribución ÷ precio neto de venta. |
| Margen estimado tras asignación | (Precio neto de venta − costo completo estimado) ÷ precio neto de venta. Se etiqueta distinto del margen de contribución y no equivale al resultado contable de la empresa. |
| Recargo sobre costo | (Precio neto − costo variable unitario total) ÷ costo variable unitario total. Es distinto del margen sobre precio. |
| Costo completo estimado | Costo variable unitario total + porción de costos fijos directos e indirectos asignada según una base y período declarados; sin contar dos veces la porción variable común. |

Las compras incluirán flete de entrada cuando sea atribuible al insumo; la entrega al cliente se tratará como costo de venta del canal. Los impuestos recuperables no formarán parte del costo cuando la empresa confirme ese tratamiento; los no recuperables sí podrán incluirse. El sistema **no hará asesoría tributaria automática**. Para una compra en otra moneda, el piloto exigirá tipo de cambio, fecha y fuente informados manualmente; si esto aparece con frecuencia, se priorizará una integración posterior.

Habrá tres etiquetas de precio para evitar falsas equivalencias:

- **Piso variable:** cubre costos variables unitarios, pero no asegura cubrir gastos fijos.
- **Precio de costo completo estimado:** incorpora el reparto de gastos fijos bajo un supuesto de volumen.
- **Precio objetivo:** aplica un margen elegido y muestra la fórmula utilizada.

El cálculo monetario debe conservar precisión interna suficiente y redondear solo al presentar o al aplicar la política monetaria definida. Los ejemplos de referencia y los resultados de la planilla actual servirán para comparar conceptos, pero no para heredar fórmulas sin revisión: la planilla simplifica el reparto de costos fijos y algunos precios sugeridos se basan solo en el costo variable.

Cada línea tendrá su clasificación y unidad de cálculo. Una remuneración mensual fija no se convertirá automáticamente en costo variable por unidad; una comisión porcentual no se repartirá como gasto fijo. El sistema mostrará el efecto de estas decisiones de clasificación.

Para gastos compartidos, el sistema guardará **importe original, período, productos beneficiarios, base de reparto, actividad por producto, total de actividad y porción asignada**. La suma asignada debe coincidir con el importe repartible después de la política de redondeo. Si falta el denominador, si un producto no participó o si el gasto mixto no se separó, se mostrará un supuesto o un resultado incompleto en vez de fabricar precisión. El dashboard no sumará costos unitarios de productos distintos como si fueran un único gasto de empresa.

## 7. Arquitectura técnica propuesta

### Distribución de responsabilidades

| Componente | Plataforma | Responsabilidad |
| --- | --- | --- |
| Aplicación web | Vercel | Next.js con interfaz, renderizado, onboarding, vistas de resultados y despliegues de preview. |
| API de producto y motor de costos | Vercel Functions (Next.js Route Handlers) | Autenticación, autorización por empresa, validación, cálculos, historial, productos, insumos, gastos, documentos y endpoints para la interfaz. Toda la lógica de negocio vive aquí. |
| Puente privado de D1 | Cloudflare Worker mínimo | Solo ejecuta consultas D1 parametrizadas enviadas por Vercel y firmadas con un secreto de servicio; no expone rutas de producto, modelos ni reglas financieras. |
| Base de datos operacional | Cloudflare D1 | Datos relacionales y auditables. Una base compartida para pilotos, con `organization_id` en las entidades de negocio. |
| Archivos de evidencia | Cloudflare R2 | Comprobantes privados y documentos originales; en D1 solo metadatos y referencias al objeto. |
| Procesamiento asíncrono (si hace falta) | Vercel Functions + cola de trabajos persistida en D1 | Ejecutar extracción, recálculo y alertas desde Vercel; se añadirá infraestructura de colas solo al comprobar necesidad real. |
| Revisión programada | Vercel Cron Jobs | Invocar una ruta privada de Vercel; interpretar fechas en la zona horaria de la empresa. |
| Servicio de IA | Funciones de servidor de Vercel, Node.js 22+, ESM, Vercel AI SDK 7 y AI Gateway | Único punto de acceso a modelos. Cozte usa `minimax/minimax-m3` con clave explícita `AI_GATEWAY_API_KEY`; Jev se invoca mediante `experimental_evaluate` y `typesafe-ai/jev` para juicios acotados. |
| Identidad de usuarios | Clerk, integrado en Vercel | Inicio de sesión, organizaciones e invitaciones; elección aprobada para el piloto. |

La aplicación llamará a Cloudflare **solo desde el servidor de Vercel**. El navegador no tendrá credenciales permanentes de D1 ni R2. Clerk y la API de Vercel determinarán la identidad, organización y rol; cada consulta de negocio incluirá un filtro por `organization_id`. El puente de D1 no conoce usuarios ni decide permisos: solo acepta lotes de SQL parametrizado firmados por Vercel, con caducidad breve, tamaño acotado y secreto privado. R2 se conectará directamente desde Vercel con su API S3 y credenciales limitadas al bucket; los archivos serán privados y las cargas usarán permisos temporales cuando se habilite R2.

Las llamadas a modelos, cálculos, programación, confirmaciones y recálculos se iniciarán en Vercel. Cloudflare conservará datos en D1 y archivos en R2, sin lógica de producto. Toda sugerencia de IA será una propuesta que requiera confirmación humana; la primera cohorte podrá procesar documentos sin colas y activar trabajos asíncronos solo si el volumen lo exige.

Para la primera cohorte, usaremos **una cuenta de Cloudflare para producción** y recursos separados para preview/staging. Tener varias cuentas disponibles no obliga a repartir el MVP entre ellas: esa fragmentación complicaría secretos, observabilidad y recuperación. Se revisará esta decisión si aparece una necesidad concreta de aislamiento contractual o geográfico.

### Por qué esta distribución

Vercel ofrece un camino directo para desplegar Next.js y sus funciones de servidor. Cloudflare documenta que la REST API de D1 está orientada principalmente a uso administrativo por su límite global; para acceso operacional desde Vercel se usa un Worker privado y mínimo, no una segunda API de negocio. R2 sí ofrece una API compatible con S3 para conexión directa desde Vercel. [Vercel Functions](https://vercel.com/docs/functions/functions-api-reference), [D1 desde una aplicación externa](https://developers.cloudflare.com/d1/tutorials/build-an-api-to-access-d1/) y [R2 con AWS SDK](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/).

**Validación técnica obligatoria:** D1 es adecuado como hipótesis para una cohorte pequeña, pero cada base procesa consultas secuencialmente y tiene límites propios. Mediremos la latencia Vercel→puente→D1, concurrencia, migraciones y consultas reales. Si no cumple, mantendremos la API en Vercel y cambiaremos solo el repositorio relacional; no duplicaremos fuentes de verdad. [Límites y comportamiento de D1](https://developers.cloudflare.com/d1/platform/limits/).

### Estructura de repositorio sugerida

```text
apps/
  web/                 # Next.js en Vercel
    app/api/            # API pública, IA y cron en Vercel
    lib/domain.ts       # Reglas financieras puras y verificables
    lib/server/         # Autorización, repositorios y adaptadores
  data-bridge/          # Único Worker privado: acceso firmado a D1
    migrations/         # Migraciones de D1
docs/
  decisions/
  pilot/
```

El motor financiero se ejecutará en las rutas de servidor de Vercel. La interfaz podrá solicitar previsualizaciones, pero solo la API autenticada guardará resultados. El Worker no importará tipos de dominio ni fórmulas financieras.

### Modelo de datos inicial

`organizations`, `users`, `memberships`, `products`, `product_versions`, `process_steps`, `materials`, `product_components`, `suppliers`, `purchase_prices`, `labor_rates`, `shared_expenses`, `allocation_rules`, `allocation_activity`, `expense_allocations`, `sales_channels`, `channel_costs`, `source_documents`, `extraction_proposals`, `classification_proposals`, `cost_snapshots`, `snapshot_lines`, `alerts`, `decisions`, `audit_events`, `jobs`.

Campos transversales: identificador, `organization_id`, fecha de creación, fecha efectiva, actor, estado, versión y procedencia cuando apliquen. Los precios y snapshots se agregan como registros nuevos; corregir un dato no debe borrar lo que sustentó una decisión anterior.

### Contratos de API prioritarios

`GET /dashboard/products`, `POST /products`, `POST /products/:id/variants`, `POST /products/:id/versions`, `POST /materials`, `GET /materials/:id/dependents`, `POST /purchase-prices`, `POST /shared-expenses`, `POST /allocation-rules`, `POST /documents`, `POST /extraction-proposals/:id/confirm`, `POST /products/:id/calculate`, `GET /products/:id/cost-history`, `POST /scenarios`, `GET /alerts`, `POST /decisions`.

Cada escritura debe validar esquema, organización, permisos e idempotencia. La API devolverá importes, unidades, estado de calidad del dato, advertencias y referencias a las líneas de cálculo; no solo un total.

## 8. Diseño de la IA

### Regla de arquitectura: AI SDK 7 como única capa de consumo

**Todas las llamadas a modelos**, tanto Jev como los generativos usados para documentos, entrevista o explicación, pasarán por **Vercel AI SDK 7** en servidor. No habrá clientes directos de proveedores en el navegador, en Workers ni en el código de producto. Usaremos Vercel AI Gateway como ruta inicial común. Para Jev, la integración oficial requiere **AI SDK 7.0.105 o posterior dentro de la versión 7** y expone `experimental_evaluate` con el identificador `typesafe-ai/jev`; por ser una API experimental, fijaremos y probaremos la versión exacta del paquete antes de cada actualización. AI SDK 7 requiere Node.js 22+ y módulos ESM. La skill de TypeSafe instalada es una guía de diseño para el equipo, **no** una dependencia de ejecución ni una excepción a esta regla.

### Reparto de responsabilidades

| Necesidad | Mecanismo propuesto | Límite de responsabilidad |
| --- | --- | --- |
| Interpretar un concepto de costo | Jev `choice` independientes para fijo/variable/mixto y directo/indirecto, con «no determinado»; contexto de producto, etapa, período y comportamiento observado | Sugiere etiquetas; el usuario confirma. La misma erogación puede exigir preguntas adicionales antes de clasificarla. |
| Vincular una línea de compra | Código recupera candidatos por proveedor, alias y unidad; Jev elige entre candidatos e incluye «ninguno» | Nunca inventa insumo, proveedor, importe ni fecha. La identidad definitiva se confirma. |
| Detectar un costo potencialmente omitido | Checklist por tipo de proceso; Jev evalúa preguntas sí/no estrechas sobre posibles gaps | No convierte una posibilidad en un costo registrado. Pregunta al usuario y conserva su respuesta. |
| Seguir cambios de costos | Reglas comparan precios, unidades, fechas y snapshots; Jev ayuda a interpretar descripciones cambiantes y a priorizar una revisión semántica | Diferencias numéricas, impacto en productos y vigencia se calculan en código. No habrá «monitoreo automático» de proveedores sin fuentes integradas. |
| Leer comprobantes y explicar resultados | OCR/parser y, cuando sea necesario, modelo generativo mediante AI SDK 7; explicación basada en diferencias ya calculadas | Jev acepta texto, no imágenes, y no genera narraciones. El modelo generativo propone campos, nunca cifras oficiales. |

Jev recibe **estado estructurado y preguntas acotadas**, y devuelve decisiones tipadas y probabilidades. Preguntas independientes sobre el mismo estado pueden evaluarse juntas. La política de negocio combina esas señales en código, conservando siempre `no determinado`/`ninguno` y enviando casos dudosos a revisión. La probabilidad no prueba que una clasificación sea correcta; la confianza de `choice`/`score` mide cuán concentrada está su distribución, y los umbrales se calibrarán con ejemplos reales. Jev no hará aritmética, comparaciones de fechas, conversiones, asignación de gastos ni explicación en prosa. [Diseño de TypeSafe](https://docs.typesafe.ai/concepts/how-to-build-with-system-one), [limitaciones conocidas de Jev](https://docs.typesafe.ai/model-jaggedness/jev-1.13), [integración oficial con AI SDK 7](https://vercel.com/kb/guide/typesafe-jev-and-ai-sdk).

En documentos: primero se extrae texto y se detectan candidatos de monto, fecha y unidad con código; Jev puede seleccionar el fragmento que cumple un rol, y luego código lo normaliza y valida. Si el texto es ilegible o los candidatos no cubren el dato necesario, se solicita corrección o se prueba un modelo multimodal **también vía AI SDK 7**. Nunca se acepta un número generado sin cotejo con el comprobante. Esta cascada limita llamadas costosas y evita pedirle a Jev tareas para las que no fue diseñado. [Patrón de extracción de TypeSafe](https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook).

Las propuestas guardarán fuente y fragmento, versión de pregunta/esquema/modelo, probabilidades pertinentes, estado de revisión, corrección humana y fecha. La IA solo puede guardar un **borrador** estructurado en D1; confirmar el perfil o los precios vigentes requiere acción humana. Los textos de empresas son datos no confiables y sus instrucciones internas no alteran políticas, permisos ni reglas de costeo. Solo se enviará al proveedor el contexto mínimo; claves siempre en servidor. Configuraremos controles de **Zero Data Retention y No Training** en AI Gateway cuando correspondan y comprobaremos las condiciones contractuales aplicables al piloto. [Controles de AI Gateway](https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway).

### Prueba de valor y puerta de adopción de Jev

Antes de depender de Jev en P0, el equipo etiquetará con criterio financiero un corpus consentido de conceptos de costo, comprobantes y cambios reales **en español del país piloto**. Incluirá materiales, empaque, flete, comisiones, trabajo del dueño, gastos mixtos, impuestos, nombres de proveedores variantes y casos sin información suficiente. Compararemos tres rutas sobre las mismas tareas: reglas y formulario guiado; Jev mediante `evaluate`; y un modelo generativo mediante AI SDK 7. Mediremos acierto por categoría, falsos positivos de omisiones, porcentaje enviado a revisión, correcciones humanas, latencia y costo total por producto actualizado; no trasladaremos al plan cifras promocionales de velocidad o ahorro de otro dominio. TypeSafe indica que Jev rinde mejor en inglés y recomienda probar otros idiomas con datos propios. [Soporte de idiomas](https://docs.typesafe.ai/models#language-support).

El criterio de salida no será «Jev responde», sino que **reduce tiempo de carga o revisión sin aumentar errores materiales** frente al formulario guiado y cumple la política de privacidad. Si falla en una tarea, esa tarea vuelve a reglas, revisión humana o modelo generativo, manteniendo AI SDK 7 como capa común. Los umbrales de automatización y de escalamiento se definirán según errores observados y consecuencias, no copiando valores de demostraciones externas.

## 9. Seguridad, privacidad y operación

- **Aislamiento:** autorización por organización en todas las consultas y objetos R2; pruebas de acceso cruzado.
- **Secretos:** claves solo en entornos de servidor. Configuraciones distintas para desarrollo, preview/staging y producción. [Entornos y variables de Vercel](https://vercel.com/docs/deployments/environments/).
- **Archivos:** bucket privado, tipos y tamaños permitidos, escaneo o control equivalente antes de procesar, enlaces temporales, política de retención y borrado.
- **Auditoría:** registrar cambios de precios, fórmulas, supuestos, confirmaciones de IA y accesos de soporte.
- **Resiliencia:** escrituras idempotentes y trabajos persistidos con reintentos limitados. Si el piloto necesita cola, su consumidor llamará a la API privada de Vercel; no ejecutará reglas de negocio en Cloudflare.
- **Recuperación:** migraciones versionadas, exportación periódica verificable y ensayo de restauración. Time Travel de D1 ayuda, pero no sustituye la comprobación de que podemos restaurar datos y archivos del producto. [Recuperación de D1](https://developers.cloudflare.com/d1/reference/time-travel/).
- **Observabilidad:** errores por ruta, latencia de cálculo, tasa de trabajos fallidos, costo de IA, archivos pendientes y alertas enviadas. Nunca registrar documentos completos ni secretos.
- **Experiencia:** interfaz accesible por teclado, mensajes de error comprensibles, unidades siempre visibles y cálculo interactivo que no dependa de una llamada al modelo de IA. El tiempo de respuesta objetivo se medirá con los datos reales del piloto antes de fijar un compromiso de servicio.
- **Cumplimiento:** antes del piloto pago, revisar consentimiento, contrato de tratamiento de datos y obligaciones del país seleccionado. El sistema no emitirá conclusiones tributarias automáticas.

Los recordatorios de vigencia se programarán en Vercel Cron Jobs; una ruta privada interpretará las fechas del negocio en su zona horaria. [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs).

## 10. Plan de entregas y puertas de decisión

Los plazos son una **estimación de planificación**, no una promesa de calendario. Suponen un equipo pequeño con al menos una persona de producto/dominio, una de diseño y una o dos de desarrollo. Cada fase debe cerrar con una demostración y evidencia verificable.

| Fase | Duración orientativa | Entregable | Puerta de salida |
| --- | --- | --- | --- |
| 0. Alineación y selección | 1 semana | ICP, país piloto, 8–12 empresas candidatas, proceso de referencia, fórmulas, políticas de datos y corpus inicial para Jev | El equipo reconstruye manualmente tres productos con al menos un insumo y un gasto compartidos y etiqueta los primeros casos ambiguos. |
| 1. Fundación técnica | 1–2 semanas | Monorepo, entornos Vercel/Cloudflare, identidad, D1, migraciones, R2, CI, despliegue preview y capa AI SDK 7 | Un usuario invitado crea productos aislados de otras empresas; una evaluación Jev de prueba por Gateway funciona. |
| 2. Costeo base | 2–3 semanas | Catálogo común, tres productos/variantes, dependencias, gastos compartidos, bases de reparto y motor determinístico | Un insumo actualizado afecta a los tres productos; las asignaciones cuadran con el gasto original y el cálculo manual. |
| 3. IA y evidencia | 1–2 semanas | Entrevista adaptativa, clasificación propuesta con Jev, comprobante privado, confirmación y diagnóstico; extracción si pasa la evaluación | Se decide con el corpus si Jev entra al piloto o se usa el flujo alternativo; la IA no escribe datos sin aprobación y la carga manual funciona aunque falle. |
| 4. Monitoreo | 1–2 semanas | Historial y recálculo; alertas, cron y queue según prioridad observada | Un nuevo precio actualiza todos los productos afectados una sola vez. |
| 5. Piloto controlado | 4–6 semanas de observación | Usuarios reales, dos ciclos de actualización, registro de decisiones y oferta paga | Evidencia suficiente para continuar, ajustar el segmento o reducir alcance. |

Las fases 2 y 3 pueden solaparse parcialmente, pero el asistente nunca debe anticipar resultados financieros que el motor aún no ha validado. El piloto empieza con carga acompañada y pasa gradualmente a autoservicio para medir cuánto trabajo sigue haciendo el equipo.

### Trabajo detallado por fase

**Fase 0:** entrevistar y observar empresas candidatas; seleccionar un modo de producción dominante; recoger facturas, listas de materiales de varias variantes y gastos de taller con permiso; definir glosario, período de costos, política de merma, tratamiento de impuestos, bases de reparto y pruebas de referencia. Etiquetar casos para comparar Jev, reglas y un modelo generativo; elegir identidad y modelo generativo tras una prueba corta de integración y tratamiento de datos. AI SDK 7 y AI Gateway quedan fijados como infraestructura de modelos inicial.

**Fase 1:** construir entornos separados, políticas de secretos, modelo multiempresa, permisos, migraciones, flujo de invitación y estructura de monitoreo. Configurar Node.js 22+, ESM, AI SDK 7 y una evaluación Jev mínima en el servidor de Vercel, con credenciales segregadas por entorno. Configurar revisiones de código y despliegues de preview. No conectar preview a datos de producción.

**Fase 2:** implementar catálogo único de materiales y precios efectivos, creación de variantes, composición y trabajo por producto, gastos comunes por período, actividades/base de reparto, dashboard, canales, cálculo y snapshots. Probar con el experto financiero el caso de tres productos que comparten insumo y taller, más escenarios límite.

**Fase 3:** implementar preguntas Jev estrechas para clasificar costos, proponer correspondencias y detectar gaps, junto con el asistente generativo para entrevista/explicación, carga privada de comprobantes y pantalla de confirmación. Comparar con la línea base en español, instrumentar correcciones humanas y revisar preguntas, criterios y prompts. La cola de extracción se incorpora si las pruebas muestran que ahorra trabajo de forma fiable.

**Fase 4:** completar comparación de versiones, impacto transversal y registro de decisiones sobre las dependencias ya implementadas. Agregar recordatorios con Vercel Cron y procesamiento asíncrono solo cuando el volumen o la experiencia lo justifiquen. Probar reintentos y duplicados de cualquier trabajo que se active.

**Fase 5:** incorporar una cohorte pequeña y homogénea; completar dos actualizaciones reales por empresa; registrar tiempo del cliente y tiempo del equipo; ofrecer un piloto con precio explícito y entrevistar tanto a quienes continúan como a quienes abandonan.

## 11. Pruebas y definición de «listo»

### Pruebas automáticas

- Unitarias del motor: conversiones, rendimientos, merma, redondeos, margen vs. recargo, clasificación y asignación de gastos comunes, suma de porciones, impuestos y monedas.
- Basadas en propiedades: aumentar un precio de insumo no reduce el costo de ningún producto dependiente cuando lo demás permanece igual; cambiar un producto no modifica la composición de otro; costo de lote = suma de sus líneas y gastos asignados = importe común, dentro de la tolerancia definida.
- Integración de API y D1: permisos, transacciones, fechas efectivas, snapshots y migraciones.
- Trabajos asíncronos: duplicados, reintentos, fallo parcial y cola de errores.
- Evaluación de IA: precisión por eje de clasificación, acierto de correspondencias, omisiones útiles, falsas alarmas, tasa de revisión/corrección, calibración, latencia y costo por caso sobre un corpus consentido en español; regresión al actualizar el modelo o AI SDK.
- Extremo a extremo: invitación, creación de tres productos, vinculación de insumo/gasto compartido, cálculo, actualización transversal y decisión.

### Condiciones para abrir el piloto

1. Ninguna cifra económica aparece sin unidad, fecha y procedencia o señal explícita de estimación.
2. Un usuario puede corregir una propuesta de IA antes de que afecte el costo oficial.
3. El equipo puede reproducir manualmente al menos cinco cálculos de prueba y explicar cada diferencia.
4. El acceso cruzado entre organizaciones falla en interfaz, API y archivos.
5. Se puede recuperar un entorno de prueba desde respaldo documentado.
6. Los errores de trabajos asíncronos son visibles y tienen un responsable.
7. Los términos del piloto explican qué datos se usan para IA y quién puede verlos.
8. El dashboard muestra al menos tres productos; un precio compartido y un gasto común se aplican a todos los dependientes sin duplicar registros ni ocultar la regla de reparto.

## 12. Medición del piloto

Antes de incorporar la cohorte fijaremos el precio de prueba y los umbrales de decisión. Las cifras siguientes son **metas provisionales para discutir**, no estimaciones de mercado:

| Pregunta | Indicador | Meta de referencia para una cohorte de 8–12 empresas |
| --- | --- | --- |
| ¿Se completa el primer valor? | Empresas que costean un producto con evidencia suficiente | Al menos 70 %. |
| ¿Aparece el valor multiproducto? | Empresas que costean tres productos y revisan un insumo o gasto compartido | Medir la tasa y el tiempo hasta completar el tercer producto. |
| ¿Hay descubrimiento relevante? | Empresas con un costo omitido/desactualizado que altera la lectura del margen | Registrar incidencia y magnitud, sin imponer umbral previo. |
| ¿Se sostiene la operación? | Empresas que hacen una segunda actualización con ayuda mínima | Al menos 60 % de quienes completaron la primera. |
| ¿Cambia una decisión? | Empresas que documentan una acción vinculada al nuevo cálculo | Al menos la mitad de las que completan dos ciclos. |
| ¿Se reduce el trabajo? | Minutos del cliente y del equipo por actualización frente al método previo | Tendencia a la baja en el segundo ciclo. |
| ¿Existe pago recurrente? | Pilotos pagados y renovaciones ante una oferta concreta | Evidencia de pago y renovación, no solo intención declarada. |

El reporte separará empresas invitadas, activadas, con datos suficientes, con segundo ciclo, con decisión y pagas. Registrará país, rubro, tamaño y modalidad productiva. Una cohorte pequeña sirve para aprender el mecanismo y las objeciones, **no para extrapolar conversión o tamaño de mercado**.

### Decisión tras el piloto

- **Continuar:** hay actualización recurrente, decisiones documentadas y pago que compensa soporte y procesamiento.
- **Ajustar:** el cálculo aporta valor, pero el alta o la actualización requieren demasiado trabajo; simplificar el flujo o estrechar el segmento.
- **Cambiar foco:** el método actual resulta suficiente, los cambios no alteran decisiones o la necesidad es puntual.

## 13. Riesgos principales y respuesta

| Riesgo | Respuesta prevista |
| --- | --- |
| «Manufactura» sigue siendo demasiado amplio | Seleccionar pilotos con el mismo patrón de producción por lote; comparar excepciones antes de generalizar. |
| Datos incompletos producen falsa precisión | Estados de calidad visibles, advertencias y bloqueo de resultados no defendibles. |
| Asignación de fijos crea conclusiones engañosas | Separar contribución de costo completo y exponer criterio, período y volumen supuesto. |
| La IA interpreta mal facturas o procesos | Propuestas revisables, evidencia vinculada, evaluación continua y carga manual disponible. |
| El equipo opera demasiado por detrás | Medir minutos internos por empresa y por actualización; automatizar solo cuellos de botella demostrados. |
| D1 no se ajusta a la carga o consultas futuras | Prueba de desempeño temprana y repositorio de datos desacoplado del dominio; migración a Postgres si se justifica. |
| Costos de IA o infraestructura crecen sin uso pagado | Límites por organización, medición por tarea, alertas presupuestarias y modelo simple de margen bruto por cliente. |
| Datos comerciales sensibles se filtran | Aislamiento multiempresa, mínimo acceso, cifrado, auditoría y pruebas de autorización. |

## 14. Decisiones pendientes que el equipo debe cerrar

Estas decisiones no bloquean la redacción del plan, pero sí condicionan la implementación:

1. **País de la primera cohorte**, para moneda, impuestos, idioma comercial y tratamiento de datos.
2. **Subsegmento operativo dominante** dentro de manufactura ligera por lotes y empresas candidatas concretas.
3. **Alcance de la primera carga:** tres productos/variantes, cuántos comprobantes reales y qué insumo y gasto de taller comparten.
4. **Regla de costo laboral del dueño** y tratamiento del costo de caja frente al costo económico.
5. **Política de gastos compartidos, separación de componentes mixtos y punto de equilibrio** aprobada por el especialista financiero.
6. **Proveedor de identidad y modelo generativo concreto**; Jev queda como candidato prioritario para clasificación, sujeto a evaluación de precisión en español, privacidad y ahorro operativo. AI SDK 7 y AI Gateway son la decisión técnica inicial de acceso a modelos.
7. **Precio y duración del piloto**, definidos antes de medir disposición de pago.
8. **Responsables de soporte, revisión financiera e incidentes** durante la cohorte.

## 15. Primer paquete de trabajo inmediato

La primera semana debe producir cinco artefactos operativos: una ficha de cliente piloto con criterios de inclusión/exclusión; un caso de tres productos con insumo y gasto compartidos reconstruido con datos reales y permiso de uso; una especificación de fórmulas y reparto con pruebas de referencia; un prototipo navegable de dashboard, detalle y actualización transversal; y un corpus inicial etiquetado para clasificaciones, gaps y cambios de costo en español. Con eso podremos confirmar el alcance y probar Jev antes de construir infraestructura que no responda al problema observado.

---

### Base documental y técnica

Este plan sintetiza los materiales del equipo —`Hipotesis_y_validacion_costeo_PyMEs.pdf`, `Costos.pdf` y `Planillas costos.xlsx`— y las decisiones de producto discutidas después. **Reemplaza el foco «alimentos» de los primeros borradores por manufactura ligera de productos repetibles.** Los PDF y el pitch deck anteriores deben actualizarse cuando el equipo apruebe esta definición del cliente inicial.

Referencias técnicas consultadas: [Next.js en Vercel](https://vercel.com/docs/frameworks/full-stack/nextjs), [Vercel Functions](https://vercel.com/docs/functions/functions-api-reference), [AI SDK 7](https://vercel.com/blog/ai-sdk-7), [Jev en AI Gateway](https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway), [guía de Jev con AI SDK](https://vercel.com/kb/guide/typesafe-jev-and-ai-sdk), [limitaciones de Jev](https://docs.typesafe.ai/model-jaggedness/jev-1.13), [entornos de Vercel](https://vercel.com/docs/deployments/environments/), [D1 desde aplicaciones externas](https://developers.cloudflare.com/d1/tutorials/build-an-api-to-access-d1/), [límites de D1](https://developers.cloudflare.com/d1/platform/limits/), [R2 mediante S3](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/) y [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs).
