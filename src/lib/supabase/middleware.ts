import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

const allowedOrigins = [
  "https://iffygiftyday.vercel.app",
  "https://main.d37yd0e7u56dxt.amplifyapp.com",
  "http://localhost:3000",
];

const corsOptions = {
  "Access-Control-Allow-Methods": "GET",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  // Check the origin from the request
  const origin = request.headers.get("origin") ?? "";
  const isAllowedOrigin = allowedOrigins.includes(origin);

  if (isAllowedOrigin) {
    supabaseResponse.headers.set("Access-Control-Allow-Origin", origin);
  }

  for (const [key, value] of Object.entries(corsOptions)) {
    supabaseResponse.headers.set(key, value);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase URL or Anon Key");
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // biome-ignore lint/complexity/noForEach: <explanation>
        cookiesToSet.forEach(({ name, value, options }) =>
          request.cookies.set(name, value)
        );
        supabaseResponse = NextResponse.next({
          request,
        });
        // biome-ignore lint/complexity/noForEach: <explanation>
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // refreshing the auth token
  // const {
  // 	data: { user },
  // } = await supabase.auth.getUser();

  // console.log("user =====>", user);

  // if (!user) {
  // 	const url = request.nextUrl.clone();
  // 	url.pathname = "/signin";
  // 	return NextResponse.redirect(url);
  // }

  return supabaseResponse;
}
