import type { RateLimitInfo } from "./types.js";

export interface GraphQlErrorShape {
    message: string;
    path?: Array<string | number>;
    extensions?: {
        code?: string;
        userError?: boolean;
        userPresentableMessage?: string;
        [key: string]: unknown;
    };
}

export class LinearApiError extends Error {
    readonly code?: string;
    readonly graphQlErrors: GraphQlErrorShape[];
    readonly status?: number;
    readonly rateLimit?: RateLimitInfo;

    constructor(
        message: string,
        options: {
            code?: string;
            graphQlErrors?: GraphQlErrorShape[];
            status?: number;
            rateLimit?: RateLimitInfo;
            cause?: unknown;
        } = {},
    ) {
        super(message, { cause: options.cause });
        this.name = "LinearApiError";
        this.code = options.code;
        this.graphQlErrors = options.graphQlErrors ?? [];
        this.status = options.status;
        this.rateLimit = options.rateLimit;
    }
}