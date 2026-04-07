import { refreshAccessToken } from "@/lib/spotify";
import { cookies } from "next/headers";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const trackId = url.searchParams.get("trackId");

  if (!trackId) {
    return Response.json({ error: "Missing trackId" }, { status: 400 });
  }

  const cookieStore = await cookies();
  let accessToken = cookieStore.get("spotify_access_token")?.value;
  const refreshToken = cookieStore.get("spotify_refresh_token")?.value;

  if (!accessToken && refreshToken) {
    const data = await refreshAccessToken(refreshToken);
    if (!data.error) {
      accessToken = data.access_token;
      cookieStore.set("spotify_access_token", data.access_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        maxAge: data.expires_in,
        path: "/",
      });
    }
  }

  if (!accessToken) {
    return Response.json({ authenticated: false }, { status: 401 });
  }

  // Get audio features (energy, danceability, valence, tempo)
  const featuresRes = await fetch(
    `https://api.spotify.com/v1/audio-features/${trackId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  // Get audio analysis (beats, segments with loudness/pitch)
  const analysisRes = await fetch(
    `https://api.spotify.com/v1/audio-analysis/${trackId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!featuresRes.ok || !analysisRes.ok) {
    // Audio analysis might not be available for all tracks
    // Return what we can
    const features = featuresRes.ok ? await featuresRes.json() : null;
    const analysis = analysisRes.ok ? await analysisRes.json() : null;
    return Response.json({ features, analysis });
  }

  const [features, analysis] = await Promise.all([
    featuresRes.json(),
    analysisRes.json(),
  ]);

  return Response.json({ features, analysis });
}
