import type {
	Api,
	Context,
	KnownProvider,
	Model,
	Tool,
} from "@mariozechner/pi-ai";
import type { ProviderApi, ProviderSpec } from "@/core/llm/model/provider";
import type { ToolDefinition } from "@/core/llm/model/types";

/**
 * pi-ai 는 ESM 전용인데 이 프로젝트는 CJS 로 빌드된다(Nest 의 `emitDecoratorMetadata`
 * 때문이다). 패키지가 `require` 조건을 내보내지 않아 정적 import 로는 못 부르므로
 * 동적 import 로 한 번만 불러 들고 있는다 — `module: nodenext` 는 CJS 출력에서도
 * `import()` 를 그대로 남긴다.
 */
let loaded: Promise<typeof import("@mariozechner/pi-ai")> | undefined;

export function loadPi(): Promise<typeof import("@mariozechner/pi-ai")> {
	loaded ??= import("@mariozechner/pi-ai");
	return loaded;
}

/**
 * providers.yml 에 baseUrl 을 안 적었고 pi-ai 레지스트리에도 없는 모델일 때 쓸 기본 주소.
 * OpenAI 호환 엔드포인트는 주소가 provider 마다 달라 기본값을 둘 수 없다.
 */
const API_BASE_URLS: Partial<Record<ProviderApi, string>> = {
	"google-generative-ai": "https://generativelanguage.googleapis.com/v1beta",
	"mistral-conversations": "https://api.mistral.ai",
};

/**
 * pi-ai 레지스트리에서 같은 모델을 찾는다.
 *
 * 찾으면 컨텍스트 창·출력 상한·주소를 그대로 쓴다 — providers.yml 에 손으로 적는 값이
 * 줄어들고, 그 값들은 provider 문서에서 생성된 것이라 우리가 적는 것보다 정확하다.
 */
function fromRegistry(
	pi: typeof import("@mariozechner/pi-ai"),
	spec: ProviderSpec,
): Model<Api> | undefined {
	try {
		return pi
			.getModels(spec.name as KnownProvider)
			.find((model) => model.id === spec.model) as Model<Api> | undefined;
	} catch {
		// 레지스트리가 모르는 provider 이름이다 — 직접 만든다
		return undefined;
	}
}

/** providers.yml 한 줄을 pi-ai 가 받는 모델 정의로 바꾼다 */
export function toPiModel(
	pi: typeof import("@mariozechner/pi-ai"),
	spec: ProviderSpec,
): Model<Api> {
	const known = fromRegistry(pi, spec);
	const baseUrl = spec.baseUrl ?? known?.baseUrl ?? API_BASE_URLS[spec.api];
	if (!baseUrl)
		throw new Error(
			`${spec.name}: baseUrl 을 알 수 없다 — providers.yml 에 적어야 한다`,
		);

	return {
		id: spec.model,
		name: `${spec.model} (${spec.name})`,
		api: spec.api,
		provider: spec.name,
		baseUrl,
		reasoning: known?.reasoning ?? false,
		input: known?.input ?? ["text"],
		cost: known?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		// 레지스트리에도 없고 파일에도 없으면 보수적인 값을 쓴다 — 넘치면 배치가 쪼개진다
		contextWindow: spec.contextWindow ?? known?.contextWindow ?? 128_000,
		maxTokens: spec.maxOutputTokens ?? known?.maxTokens ?? 8_192,
	};
}

/** 도구 정의를 pi-ai 형태로 넘긴다 — parameters 는 이미 JSON Schema 라 그대로 실린다 */
export function toPiTools(tools: ToolDefinition[]): Tool[] {
	return tools as unknown as Tool[];
}

export type { Context };
