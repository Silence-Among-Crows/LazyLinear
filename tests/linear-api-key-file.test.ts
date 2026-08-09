import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
    linearApiKeyEnvironmentFilePath,
    loadLinearApiKeyFromUserEnvironmentFile,
    persistLinearApiKeyInUserEnvironmentFile,
} from "../src/linear-api-key-file.js";

function restoreLinearApiKey(existingValue: string | undefined): void {
    if (existingValue === undefined) {
        delete process.env.LINEAR_API_KEY;
        return;
    }

    process.env.LINEAR_API_KEY = existingValue;
}

test("the saved Linear API key round-trips through LazyLinear's environment file", async (context) => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "lazylinear-credentials-"));
    const existingValue = process.env.LINEAR_API_KEY;
    context.after(async () => {
        restoreLinearApiKey(existingValue);
        await rm(homeDirectory, { recursive: true, force: true });
    });
    const firstToken = "oauth-access-token.with_#=characters";
    const replacementToken = "lin_api_replacement-token";

    await persistLinearApiKeyInUserEnvironmentFile(`  ${firstToken}  `, homeDirectory);

    const filePath = linearApiKeyEnvironmentFilePath(homeDirectory);
    assert.equal(filePath, join(homeDirectory, ".lazylinear", ".env"));
    assert.equal(await readFile(filePath, "utf8"), `LINEAR_API_KEY=${JSON.stringify(firstToken)}\n`);
    assert.deepEqual(await readdir(join(homeDirectory, ".lazylinear")), [".env"]);
    assert.equal(process.env.LINEAR_API_KEY, firstToken);

    delete process.env.LINEAR_API_KEY;
    loadLinearApiKeyFromUserEnvironmentFile(homeDirectory);
    assert.equal(process.env.LINEAR_API_KEY, firstToken);

    await persistLinearApiKeyInUserEnvironmentFile(replacementToken, homeDirectory);
    delete process.env.LINEAR_API_KEY;
    loadLinearApiKeyFromUserEnvironmentFile(homeDirectory);
    assert.equal(process.env.LINEAR_API_KEY, replacementToken);

    if (process.platform !== "win32") {
        const directoryDetails = await stat(join(homeDirectory, ".lazylinear"));
        const fileDetails = await stat(filePath);
        assert.equal(directoryDetails.mode & 0o777, 0o700);
        assert.equal(fileDetails.mode & 0o777, 0o600);
    }
});

test("an existing process environment token takes precedence over the saved token", async (context) => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "lazylinear-credentials-"));
    const existingValue = process.env.LINEAR_API_KEY;
    context.after(async () => {
        restoreLinearApiKey(existingValue);
        await rm(homeDirectory, { recursive: true, force: true });
    });

    await persistLinearApiKeyInUserEnvironmentFile("lin_api_saved", homeDirectory);
    process.env.LINEAR_API_KEY = "lin_api_process_environment";
    loadLinearApiKeyFromUserEnvironmentFile(homeDirectory);

    assert.equal(process.env.LINEAR_API_KEY, "lin_api_process_environment");
});

test("a missing saved environment file is ignored", async (context) => {
    const homeDirectory = await mkdtemp(join(tmpdir(), "lazylinear-credentials-"));
    const existingValue = process.env.LINEAR_API_KEY;
    context.after(async () => {
        restoreLinearApiKey(existingValue);
        await rm(homeDirectory, { recursive: true, force: true });
    });
    delete process.env.LINEAR_API_KEY;

    loadLinearApiKeyFromUserEnvironmentFile(homeDirectory);

    assert.equal(process.env.LINEAR_API_KEY, undefined);
});

test("an empty Linear API key cannot be saved", async () => {
    await assert.rejects(
        persistLinearApiKeyInUserEnvironmentFile("   "),
        /A Linear API key or OAuth access token is required/u,
    );
});