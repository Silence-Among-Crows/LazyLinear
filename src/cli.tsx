#!/usr/bin/env node
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import React from "react";
import { render } from "ink";
import { App } from "./app.js";

type PackageMetadata = Pick<typeof import("../package.json"), "version">;

const adjacentPackageUrl = new URL("../package.json", import.meta.url);
const packageUrl = existsSync(adjacentPackageUrl)
    ? adjacentPackageUrl
    : new URL("../../package.json", import.meta.url);
const packageMetadata = createRequire(import.meta.url)(fileURLToPath(packageUrl)) as PackageMetadata;

interface CliOptions {
    demo: boolean;
    token?: string;
    help: boolean;
    version: boolean;
    error?: string;
}

function parseArguments(argumentsList: string[]): CliOptions {
    const options: CliOptions = {
        demo: false,
        help: false,
        version: false,
    };
    for (let index = 0; index < argumentsList.length; index += 1) {
        const argument = argumentsList[index]!;
        if (argument === "--demo") {
            options.demo = true;
        } else if (argument === "--help" || argument === "-h") {
            options.help = true;
        } else if (argument === "--version" || argument === "-v") {
            options.version = true;
        } else if (argument === "--api-key" || argument === "--token") {
            const value = argumentsList[index + 1];
            if (!value || value.startsWith("-")) {
                options.error = `${argument} requires a token value.`;
                break;
            }
            options.token = value;
            index += 1;
        } else if (argument.startsWith("--api-key=") || argument.startsWith("--token=")) {
            const value = argument.slice(argument.indexOf("=") + 1);
            if (value.length === 0) {
                options.error = `${argument.slice(0, argument.indexOf("="))} requires a token value.`;
                break;
            }
            options.token = value;
        } else {
            options.error = `Unknown option: ${argument}`;
            break;
        }
    }
    return options;
}

function printHelp(): void {
    process.stdout.write(`lazylinear - a keyboard-first terminal UI for Linear\n\n`);
    process.stdout.write(`Usage:\n  lazylinear [--demo] [--api-key <token>]\n\n`);
    process.stdout.write(`Options:\n  --demo             Run against the built-in demo workspace\n`);
    process.stdout.write(`  --api-key <token>  Use a Linear personal API key or OAuth token\n`);
    process.stdout.write(`  -h, --help         Show this help\n`);
    process.stdout.write(`  -v, --version      Show the version\n\n`);
    process.stdout.write(`Authentication:\n  LINEAR_API_KEY is used when --api-key is omitted. Tokens are never written to disk.\n`);
}

const options = parseArguments(process.argv.slice(2));
if (options.error) {
    process.stderr.write(`${options.error}\nRun lazylinear --help for usage.\n`);
    process.exitCode = 1;
} else if (options.help) {
    printHelp();
} else if (options.version) {
    process.stdout.write(`lazylinear ${packageMetadata.version}\n`);
} else if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("LazyLinear requires interactive terminal input and output. Run it directly in a TTY.\n");
    process.exitCode = 1;
} else {
    render(
        <App
            demo={options.demo}
            initialToken={options.token ?? process.env.LINEAR_API_KEY}
        />,
        {
            exitOnCtrlC: true,
            patchConsole: true,
        },
    );
}