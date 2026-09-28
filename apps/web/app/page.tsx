import Link from "next/link";
import { AnimatedIcon, type AnimatedIconName } from "@/components/animated-icon";
import { CozteLogo } from "@/components/cozte-logo";
import { HeroMockup } from "@/components/landing/hero-mockup";
import { CostsMockup, CozteChatMockup, PeopleMockup, ResultMockup, RouteMockup } from "@/components/landing/feature-mockups";

const values = [
  { icon: "costs", question: "¿Cuánto me cuesta hacerlo?", text: "Materiales, mano de obra y gastos compartidos, repartidos con un criterio que puedes ver y explicar." },
  { icon: "sales", question: "¿Cuánto me deja cada venta?", text: "Por producto y por canal, con comisiones y envío. Y cuánto te falta vender en el mes para no perder." },
  { icon: "truck", question: "¿Qué sale hoy y por dónde?", text: "Cada entrega con su zona, su día y su costo; la ruta en Google Maps y la lista para el transportista." },
  { icon: "assistant", question: "¿Quién me ayuda con todo esto?", text: "Cozte registra ventas y compras desde un mensaje, un audio o una foto, y te explica qué cambió." },
] satisfies { icon: AnimatedIconName; question: string; text: string }[];

const features: { id: string; eyebrow: string; title: string; text: string; points: string[]; mockup: React.ReactNode }[] = [
  {
    id: "costos", eyebrow: "Costos de producción", title: "El costo real de cada producto, y qué pasa cuando algo cambia.",
    text: "Cuando sube un insumo no hace falta rehacer la planilla: Cozte recalcula cada producto que lo usa y te muestra cuánto cambia su margen.",
    points: ["Recetas, lotes y horas de trabajo de cada producto", "Luz, gas y alquiler repartidos por horas o por unidades, a la vista", "Simula un precio nuevo antes de que llegue la factura"], mockup: <CostsMockup />,
  },
  {
    id: "cozte", eyebrow: "Cozte AI", title: "Cuéntaselo como a un socio. Cozte lo anota, lo calcula y te lo explica.",
    text: "Escribe, dicta o manda la foto del comprobante. Cozte registra la compra o la venta, actualiza lo que corresponde y te dice qué significa para tu negocio.",
    points: ["Ventas, compras, entregas, clientes y proveedores desde la conversación", "Responde con tus números: si falta un dato, lo pregunta en vez de inventarlo", "Se adapta a ti: explica cada concepto si recién empiezas"], mockup: <CozteChatMockup />,
  },
  {
    id: "resultado", eyebrow: "Resultado y análisis", title: "Cuánto vendiste, cuánto te quedó y qué conviene mirar.",
    text: "El resultado del mes se arma solo con lo que registras: lo que dejó cada venta contra los gastos fijos, y en palabras simples lo que se destaca.",
    points: ["Resultado del mes y punto de equilibrio", "Ventas por canal, producto, día de la semana y zona de entrega", "Presentaciones listas para compartir con tu socio o tu banco"], mockup: <ResultMockup />,
  },
  {
    id: "entregas", eyebrow: "Entregas y rutas", title: "La ruta de hoy, lista en un toque.",
    text: "Cada pedido toma la zona de la dirección del cliente: quién lo lleva, qué día sale y cuánto cuesta. La ruta del día sale ordenada y se comparte con el repartidor.",
    points: ["Zonas con reparto propio, transportista o retiro en el local", "Orden de manejo, Google Maps con todas las paradas y WhatsApp", "Modo repartidor y lista de despacho con seguimiento"], mockup: <RouteMockup />,
  },
  {
    id: "clientes", eyebrow: "Clientes y proveedores", title: "Quién te compra, quién dejó de comprar y qué insumo subió.",
    text: "Tus clientes y proveedores se arman solos con lo que ya registraste. Cozte te avisa cuando alguien tarda en volver o cuando un precio se dispara.",
    points: ["Ficha de cada cliente con direcciones, compras y estado", "Precio de cada insumo en el tiempo, por proveedor", "Avisos cuando dependes de pocos o un insumo sube"], mockup: <PeopleMockup />,
  },
];

