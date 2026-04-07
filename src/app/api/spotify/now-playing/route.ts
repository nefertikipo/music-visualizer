import { refreshAccessToken } from "@/lib/spotify";
import { cookies } from "next/headers";

export async function GET() {
  const cookieStore = await cookies();
  let accessToken = cookieStore.get("spotify_access_token")?.value;
  const refreshToken = cookieStore.get("spotify_refresh_token")?.value;

  if (!accessToken && !refreshToken) {
    return Response.json({ authenticated: false }, { status: 401 });
  }

  if (!accessToken && refreshToken) {
    const data = await refreshAccessToken(refreshToken);
    if (data.error) {
      return Response.json({ authenticated: false }, { status: 401 });
    }
    accessToken = data.access_token;
    cookieStore.set("spotify_access_token", data.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: data.expires_in,
      path: "/",
    });
  }

  const res = await fetch(
    "https://api.spotify.com/v1/me/player/currently-playing",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (res.status === 204) {
    return Response.json({ playing: false });
  }

  if (res.status === 401 && refreshToken) {
    const data = await refreshAccessToken(refreshToken);
    if (data.error) {
      return Response.json({ authenticated: false }, { status: 401 });
    }
    cookieStore.set("spotify_access_token", data.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: data.expires_in,
      path: "/",
    });

    const retry = await fetch(
      "https://api.spotify.com/v1/me/player/currently-playing",
      {
        headers: { Authorization: `Bearer ${data.access_token}` },
      }
    );
    if (retry.status === 204) {
      return Response.json({ playing: false });
    }
    const retryData = await retry.json();
    return Response.json(retryData);
  }

  if (!res.ok) {
    return Response.json({ error: "Spotify error" }, { status: res.status });
  }

  const playbackData = await res.json();
  return Response.json(playbackData);
}
