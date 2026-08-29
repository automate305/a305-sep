// Server component: loads real Supabase read models server-side (service
// role key never reaches the browser) and hands plain props to the client
// dashboard. force-dynamic — this is a live operational view, never cached.

import { RevenueRescueDashboard } from "@/components/RevenueRescueDashboard";
import { loadDashboardData } from "@/lib/dashboard-data";

export const dynamic = "force-dynamic";

export default async function Home() {
  const data = await loadDashboardData();

  const dashboardDate = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    timeZone: "America/New_York",
    weekday: "long",
  })
    .format(new Date())
    .toUpperCase();

  return <RevenueRescueDashboard dashboardDate={dashboardDate} data={data} />;
}
