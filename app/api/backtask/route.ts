import { getIffy, saveIffy } from "@/lib/db/queries";
import { createClient } from "@/lib/supabase/server";
import { generateUUID } from "@/lib/utils";
import type { Iffy } from "@/types/iffy.types";
import { type NextRequest, NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";
import sharp from "sharp";

export const maxDuration = 180; // This function can run for a maximum of 180 seconds

const openaiApiKey = process.env.OPENAI_API_KEY;
if (!openaiApiKey) {
  throw new Error("Missing environment variable OPENAI_API_KEY");
}

const openai = new OpenAI({ apiKey: openaiApiKey });
const IMAGE_EDIT_TIMEOUT_MS = 180 * 1000; // 180초 타임아웃 설정

// Helper function for fetch with retry logic
async function fetchWithRetry(
  url: string,
  retries = 3,
  delay = 1000
): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`Attempt ${i + 1}: Fetching image from URL: ${url}`);
      const response = await fetch(url);
      if (response.ok) {
        return response; // 성공 시 즉시 반환
      }
      // 5xx 서버 오류인 경우 재시도
      if (response.status >= 500 && i < retries - 1) {
        // 마지막 시도가 아닐 때만 재시도
        console.warn(
          `Fetch attempt ${i + 1} failed with status ${response.status} ${
            response.statusText
          }. Retrying in ${(delay * (i + 1)) / 1000}s...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay * (i + 1))); // 지연 시간 증가
      } else {
        // 5xx 외의 오류 또는 마지막 재시도 실패 시 오류 발생
        throw new Error(
          `Failed to fetch image: ${response.status} ${response.statusText}`
        );
      }
    } catch (error) {
      console.error(`Fetch attempt ${i + 1} threw an error:`, error);
      if (i === retries - 1) {
        // 마지막 시도에서 발생한 에러 throw
        throw error;
      }
      // 마지막 시도가 아니면 재시도를 위해 대기
      await new Promise((resolve) => setTimeout(resolve, delay * (i + 1)));
    }
  }
  // 모든 재시도 실패 시 (이론상 도달하기 어렵지만 안전을 위해 추가)
  throw new Error(
    `Failed to fetch image after ${retries} attempts from URL: ${url}`
  );
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const supabase = await createClient();
  let isError = false;
  let reason = "";
  let imageBase64: string | undefined = undefined;

  if (!id) {
    return NextResponse.json({ error: "No id provided" }, { status: 400 });
  }

  const { data: iffy, error } = await getIffy({ id });

  if (error) {
    // 오류 처리 개선: 오류 내용을 로그에 남기거나 사용자에게 더 자세히 알릴 수 있습니다.
    console.error("Failed to get iffy data:", error);
    return NextResponse.json(
      { error: "Failed to retrieve Iffy data" },
      { status: 500 }
    );
  }
  if (!iffy) {
    // iffy 데이터가 null일 경우 처리
    return NextResponse.json(
      { error: "Iffy data not found for the provided ID" },
      { status: 404 }
    );
  }

  const stylePrompt = iffy.style_prompt;
  const originalImgUrl = iffy.gift_image_url; // 변수명 변경 (URL임을 명시)

  try {
    // 1. URL에서 이미지 데이터 가져오기 (재시도 로직 포함)
    console.log(`Fetching image from URL with retry: ${originalImgUrl}`);
    const response = await fetchWithRetry(originalImgUrl); // Use fetchWithRetry
    // 이미지 데이터를 ArrayBuffer로 읽기
    const imageArrayBuffer = await response.arrayBuffer();
    // ArrayBuffer를 Buffer로 변환 (Node.js 환경에서 Buffer가 더 일반적)
    const imageBuffer = Buffer.from(imageArrayBuffer);

    // // 파일 이름 및 MIME 타입 추론 (URL 또는 응답 헤더 사용 가능) -> PNG 기준으로 수정
    // // 원본 URL에서 파일 이름 부분 추출 시도, 없으면 기본값 사용. 확장자는 .png로 고정
    const baseFilename =
      originalImgUrl
        .substring(originalImgUrl.lastIndexOf("/") + 1)
        ?.split(".")?.[0] || "image";
    const filenamePng = `${baseFilename}.png`;
    const mimeTypePng = "image/png"; // MIME 타입을 image/png로 고정

    // toFile 유틸리티 사용하여 FileLike 객체 생성 (변환된 PNG Buffer 사용)
    console.log("Using toFile to prepare PNG image for openai.images.edit");
    const imageFileForApi = await toFile(imageBuffer, filenamePng, {
      // pngInputBuffer와 filenamePng 사용
      type: mimeTypePng, // mimeTypePng 사용
    });

    try {
      // 2. OpenAI 이미지 편집 API 호출 (타임아웃 적용)
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `OpenAI 이미지 편집 시간 초과 (${
                  IMAGE_EDIT_TIMEOUT_MS / 1000
                }초)`
              )
            ),
          IMAGE_EDIT_TIMEOUT_MS
        )
      );

      console.log("openai.images.edit 호출 시작...");
      const imageEditPromise = openai.images.edit({
        model: "gpt-image-1", // 사용자가 확인한 모델 이름 유지
        image: imageFileForApi, // PNG 데이터가 포함된 FileLike 객체
        prompt: stylePrompt,
        size: "1024x1024",
        quality: "medium", // quality 옵션 추가: medium 으로 강제
      });

      // Promise.race를 사용하여 API 호출과 타임아웃 경쟁
      const stylizedResult = (await Promise.race([
        imageEditPromise,
        timeoutPromise,
      ])) as OpenAI.Images.ImagesResponse; // 타입 단언 추가

      imageBase64 = stylizedResult.data?.[0]?.b64_json;

      if (stylizedResult.usage) {
        console.log("캐릭터 생성 token 사용량: ", stylizedResult.usage);
      }

      if (!imageBase64) {
        throw new Error("이미지 스타일화 실패: Base64 데이터가 없습니다.");
      }
    } catch (error) {
      // biome-ignore lint/suspicious/noExplicitAny: <explanation>
      if ((error as any).code === "moderation_blocked") {
        isError = true;
        reason = "문제의 소지가 있는 이미지에요! 다시 시도해주세요";
      } else {
        // moderation_blocked 외 다른 OpenAI 에러
        isError = true;
        reason = `OpenAI 이미지 편집 중 오류 발생: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    }

    if (isError) {
      // OpenAI 에러 발생 시 (moderation 포함) iffy 상태 업데이트 및 종료
      console.error(`Image generation failed due to OpenAI error: ${reason}`);
      await saveIffy({
        iffy: {
          ...iffy,
          status: "failed",
          updated_at: new Date().toISOString(),
          // 실패 사유를 저장할 필드가 있다면 추가: failure_reason: reason
        },
      });
      return NextResponse.json({ error: reason }, { status: 500 }); // 에러 응답 반환
    }

    if (!imageBase64) {
      // imageBase64가 없는 경우 (예: OpenAI API가 빈 데이터를 반환)
      isError = true;
      reason =
        "이미지 스타일화 실패: OpenAI API로부터 유효한 이미지 데이터를 받지 못했습니다.";
      console.error(reason);
      await saveIffy({
        iffy: {
          ...iffy,
          status: "failed",
          updated_at: new Date().toISOString(),
          // failure_reason: reason
        },
      });
      return NextResponse.json({ error: reason }, { status: 500 });
    }

    // 3. Base64 -> WebP 변환 및 업로드 (기존 코드 유지)
    const pngBuffer = Buffer.from(imageBase64, "base64");
    console.log("Sharp로 이미지 변환 시작 (PNG -> WebP)...");
    const webpBuffer = await sharp(pngBuffer).webp({ quality: 80 }).toBuffer();
    console.log("WebP 변환 완료.");

    const filePath = `iffy/${Date.now()}-${generateUUID()}.webp`;
    console.log("Supabase에 WebP 이미지 업로드 시작...");
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("imageFile")
      .upload(filePath, webpBuffer, {
        contentType: "image/webp",
        upsert: true,
      });

    if (uploadError) {
      console.error("[iffy] Supabase upload error:", uploadError);
      throw new Error("Failed to upload generated image to storage.");
    }

    const { data: publicUrlData } = supabase.storage
      .from("imageFile")
      .getPublicUrl(filePath);

    if (!publicUrlData || !publicUrlData.publicUrl) {
      throw new Error("Failed to get public URL for the uploaded image.");
    }

    const newImageUrl = publicUrlData.publicUrl;

    const iffyToSupabase: Iffy = {
      ...iffy,
      gift_image_url: newImageUrl, // 새 이미지 URL로 업데이트
      updated_at: new Date().toISOString(),
      status: "completed",
    };

    console.log("최종 객체 Supabase 저장 시작...");
    const { data: iffyData, error: iffyError } = await saveIffy({
      iffy: iffyToSupabase,
    });

    if (iffyError) {
      console.error("Failed to save iffy to supabase:", iffyError);
      return NextResponse.json(
        { error: "Failed to save iffy to supabase" },
        { status: 500 }
      );
    }

    console.log("저장 완료!");
    return NextResponse.json(iffyData, { status: 200 });
  } catch (error) {
    // 통합 오류 처리
    console.error("Error during image processing:", error);

    // 실패 사유 결정
    let failureReason = "An unknown error occurred during image processing.";
    if (error instanceof Error) {
      failureReason = error.message;
    } else if (typeof error === "string") {
      failureReason = error;
    }

    // isError 플래그와 reason 변수 사용 (통합 오류 처리 이전에 설정되었을 수 있음)
    if (isError && reason) {
      failureReason = reason; // OpenAI 관련 오류 메시지 사용
    }

    // supabase에 오류 상태 및 사유 저장
    const { data: iffyData, error: iffyError } = await saveIffy({
      iffy: {
        ...iffy,
        status: "failed",
        updated_at: new Date().toISOString(),
        // 실패 사유를 저장할 필드가 있다면 추가: failure_reason: failureReason
      },
    });

    if (iffyError) {
      console.error("Failed to save iffy to supabase:", iffyError);
      return NextResponse.json(
        { error: "Failed to save iffy to supabase" },
        { status: 500 }
      );
    }

    // 클라이언트에게는 일반적인 오류 메시지를 반환하고, 서버 로그에는 자세한 내용을 남깁니다.
    return NextResponse.json(
      { error: "Image processing failed.", details: failureReason }, // 실패 사유 포함
      { status: 500 }
    );
  }
}
