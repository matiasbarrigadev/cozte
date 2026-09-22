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

Abre `/demo` para explorar un conjunto de tres productos sin credenciales de datos. La demostración es de solo lectura; sus cambios se simulan localmente.

Para usar datos reales, copia `.env.example` a `.env.local` y configura Clerk, la URL y secreto compartido del puente D1, `AI_GATEWAY_API_KEY` para MiniMax M3 y las credenciales R2 para documentos. No subas `.env.local` al repositorio. Cozte exige una clave explícita de AI Gateway tanto local como en Vercel; no depende de OIDC. El secreto `DATA_BRIDGE_SECRET` debe coincidir con el secreto del Worker; `CRON_SECRET` protege la revisión diaria de precios. El asistente nunca confirma cambios: deja propuestas para revisión humana. El historial conserva fotos inmutables de cada cambio confirmado.

El proyecto `lightningteam/cozte` ya importa este repositorio con **Root Directory `apps/web`**. El propietario administra `cozte.com`. Consulta el README raíz para el estado de los servicios y los pasos pendientes.