const flow = [
  { icon: "sales", text: "Registras una venta" },
  { icon: "truck", text: "Se programa la entrega con su zona y su día" },
  { icon: "chart", text: "Se actualiza el resultado del mes" },
  { icon: "users", text: "El cliente suma una compra a su ficha" },
] satisfies { icon: AnimatedIconName; text: string }[];

const steps = [
  { title: "Cuéntale a Cozte qué haces", text: "Qué produces, con qué insumos, cómo trabajas y por dónde vendes. Te pregunta lo que falta, con opciones para responder rápido." },
  { title: "Registra el día a día como te quede cómodo", text: "Un mensaje, un audio, la foto de una factura o una tabla editable. Cada dato queda con su fuente y su fecha." },
  { title: "Decide con los números a la vista", text: "Resultado del mes, entregas del día y alertas. Y cuando algo cambia, ves a qué productos y a qué margen afecta." },
];

function FeatureRow({ feature, index }: { feature: (typeof features)[number]; index: number }) {
  return <article id={feature.id} className="scroll-mt-24 grid items-center gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
    <div className={index % 2 ? "min-w-0 lg:order-2" : "min-w-0"}>
      <p className="text-xs font-semibold tracking-[0.18em] text-landing-muted uppercase">{feature.eyebrow}</p>
      <h3 className="mt-4 max-w-lg text-balance text-3xl font-semibold leading-tight tracking-[-0.045em] sm:text-4xl">{feature.title}</h3>
      <p className="mt-4 max-w-lg text-base leading-relaxed text-landing-muted">{feature.text}</p>
      <ul className="mt-6 flex max-w-lg flex-col gap-3">
        {feature.points.map((point) => <li key={point} className="flex items-start gap-3 text-sm"><span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-landing-highlight text-landing-ink"><AnimatedIcon name="check" size={12} /></span>{point}</li>)}
      </ul>
    </div>
    <div className={index % 2 ? "min-w-0 lg:order-1" : "min-w-0"}>{feature.mockup}</div>
  </article>;
}

export default function LandingPage() {
  return <div className="landing min-h-dvh bg-landing-paper text-landing-ink">
    <a href="#contenido" className="sr-only rounded-lg bg-landing-ink px-4 py-2 text-landing-paper focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50">Ir al contenido</a>
    <header className="relative z-30 px-3 pt-3 sm:px-6 sm:pt-5">
      <nav aria-label="Navegación principal" className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-2 rounded-full bg-landing-ink px-4 text-landing-paper shadow-lg shadow-landing-ink/15 sm:gap-4 sm:px-7">
        <CozteLogo href="/" className="text-2xl" />
        <div className="hidden items-center gap-8 text-sm font-medium text-landing-dark-muted md:flex">
          <a href="#valor" className="transition-colors hover:text-landing-paper">Qué resuelve</a>
          <a href="#funciones" className="transition-colors hover:text-landing-paper">Funciones</a>
          <a href="#cozte" className="transition-colors hover:text-landing-paper">Cozte AI</a>
          <a href="#como-funciona" className="transition-colors hover:text-landing-paper">Cómo funciona</a>
        </div>
        <div className="flex items-center gap-2 sm:gap-3"><Link href="/sign-in" className="rounded-full px-2 py-3 text-sm font-medium transition-colors hover:text-landing-highlight sm:px-3">Ingresar</Link><Link href="/sign-up" className="inline-flex h-10 items-center gap-1.5 rounded-full bg-landing-highlight px-4 text-sm font-semibold whitespace-nowrap text-landing-ink transition-transform hover:-translate-y-0.5 sm:px-5">Crear cuenta <AnimatedIcon name="arrowUpRight" size={16} /></Link></div>
      </nav>
    </header>

    <main id="contenido">
      <section className="landing-hero-grid relative overflow-hidden">
        <div className="landing-atmosphere" aria-hidden="true" />
        <div className="relative mx-auto flex w-full max-w-7xl flex-col items-center px-5 pt-12 pb-24 text-center sm:px-8 sm:pt-16 lg:px-10 lg:pb-32">
          <div className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-full border border-landing-line bg-landing-surface/80 px-4 py-1.5 text-xs font-medium text-landing-muted">Costos <span aria-hidden="true">·</span> Ventas <span aria-hidden="true">·</span> Entregas <span aria-hidden="true">·</span> Clientes <span aria-hidden="true">·</span> <span className="inline-flex items-center gap-1 text-landing-ink"><AnimatedIcon name="sparkles" size={13} />Cozte AI</span></div>
          <h1 className="mt-6 max-w-6xl text-balance text-[clamp(2.4rem,5vw,4.6rem)] leading-[1.03] font-semibold tracking-[-0.06em]"><span className="block text-landing-muted">Produces, vendes y entregas.</span><span className="block text-landing-ink">Cozte te muestra cuánto ganas.</span></h1>
          <p className="mt-6 max-w-2xl text-pretty text-base leading-relaxed text-landing-muted sm:text-lg">El costo real de cada producto, lo que deja cada venta, las entregas del día y el resultado del mes, en un solo lugar. Cuéntale a Cozte lo que pasó —o mándale la foto del comprobante— y tus números se ponen al día solos.</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3"><Link href="/sign-up" className="inline-flex h-12 items-center gap-2 rounded-full bg-landing-ink px-6 text-sm font-semibold text-landing-paper transition-transform hover:-translate-y-0.5">Empezar con Cozte <AnimatedIcon name="arrowUpRight" size={16} /></Link><Link href="/demo" className="inline-flex h-12 items-center gap-2 rounded-full border border-landing-line bg-landing-surface px-6 text-sm font-semibold transition-colors hover:bg-landing-highlight">Explorar la demo <AnimatedIcon name="arrowRight" size={16} /></Link></div>
          <div className="mt-6 flex items-center gap-2 text-xs text-landing-muted"><AnimatedIcon name="check" size={16} className="text-landing-ink" /> Para emprendimientos y PyMEs que fabrican y venden · la demo no pide registrarte</div>
          <div className="relative mt-14 w-full max-w-5xl text-left sm:mt-20">
            <HeroMockup />
            <div className="landing-float absolute top-40 -left-44 hidden w-52 rounded-2xl border border-landing-line/80 bg-landing-surface/90 p-4 shadow-xl shadow-landing-ink/10 backdrop-blur-2xl xl:block"><p className="text-[11px] font-medium tracking-[0.1em] text-landing-muted uppercase">Proveedores</p><p className="mt-1 text-sm font-semibold">Papel interior ▲ 15 %</p><p className="mt-1 text-xs text-landing-muted">Cozte te avisa y recalcula tus cuadernos</p></div>
            <div className="landing-float-delayed absolute -right-40 bottom-24 hidden w-52 rounded-2xl border border-landing-line/80 bg-landing-surface/90 p-4 shadow-xl shadow-landing-ink/10 backdrop-blur-2xl xl:block"><div className="flex items-center justify-between text-[11px] text-landing-muted"><span>Entregas de hoy</span><AnimatedIcon name="truck" size={16} className="text-landing-ink" /></div><p className="mt-1 text-sm font-semibold">Ruta lista: 3 paradas</p><p className="mt-1 text-xs text-landing-muted">En Google Maps y por WhatsApp</p></div>
            <p className="mt-5 text-center text-[11px] text-landing-muted">Vista real de Cozte con los datos de ejemplo de Taller Norte</p>
          </div>
        </div>
      </section>

      <section id="valor" className="scroll-mt-24 border-y border-landing-line bg-landing-surface">
        <div className="mx-auto w-full max-w-7xl px-5 py-20 sm:px-8 lg:px-10 lg:py-28">
          <p className="text-xs font-semibold tracking-[0.18em] text-landing-muted uppercase">Qué resuelve</p>
          <h2 className="mt-4 max-w-3xl text-balance text-4xl font-semibold leading-tight tracking-[-0.05em] sm:text-5xl">Las preguntas de todos los días, respondidas con tus números.</h2>
          <div className="mt-12 grid gap-px overflow-hidden rounded-[28px] border border-landing-line bg-landing-line sm:grid-cols-2 lg:grid-cols-4">
            {values.map((value) => <article key={value.question} className="flex flex-col gap-4 bg-landing-surface p-7 transition-colors hover:bg-landing-highlight/25">
              <span className="flex size-11 items-center justify-center rounded-xl bg-landing-paper text-landing-ink"><AnimatedIcon name={value.icon} size={20} /></span>
              <h3 className="text-lg font-semibold tracking-tight">{value.question}</h3>
              <p className="text-sm leading-relaxed text-landing-muted">{value.text}</p>
            </article>)}
          </div>
          <ol className="mt-10 grid gap-3 md:grid-cols-4" aria-label="Todo conectado">
            {flow.map((item, index) => <li key={item.text} className="relative flex items-center gap-3 rounded-2xl border border-landing-line bg-landing-paper px-4 py-3 text-sm">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-landing-ink text-landing-paper"><AnimatedIcon name={item.icon} size={16} /></span>
              <span><span className="block font-mono text-[10px] text-landing-muted">0{index + 1}</span>{item.text}</span>
              {index < flow.length - 1 ? <span className="absolute top-1/2 -right-3 z-10 hidden size-6 -translate-y-1/2 items-center justify-center rounded-full bg-landing-highlight text-landing-ink md:flex" aria-hidden="true"><AnimatedIcon name="arrowRight" size={13} /></span> : null}
            </li>)}
          </ol>
          <p className="mt-4 text-sm text-landing-muted">Todo está conectado: registras una vez y cada sección se entera.</p>
        </div>
      </section>

      <section id="funciones" className="scroll-mt-24 mx-auto w-full max-w-7xl px-5 py-20 sm:px-8 lg:px-10 lg:py-28">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div><p className="text-xs font-semibold tracking-[0.18em] text-landing-muted uppercase">Dentro de Cozte</p><h2 className="mt-4 max-w-2xl text-balance text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">Todo tu negocio, en una sola vista clara.</h2></div>
          <Link href="/demo" className="inline-flex items-center gap-2 text-sm font-semibold underline underline-offset-4 hover:opacity-70">Probarlo en la demo <AnimatedIcon name="arrowUpRight" size={16} /></Link>
        </div>
        <div className="mt-16 flex flex-col gap-24 lg:gap-32">{features.map((feature, index) => <FeatureRow key={feature.id} feature={feature} index={index} />)}</div>
        <div className="mt-16 flex flex-wrap gap-2 text-xs font-medium text-landing-muted">
          {["Monedas de Latinoamérica y más", "Funciona en el celular", "Cada dato con su fuente y su fecha", "Historial de cada cambio", "Descarga todo en Excel"].map((item) => <span key={item} className="rounded-full border border-landing-line px-3 py-2">{item}</span>)}
        </div>
      </section>

      <section id="como-funciona" className="scroll-mt-24 border-y border-landing-line bg-landing-surface">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-5 py-20 sm:px-8 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20 lg:px-10 lg:py-28">
          <div><p className="text-xs font-semibold tracking-[0.18em] text-landing-muted uppercase">Cómo funciona</p><h2 className="mt-4 max-w-md text-balance text-4xl font-semibold leading-tight tracking-[-0.05em] sm:text-5xl">Empiezas con lo que sabes. Cozte ordena el resto.</h2><p className="mt-5 max-w-md text-base leading-relaxed text-landing-muted">No necesitas tener todo resuelto el primer día. Cozte te guía, señala lo que falta medir y nunca convierte un dato desconocido en cero.</p></div>
          <div className="divide-y divide-landing-line border-t border-landing-line">
            {steps.map((step, index) => <div key={step.title} className="grid grid-cols-[2.5rem_1fr] gap-4 py-6 sm:grid-cols-[3rem_1fr]"><span className="font-mono text-xs text-landing-muted">0{index + 1}</span><div><h3 className="text-lg font-semibold">{step.title}</h3><p className="mt-2 max-w-xl text-sm leading-relaxed text-landing-muted">{step.text}</p></div></div>)}
          </div>
        </div>
      </section>

      <section id="aprender" className="scroll-mt-24 bg-landing-ink text-landing-paper">
        <div className="mx-auto grid w-full max-w-7xl gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[1fr_0.9fr] lg:items-center lg:gap-24 lg:px-10 lg:py-28">
          <div><p className="inline-flex items-center gap-2 text-xs font-semibold tracking-[0.18em] text-landing-highlight uppercase"><span className="size-1.5 rounded-full bg-landing-highlight" /> Aprender haciendo</p><h2 className="mt-5 max-w-xl text-balance text-4xl font-semibold tracking-[-0.055em] sm:text-5xl">Un número sirve. Saber de dónde sale, mucho más.</h2><p className="mt-6 max-w-lg text-base leading-relaxed text-landing-dark-muted">La diferencia entre comprar y consumir, lo que deja una venta después de sus costos o por qué un gasto se reparte: Cozte te lo explica con tus propios números, al nivel que elijas.</p><Link href="/sign-up" className="mt-8 inline-flex h-11 items-center gap-2 rounded-full bg-landing-highlight px-5 text-sm font-semibold text-landing-ink transition-transform hover:-translate-y-0.5">Empieza a entender tu negocio <AnimatedIcon name="arrowUpRight" size={16} /></Link></div>
          <div className="rounded-[28px] border border-landing-paper/15 bg-landing-paper/5 p-5 sm:p-8">
            <p className="text-xs font-medium tracking-[0.16em] text-landing-dark-muted uppercase">Preguntas que ahora puedes responder</p>
            <div className="mt-6 divide-y divide-landing-paper/15 border-t border-landing-paper/15">
              {["¿Cuánto cuesta fabricar y empacar cada variante?", "¿Qué canal me deja más después de comisiones y envío?", "¿Cuánto tengo que vender este mes para no perder?", "¿Qué cliente dejó de comprar y qué insumo subió?"].map((question) => <div key={question} className="flex items-start gap-4 py-5 text-base sm:text-lg"><AnimatedIcon name="arrowDownRight" size={20} className="mt-0.5 text-landing-highlight" /> {question}</div>)}
            </div>
            <p className="mt-5 text-xs leading-relaxed text-landing-dark-muted">Y si falta información, Cozte la señala. Un dato desconocido no se convierte en cero.</p>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-5 py-20 sm:px-8 lg:px-10 lg:py-28">
        <div className="flex flex-col items-start justify-between gap-8 rounded-[30px] bg-landing-highlight px-7 py-10 sm:px-10 lg:flex-row lg:items-end lg:px-14 lg:py-14">
          <div><p className="text-xs font-semibold tracking-[0.18em] uppercase">¿Empezamos?</p><h2 className="mt-4 max-w-2xl text-balance text-4xl font-semibold leading-tight tracking-[-0.055em] sm:text-5xl">Haz visible lo que cuesta, lo que vendes y lo que te queda.</h2></div>
          <div className="flex shrink-0 flex-wrap gap-3"><Link href="/sign-up" className="inline-flex h-12 items-center gap-3 rounded-full bg-landing-ink px-6 text-sm font-semibold text-landing-paper transition-transform hover:-translate-y-0.5">Crear mi cuenta <AnimatedIcon name="arrowUpRight" size={16} /></Link><Link href="/demo" className="inline-flex h-12 items-center gap-2 rounded-full border border-landing-ink/20 px-6 text-sm font-semibold transition-colors hover:bg-landing-ink/5">Ver la demo</Link></div>
        </div>
      </section>
    </main>

    <footer className="border-t border-landing-line"><div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 py-8 text-sm text-landing-muted sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-10"><div className="flex items-center gap-2.5"><CozteLogo className="text-xl text-landing-ink" /><span>· Números claros para producir, vender y crecer.</span></div><div className="flex flex-wrap gap-5"><Link href="/demo" className="hover:text-landing-ink">Demo</Link><Link href="/sign-in" className="hover:text-landing-ink">Ingresar</Link><span>cozte.com</span></div></div></footer>
  </div>;
}
