import api from "@/apis/axios";
import type { GenResponse } from "@/types/iffy.types";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(
	request: NextRequest,
): Promise<NextResponse<GenResponse>> {
	const searchParams = request.nextUrl.searchParams;
	const query = searchParams.get("id");

	if (!query) {
		return NextResponse.json(
			{ status: "error", message: "No id provided" },
			{ status: 400 },
		);
	}

	// 원본 요청에서 쿠키 헤더 가져오기
	const cookieHeader = request.headers.get("cookie");

	// Fire-and-Forget 요청 시 쿠키 헤더 전달
	try {
		await api.get(`/api/backtask?id=${query}`, {
			headers: {
				// 쿠키 헤더가 있는 경우에만 추가
				...(cookieHeader && { Cookie: cookieHeader }),
			},
		});
	} catch (error) {
		console.error("Error calling /api/backtask:", error);
		// 백그라운드 작업 호출 실패 시에도 일단 202를 반환할지,
		// 아니면 에러를 반환할지 정책에 따라 결정해야 합니다.
		// 여기서는 일단 로그만 남기고 기존 로직대로 진행합니다.
	}

	return NextResponse.json(
		{ status: "success", message: "IFFY 생성 요청 전달" },
		{ status: 202 },
	);
}
