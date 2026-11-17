import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";
import { getCurrentUser } from "@/lib/auth";
import { AuthProvider } from "@/lib/auth-context";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "BwanaBet Revenue",
  description: "Daily store revenue system for BwanaBet Zambia",
  icons: { icon: "/favicon.ico", apple: "/apple-touch-icon.png" },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { role } = await getCurrentUser();
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {role && <Nav userRole={role} />}
        <AuthProvider initialRole={role}>
          <main className="max-w-[1360px] mx-auto px-4 sm:px-7 py-6">{children}</main>
        </AuthProvider>
        {role && (
          <footer className="max-w-[1360px] mx-auto px-7 pb-8 pt-4 flex justify-between flex-wrap gap-2 text-[11px]"
            style={{ borderTop: "1px solid #23272e", color: "#6b7280" }}>
            <span>BwanaBet Daily Revenue System</span>
            <span>Amounts in Kwacha (K) • Dates dd/mm/yyyy</span>
          </footer>
        )}
      </body>
    </html>
  );
}
