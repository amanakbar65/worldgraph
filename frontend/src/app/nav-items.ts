import { Briefcase, Globe2, Lightbulb, Network, Newspaper, Users, type LucideIcon } from "lucide-react";

import type { View } from "@/state/nav";

export const NAV_ITEMS: { view: View; label: string; icon: LucideIcon; mobile: boolean }[] = [
  { view: "globe", label: "Globe", icon: Globe2, mobile: true },
  { view: "graph", label: "Graph", icon: Network, mobile: true },
  { view: "forecasts", label: "Forecasts", icon: Users, mobile: true },
  { view: "opportunities", label: "Opportunities", icon: Lightbulb, mobile: false },
  { view: "business", label: "My Business", icon: Briefcase, mobile: true },
  { view: "brief", label: "Brief", icon: Newspaper, mobile: false },
];
