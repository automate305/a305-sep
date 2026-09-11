import { DashboardPage } from "@/components/dashboard/dashboard-page";

export const dynamic = "force-dynamic";

export default async function SequencesPage() {
  return <DashboardPage view="sequences" />;
}
