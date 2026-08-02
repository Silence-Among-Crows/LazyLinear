import { LinearApiError, type GraphQlErrorShape } from "./linear-error.js";
import type { RateLimitInfo } from "./types.js";

export const LINEAR_GRAPHQL_ENDPOINT = "https://api.linear.app/graphql";

interface GraphQlResponse<T> {
    data?: T;
    errors?: GraphQlErrorShape[];
}

export interface LinearGraphQlResult<T> {
    readonly data: T;
    readonly rateLimit: RateLimitInfo;
}

export type LinearFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function numericHeader(headers: Headers, name: string): number | undefined {
    const value = headers.get(name);
    if (value === null) {
        return undefined;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function readRateLimit(headers: Headers): RateLimitInfo {
    const reset = numericHeader(headers, "x-ratelimit-requests-reset");
    return {
        requestLimit: numericHeader(headers, "x-ratelimit-requests-limit"),
        requestRemaining: numericHeader(headers, "x-ratelimit-requests-remaining"),
        requestResetAt: reset === undefined ? undefined : new Date(reset).toISOString(),
        complexity: numericHeader(headers, "x-complexity"),
        complexityLimit: numericHeader(headers, "x-ratelimit-complexity-limit"),
        complexityRemaining: numericHeader(headers, "x-ratelimit-complexity-remaining"),
    };
}

function authorizationHeader(token: string): string {
    if (/^Bearer\s+/i.test(token)) {
        return token;
    }

    return token.startsWith("lin_api_") ? token : `Bearer ${token}`;
}

export class LinearGraphQlTransport {
    readonly #token: string;
    readonly #endpoint: string;
    readonly #fetch: LinearFetch;

    constructor(
        token: string,
        endpoint = LINEAR_GRAPHQL_ENDPOINT,
        fetchImplementation: LinearFetch = globalThis.fetch,
    ) {
        if (token.trim().length === 0) {
            throw new LinearApiError("A Linear API key or OAuth access token is required.");
        }

        this.#token = token.trim();
        this.#endpoint = endpoint;
        this.#fetch = fetchImplementation;
    }

    async request<T>(
        query: string,
        variables: Readonly<Record<string, unknown>> = {},
    ): Promise<LinearGraphQlResult<T>> {
        let response: Response;
        try {
            response = await this.#fetch(this.#endpoint, {
                method: "POST",
                headers: {
                    Accept: "application/json",
                    Authorization: authorizationHeader(this.#token),
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ query, variables }),
            });
        } catch (error) {
            throw new LinearApiError("Unable to reach Linear. Check your network connection.", {
                failureKind: "network",
                cause: error,
            });
        }

        const rateLimit = readRateLimit(response.headers);
        let payload: GraphQlResponse<T>;
        try {
            payload = await response.json() as GraphQlResponse<T>;
        } catch (error) {
            throw new LinearApiError(`Linear returned an unreadable response (${response.status}).`, {
                failureKind: "unreadable",
                status: response.status,
                rateLimit,
                cause: error,
            });
        }

        if (!response.ok || payload.errors?.length) {
            const errors = payload.errors ?? [];
            const primary = errors[0];
            const message = primary?.extensions?.userPresentableMessage
                ?? primary?.message
                ?? `Linear request failed with HTTP ${response.status}.`;
            throw new LinearApiError(message, {
                failureKind: "api",
                code: primary?.extensions?.code,
                graphQlErrors: errors,
                status: response.status,
                rateLimit,
            });
        }

        if (payload.data === undefined) {
            throw new LinearApiError("Linear returned no data for the request.", { rateLimit });
        }

        return { data: payload.data, rateLimit };
    }
}