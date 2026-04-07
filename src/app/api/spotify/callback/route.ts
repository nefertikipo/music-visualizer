import { exchangeCode } from "@/lib/spotify";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  if (!code) {
    return Response.json({ error: "Missing code" }, { status: 400 });
  }

  const data = await exchangeCode(code);

  if (data.error) {
    return Response.json({ error: data.error }, { status: 400 });
  }

  const cookieStore = await cookies();

  cookieStore.set("spotify_access_token", data.access_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: data.expires_in,
    path: "/",
  });

  cookieStore.set("spotify_refresh_token", data.refresh_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });

  redirect("/");
}
