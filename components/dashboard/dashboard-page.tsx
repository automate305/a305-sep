import { DashboardLock } from "@/components/dashboard/dashboard-lock";
import { OutreachDashboard, type DashboardView } from "@/components/dashboard/outreach-dashboard";
import {
  dashboardAccessIsConfigured,
  hasDashboardAccess,
} from "@/lib/services/dashboard-auth";
import { getContactsData, getDashboardData } from "@/lib/services/dashboard";

export async function DashboardPage({ view }: { view: DashboardView }) {
  if (!(await hasDashboardAccess())) return <DashboardLock configured={dashboardAccessIsConfigured()} />;

  const dashboardData = await getDashboardData();
  const contacts = view === "contacts" ? await getContactsData() : [];
  const dashboardDate = new Intl.DateTimeFormat("en-US", {
    day: "numeric", month: "long", timeZone: "America/New_York", weekday: "long",
  }).format(new Date(dashboardData.generatedAt)).toUpperCase();

  return <OutreachDashboard contacts={contacts} dashboardData={dashboardData} dashboardDate={dashboardDate} view={view} />;
}
