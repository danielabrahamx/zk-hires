import { NextResponse } from "next/server";

import { lookupCredential } from "@/trace/store";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;

  const credential = lookupCredential(code);

  if (!credential) {
    return NextResponse.json(
      { error: "Credential not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    public_claims: credential.public_claims,
    issued_at: credential.issued_at,
    expires_at: credential.expires_at,
  });
}
