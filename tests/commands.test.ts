import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
    COMMANDS,
    footerCommandDescriptors,
    identifyCommand,
    type CommandKey,
} from "../src/commands.js";

function inputForToken(token: string): { input: string; key: CommandKey } {
    if (token.startsWith("input:")) {
        return { input: token.slice("input:".length), key: {} };
    }

    const keyName = token.slice("key:".length);
    switch (keyName) {
        case "tab":
            return { input: "", key: { tab: true } };
        case "return":
            return { input: "", key: { return: true } };
        case "up":
            return { input: "", key: { upArrow: true } };
        case "down":
            return { input: "", key: { downArrow: true } };
        case "left":
            return { input: "", key: { leftArrow: true } };
        case "right":
            return { input: "", key: { rightArrow: true } };
        default:
            throw new Error(`Unrecognized command token ${token}.`);
    }
}

test("every command catalog token identifies one stable command", () => {
    const commandIds = new Set<string>();
    const tokenOwners = new Map<string, string>();
    for (const command of COMMANDS) {
        assert.ok(!commandIds.has(command.id), `Duplicate command ID ${command.id}.`);
        commandIds.add(command.id);
        assert.ok(command.contexts.length > 0, `${command.id} has no interaction context.`);
        assert.ok(command.helpLabel.trim().length > 0, `${command.id} has no help label.`);

        for (const token of command.tokens) {
            assert.equal(tokenOwners.get(token), undefined, `${token} belongs to more than one command.`);
            tokenOwners.set(token, command.id);
            const invocation = inputForToken(token);
            assert.equal(
                identifyCommand(invocation.input, invocation.key),
                command.id,
                `${token} did not identify ${command.id}.`,
            );
        }
    }
});

test("board-column navigation remains available while the navigation panel has focus", () => {
    assert.equal(identifyCommand("h", {}, "navigation", "board"), "moveBoardLeft");
    assert.equal(identifyCommand("l", {}, "navigation", "board"), "moveBoardRight");
    assert.equal(identifyCommand("", { leftArrow: true }, "navigation", "board"), "moveBoardLeft");
    assert.equal(identifyCommand("", { rightArrow: true }, "navigation", "board"), "moveBoardRight");
    assert.equal(identifyCommand("h", {}, "navigation", "list"), undefined);
    assert.equal(identifyCommand("L", {}, "detail", "board"), undefined);
});

test("Footer applicability is projected from the command catalog", () => {
    const navigation = footerCommandDescriptors("navigation", "list").map((command) => command.id);
    const content = footerCommandDescriptors("content", "list").map((command) => command.id);
    const board = footerCommandDescriptors("content", "board").map((command) => command.id);

    assert.ok(navigation.includes("refresh"));
    assert.ok(content.includes("createView"));
    assert.ok(content.includes("refresh"));
    assert.ok(!navigation.includes("moveBoardLeft"));
    assert.ok(!content.includes("moveBoardLeft"));
    assert.ok(board.includes("moveBoardLeft"));
    assert.ok(board.includes("moveCardLeft"));
});

test("README key documentation covers every displayed catalog key and the destructive command semantics", async () => {
    const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
    const keysStart = readme.indexOf("## Keys");
    const keysEnd = readme.indexOf("## API design");
    assert.ok(keysStart >= 0 && keysEnd > keysStart, "README must contain a bounded Keys section.");
    const keysSection = readme.slice(keysStart, keysEnd);
    const documentedCodeSpans = new Set(
        [...keysSection.matchAll(/`([^`]+)`/gu)].map((match) => match[1]!),
    );

    for (const command of COMMANDS) {
        const displayedKeys = command.keys === "/"
            ? ["/"]
            : command.keys.split("/").map((key) => key.trim());
        for (const displayedKey of displayedKeys) {
            if (["↑", "↓", "←", "→"].includes(displayedKey)) {
                assert.match(keysSection, /arrows/iu, `${command.id} displays an undocumented arrow key.`);
                continue;
            }
            const readmeKey = displayedKey === "tab"
                ? "Tab"
                : displayedKey === "enter"
                    ? "Enter"
                    : displayedKey === "space"
                        ? "Space"
                        : displayedKey;
            assert.ok(
                documentedCodeSpans.has(readmeKey),
                `${command.id} displays undocumented key ${displayedKey}.`,
            );
        }
    }

    const createView = COMMANDS.find((command) => command.id === "createView");
    assert.equal(createView?.keys, "v");
    assert.match(createView?.helpLabel ?? "", /create .*custom view/iu);
    assert.match(keysSection, /\| `v` \| Create a Linear custom view \|/u);

    const remove = COMMANDS.find((command) => command.id === "remove");
    assert.equal(remove?.keys, "d");
    assert.match(remove?.helpLabel ?? "", /archive an issue, project, or team; permanently delete a custom view/iu);
    assert.match(
        keysSection,
        /\| `d` \| Archive an issue, project, or team; permanently delete a custom view after confirmation \|/u,
    );
});