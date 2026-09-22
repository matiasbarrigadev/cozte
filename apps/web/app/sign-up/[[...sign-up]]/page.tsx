import { SignUp } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { CozteLogo } from "@/components/cozte-logo";

export default function SignUpPage() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY) redirect("/demo");
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6">
      <CozteLogo href="/" className="text-3xl text-foreground" />
      <SignUp fallbackRedirectUrl="/app" signInFallbackRedirectUrl="/app" />
    </div>
  );
}
