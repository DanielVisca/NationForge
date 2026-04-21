"use client";

import { Suspense } from "react";

import NationForgeBoard from "@/components/nationforge/NationForgeBoard";

export default function NationForgeSessionPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-sm text-zinc-500">Loading…</div>
      }
    >
      <NationForgeBoard />
    </Suspense>
  );
}
