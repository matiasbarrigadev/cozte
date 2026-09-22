import { ClerkProvider } from "@clerk/nextjs";
import { shadcn } from "@clerk/ui/themes";
import type { Metadata } from "next";
import { Geist, Geist_Mono, Manrope } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://cozte.com"),
  title: "Cozte | Entiende cuánto te cuesta producir",
  description: "Costos de producción claros para emprendimientos y PyMEs manufactureras. Organiza tus productos, entiende tus números y decide con más información.",
  icons: {
    icon: [{ url: "/cozte-mark.svg", type: "image/svg+xml" }],
    shortcut: "/cozte-mark.svg",
  },
  openGraph: {
    title: "Cozte | Entiende cuánto te cuesta producir",
    description: "Una forma más clara de conocer, actualizar y entender tus costos de producción.",
    url: "https://cozte.com",
    siteName: "Cozte",
    locale: "es_LA",
    type: "website",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const clerkReady = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} ${manrope.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {clerkReady ? <ClerkProvider appearance={{ theme: shadcn }} signInFallbackRedirectUrl="/app" signUpFallbackRedirectUrl="/app">{children}<Toaster richColors position="bottom-right" /></ClerkProvider>
          : <>{children}<Toaster richColors position="bottom-right" /></>}
      </body>
    </html>
  );
}
