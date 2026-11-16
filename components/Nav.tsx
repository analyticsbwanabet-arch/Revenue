"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import type { UserRole } from "@/lib/auth";

const navItems = [
  { href: "/entry", label: "Daily Entry", icon: "📝", ownerOnly: false },
  { href: "/calendar", label: "Calendar", icon: "📅", ownerOnly: false },
  { href: "/monthly", label: "Monthly Summary", icon: "📊", ownerOnly: true },
  { href: "/sync", label: "Payroll Sync", icon: "🔁", ownerOnly: false },
  { href: "/manage", label: "Manage", icon: "⚙️", ownerOnly: true },
];

export default function Nav({ userRole }: { userRole: UserRole }) {
  const pathname = usePathname();
  const owner = userRole.is_owner || userRole.is_super_admin;
  return (
    <header className="border-b px-4 sm:px-7 py-3 flex justify-between items-center flex-wrap gap-3"
      style={{ background: "#0f0f0f", borderColor: "#2a2a2a" }}>
      <div className="flex items-center gap-3">
        <Image src="/logo.png" alt="BwanaBet" width={44} height={44} className="rounded-xl" style={{ border: "2px solid #facc15" }} />
        <div>
          <div className="text-[17px] font-bold tracking-tight" style={{ color: "#facc15" }}>BwanaBet</div>
          <div className="text-[11px]" style={{ color: "#636363" }}>Daily Revenue • Zambia</div>
        </div>
      </div>
      <nav className="flex gap-1 rounded-[10px] p-1 flex-wrap" style={{ background: "#0a0a0a", border: "1px solid #2a2a2a" }}>
        {navItems.filter((i) => !i.ownerOnly || owner).map((item) => {
          const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link key={item.href} href={item.href}
              className="px-3.5 py-2 rounded-lg text-[13px] font-medium transition-all"
              style={{ background: active ? "#22c55e" : "transparent", color: active ? "#000" : "#a3a3a3" }}>
              {item.icon} {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="flex items-center gap-3">
        <div className="text-right">
          <div className="text-[12px] font-medium" style={{ color: "#f5f5f5" }}>{userRole.display_name}</div>
          <div className="text-[10px]" style={{ color: userRole.is_owner ? "#ff6b6b" : userRole.read_only ? "#22d3ee" : userRole.is_super_admin ? "#facc15" : "#22c55e" }}>
            {userRole.is_owner ? "👑 Owner" : userRole.read_only ? "📋 Read Only" : userRole.is_super_admin ? "⭐ Super Admin" : "🏢 Branch Manager"}
          </div>
        </div>
        <form action="/auth/signout" method="post">
          <button type="submit" className="px-3 py-1.5 rounded-lg text-[11px] font-medium"
            style={{ background: "#1c1c1c", color: "#a3a3a3", border: "1px solid #2a2a2a" }}>Sign Out</button>
        </form>
      </div>
    </header>
  );
}
