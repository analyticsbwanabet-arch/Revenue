"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import type { UserRole } from "@/lib/auth";

const navItems = [
  { href: "/entry", label: "Daily Entry", icon: "", ownerOnly: false },
  { href: "/calendar", label: "Calendar", icon: "", ownerOnly: false },
  { href: "/monthly", label: "Monthly Summary", icon: "", ownerOnly: true },
  { href: "/sync", label: "Payroll Sync", icon: "", ownerOnly: false },
  { href: "/manage", label: "Manage", icon: "", ownerOnly: true },
];

export default function Nav({ userRole }: { userRole: UserRole }) {
  const pathname = usePathname();
  const owner = userRole.is_owner || userRole.is_super_admin;
  return (
    <header className="border-b px-4 sm:px-7 py-3 flex justify-between items-center flex-wrap gap-3"
      style={{ background: "#0e1114", borderColor: "#23272e" }}>
      <div className="flex items-center gap-3">
        <Image src="/logo.png" alt="BwanaBet" width={44} height={44} className="rounded-lg" style={{ border: "1px solid #23272e" }} />
        <div>
          <div className="text-[17px] font-semibold tracking-tight" style={{ color: "#e6e8eb" }}>BwanaBet</div>
          <div className="text-[11px]" style={{ color: "#6b7280" }}>Daily Revenue • Zambia</div>
        </div>
      </div>
      <nav className="flex gap-1 rounded-[10px] p-1 flex-wrap" style={{ background: "#0b0d10", border: "1px solid #23272e" }}>
        {navItems.filter((i) => !i.ownerOnly || owner).map((item) => {
          const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          return (
            <Link key={item.href} href={item.href}
              className="px-3.5 py-2 rounded-lg text-[13px] font-medium transition-all"
              style={{ background: active ? "#1f242b" : "transparent", color: active ? "#e6e8eb" : "#9aa0a8", borderBottom: active ? "2px solid #c9a227" : "2px solid transparent", borderRadius: 6 }}>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="flex items-center gap-3">
        <div className="text-right">
          <div className="text-[12px] font-medium" style={{ color: "#e6e8eb" }}>{userRole.display_name}</div>
          <div className="text-[10px]" style={{ color: "#6b7280" }}>
            {userRole.is_owner ? "Owner" : userRole.read_only ? "Read Only" : userRole.is_super_admin ? "Super Admin" : "Branch Manager"}
          </div>
        </div>
        <form action="/auth/signout" method="post">
          <button type="submit" className="px-3 py-1.5 rounded-lg text-[11px] font-medium"
            style={{ background: "#181c21", color: "#9aa0a8", border: "1px solid #23272e" }}>Sign Out</button>
        </form>
      </div>
    </header>
  );
}
