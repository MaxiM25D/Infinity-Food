import type { Metadata } from "next";

import { KdsBoard } from "@/components/kds/kds-board";

export const metadata: Metadata = { title: "KDS · InfinityFood", robots: { index: false, follow: false } };

export default function KdsPage() {
  return <KdsBoard />;
}
