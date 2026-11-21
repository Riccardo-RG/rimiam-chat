import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/server/auth";
import { nativeSocialRedirect } from "@/server/native-social";
const identity = toNextJsHandler(auth);
export async function GET(request: Request) {
  return nativeSocialRedirect(request, await identity.GET(request));
}
export async function POST(request: Request) {
  return nativeSocialRedirect(request, await identity.POST(request));
}
