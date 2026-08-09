import { randomUUID } from "node:crypto";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadEnvFile } from "node:process";

const LINEAR_API_KEY_VARIABLE = "LINEAR_API_KEY";
const LAZYLINEAR_DIRECTORY = ".lazylinear";
const LAZYLINEAR_ENVIRONMENT_FILE = ".env";

export function linearApiKeyEnvironmentFilePath(homeDirectory = homedir()): string {
    return join(homeDirectory, LAZYLINEAR_DIRECTORY, LAZYLINEAR_ENVIRONMENT_FILE);
}

export function loadLinearApiKeyFromUserEnvironmentFile(homeDirectory = homedir()): void {
    const filePath = linearApiKeyEnvironmentFilePath(homeDirectory);
    try {
        loadEnvFile(filePath);
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            return;
        }
        throw new Error(`LazyLinear could not load ${filePath}.`, { cause: error });
    }
}

export async function persistLinearApiKeyInUserEnvironmentFile(
    token: string,
    homeDirectory = homedir(),
): Promise<void> {
    const value = token.trim();
    if (!value) {
        throw new Error("A Linear API key or OAuth access token is required.");
    }

    const directory = join(homeDirectory, LAZYLINEAR_DIRECTORY);
    const filePath = linearApiKeyEnvironmentFilePath(homeDirectory);
    const temporaryPath = join(directory, `${LAZYLINEAR_ENVIRONMENT_FILE}.${process.pid}.${randomUUID()}.tmp`);
    try {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        if (process.platform !== "win32") {
            await chmod(directory, 0o700);
        }
        await writeFile(
            temporaryPath,
            `${LINEAR_API_KEY_VARIABLE}=${JSON.stringify(value)}\n`,
            { encoding: "utf8", flag: "wx", mode: 0o600 },
        );
        if (process.platform !== "win32") {
            await chmod(temporaryPath, 0o600);
        }
        await rename(temporaryPath, filePath);
        if (process.platform !== "win32") {
            await chmod(filePath, 0o600);
        }
    } catch (error) {
        try {
            await rm(temporaryPath, { force: true });
        } catch (cleanupError) {
            throw new AggregateError(
                [error, cleanupError],
                `LazyLinear could not save ${filePath} or remove its temporary file.`,
            );
        }
        throw new Error(`LazyLinear could not save ${filePath}.`, { cause: error });
    }

    process.env[LINEAR_API_KEY_VARIABLE] = value;
}