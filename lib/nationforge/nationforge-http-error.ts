import { NextResponse } from "next/server";

const EXPOSE_ERROR_DETAIL =
  process.env.NODE_ENV === "development" ||
  process.env.VERCEL_ENV === "development" ||
  process.env.VERCEL_ENV === "preview";

function exposeMessageToClient(message: string): boolean {
  return EXPOSE_ERROR_DETAIL || message.startsWith("NationForge:");
}

/**
 * JSON error for NationForge API routes. Logs full error server-side; includes
 * the driver message on dev / preview, and curated NationForge: hints in production.
 */
export function nationforgeErrorResponse(
  code: string,
  err: unknown,
  status = 500,
): NextResponse {
  const errObj = err instanceof Error ? err : new Error(String(err));
  console.error(`[nationforge] ${code}`, errObj);

  const show = exposeMessageToClient(errObj.message);
  return NextResponse.json(
    {
      error: show ? errObj.message : "NationForge request failed",
      code,
      ...(EXPOSE_ERROR_DETAIL ? { message: errObj.message } : {}),
    },
    { status },
  );
}
