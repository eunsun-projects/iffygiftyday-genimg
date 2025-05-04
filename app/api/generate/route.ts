import api from "@/apis/axios";
import type { GenResponse } from "@/types/iffy.types";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest
): Promise<NextResponse<GenResponse>> {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("id");

  if (!query) {
    return NextResponse.json(
      { status: "error", message: "No id provided" },
      { status: 400 }
    );
  }

  // 원본 요청에서 쿠키 헤더 가져오기
  const cookieHeader = request.headers.get("cookie");

  // Fire-and-Forget 요청 시 쿠키 헤더 전달
  api.get(`/api/backtask?id=${query}`, {
    headers: {
      // 쿠키 헤더가 있는 경우에만 추가
      ...(cookieHeader && { Cookie: cookieHeader }),
    },
  });

  return NextResponse.json(
    { status: "success", message: "IFFY 생성 요청 전달" },
    { status: 202 }
  );
}
