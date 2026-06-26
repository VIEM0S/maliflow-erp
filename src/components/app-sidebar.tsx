import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Boxes,
  ClipboardList,
  Users,
  Truck,
  HandCoins,
  Wallet,
  FileText,
  BarChart3,
  Settings,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useT } from "@/lib/i18n";
import type { AppRole } from "@/hooks/use-tenant";

interface NavItem {
  key: string;
  label: string;
  to: string;
  icon: typeof LayoutDashboard;
  roles?: AppRole[];
}

export function AppSidebar({ tenantName, role }: { tenantName: string; role: AppRole }) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const t = useT();
  const pathname = useRouterState({ select: (r) => r.location.pathname });

  const main: NavItem[] = [
    { key: "dashboard", label: t("nav.dashboard"), to: "/dashboard", icon: LayoutDashboard },
    { key: "sales", label: t("nav.sales"), to: "/sales", icon: ShoppingCart },
    { key: "quotes", label: t("nav.quotes"), to: "/quotes", icon: FileText, roles: ["owner", "manager"] },
    { key: "products", label: t("nav.products"), to: "/products", icon: Package, roles: ["owner", "manager"] },
    { key: "inventory", label: t("nav.inventory"), to: "/inventory", icon: Boxes, roles: ["owner", "manager"] },
    { key: "inventory-counts", label: t("nav.inventoryCounts"), to: "/inventory-counts", icon: ClipboardList, roles: ["owner", "manager"] },
  ];
  const ops: NavItem[] = [
    { key: "customers", label: t("nav.customers"), to: "/customers", icon: Users, roles: ["owner", "manager"] },
    { key: "suppliers", label: t("nav.suppliers"), to: "/suppliers", icon: Truck, roles: ["owner", "manager"] },
    { key: "credits", label: t("nav.credits"), to: "/credits", icon: HandCoins, roles: ["owner", "manager"] },
    { key: "cash", label: t("nav.cash"), to: "/cash", icon: Wallet },
  ];
  const adv: NavItem[] = [
    { key: "analytics", label: t("nav.analytics"), to: "/analytics", icon: BarChart3, roles: ["owner"] },
    { key: "settings", label: t("nav.settings"), to: "/settings", icon: Settings, roles: ["owner"] },
  ];

  const canSee = (item: NavItem) => !item.roles || item.roles.includes(role) || role === "super_admin";
  const isActive = (to: string) => pathname === to || pathname.startsWith(to + "/");

  return (
    <Sidebar collapsible="icon" className="border-r-0">
      <SidebarHeader className="border-b border-sidebar-border px-3 py-4">
        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground font-bold">α</div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-sidebar-foreground">{tenantName}</p>
              <p className="text-[10px] uppercase tracking-wider text-sidebar-foreground/60">Alpha ERP</p>
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent className="px-2 py-3">
        {[
          { label: "Opérations", items: main },
          { label: "Gestion", items: ops },
          { label: "Administration", items: adv },
        ].map((group) => {
          const visible = group.items.filter(canSee);
          if (visible.length === 0) return null;
          return (
            <SidebarGroup key={group.label}>
              {!collapsed && <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-sidebar-foreground/50">{group.label}</SidebarGroupLabel>}
              <SidebarGroupContent>
                <SidebarMenu>
                  {visible.map((item) => (
                    <SidebarMenuItem key={item.key}>
                      <SidebarMenuButton asChild isActive={isActive(item.to)} tooltip={item.label}>
                        <Link to={item.to} className="flex items-center gap-2.5">
                          <item.icon className="h-4 w-4 shrink-0" />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>
    </Sidebar>
  );
}