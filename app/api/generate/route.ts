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

  // Fire-and-Forget 요청 시도 및 오류 로깅
  try {
    console.log(`[generate] Attempting to call backtask for id: ${query}`);
    // api.get은 Promise를 반환하므로 await를 붙이지 않아도 비동기 실행됨
    // 하지만 에러를 잡기 위해 아래처럼 처리 가능
    api
      .get(`/api/backtask?id=${query}`, {
        headers: {
          // 쿠키 헤더가 있는 경우에만 추가
          ...(cookieHeader && { Cookie: cookieHeader }),
        },
      })
      .catch((error) => {
        // 백그라운드 요청 실패 시 에러 로깅 (응답에는 영향 없음)
        console.error(
          `[generate] Error calling backtask for id: ${query}`,
          error.code || error.message, // ECONNRESET 같은 코드 로깅
          error?.response?.status, // 응답 상태 코드 (있다면)
          error?.config?.url // 요청 URL
        );
      });
    console.log(`[generate] Backtask call initiated for id: ${query}`);
  } catch (error) {
    // 동기적인 오류 발생 시 (거의 발생 안 함)
    console.error(
      `[generate] Synchronous error initiating backtask call for id: ${query}`,
      error
    );
  }

  // 요청 수락 응답 즉시 반환
  return NextResponse.json(
    { status: "success", message: "IFFY 생성 요청 전달" },
    { status: 202 }
  );
}
