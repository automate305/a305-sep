import { DashboardPage } from "@/components/dashboard/dashboard-page";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  return <DashboardPage view="overview" />;
}
