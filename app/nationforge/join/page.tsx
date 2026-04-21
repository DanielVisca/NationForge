"use client";

import { Suspense } from "react";

import JoinNationForgeInner from "./JoinNationForgeInner";

export default function JoinNationForgePage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-sm text-zinc-500">Loading…</div>
      }
    >
      <JoinNationForgeInner />
    </Suspense>
  );
}
