import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { signUp, signUpProblem } from "@/lib/sign-up";

// Signing up (lib/sign-up.ts): the answer is the same whether or not the address has an account.
export async function POST(request: Request): Promise<Response> {
  try {
    await signUp(await auth(), await env(), request);
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return signUpProblem(error);
  }
}
