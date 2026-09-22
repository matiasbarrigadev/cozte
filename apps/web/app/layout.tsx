import { ClerkProvider } from "@clerk/nextjs";
import { shadcn } from "@clerk/ui/themes";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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

export const metadata: Metadata = {
  title: "Cozte | Costeo vivo para manufactura",
  description: "Conoce el costo de cada producto y mantén tus decisiones al día.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const clerkReady = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {clerkReady ? <ClerkProvider appearance={{ theme: shadcn }}>{children}<Toaster richColors position="bottom-right" /></ClerkProvider>
          : <>{children}<Toaster richColors position="bottom-right" /></>}
      </body>
    </html>
  );
}
