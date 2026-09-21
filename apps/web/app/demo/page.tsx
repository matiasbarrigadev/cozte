import { CostosApp } from "@/components/costos-app";
import { demoDashboard } from "@/lib/demo";

export default function Demo() {
  return <CostosApp initial={demoDashboard} demo />;
}
