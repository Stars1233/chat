/**
 * Tests that code examples in README.md are valid TypeScript.
 *
 * This ensures documentation stays in sync with the actual API.
 */

import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const README_PATH = join(__dirname, "../../../README.md");
const REPO_ROOT = join(__dirname, "../../..");

/**
 * Extract TypeScript code blocks from markdown content.
 */
function extractTypeScriptBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const regex = /```(?:typescript|ts)\n([\s\S]*?)```/g;
  let match = regex.exec(markdown);

  while (match !== null) {
    blocks.push(match[1].trim());
    match = regex.exec(markdown);
  }

  return blocks;
}

/**
 * Create a temporary directory with proper tsconfig and package setup
 * to type-check the code blocks.
 */
function createTempProject(codeBlocks: string[]): string {
  const tempDir = mkdtempSync(join(tmpdir(), "readme-test-"));

  // Create tsconfig.json that references the repo's packages
  const tsconfig = {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "bundler",
      esModuleInterop: true,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      // Use typeRoots to find @types/node from the repo
      typeRoots: [join(REPO_ROOT, "node_modules/@types")],
      paths: {
        "chat-sdk": [join(__dirname, "../../chat-sdk/src/index.ts")],
        "@chat-sdk/slack": [
          join(__dirname, "../../adapter-slack/src/index.ts"),
        ],
        "@chat-sdk/teams": [
          join(__dirname, "../../adapter-teams/src/index.ts"),
        ],
        "@chat-sdk/gchat": [
          join(__dirname, "../../adapter-gchat/src/index.ts"),
        ],
        "@chat-sdk/state-redis": [
          join(__dirname, "../../state-redis/src/index.ts"),
        ],
        "@chat-sdk/state-memory": [
          join(__dirname, "../../state-memory/src/index.ts"),
        ],
        "@/lib/bot": [join(tempDir, "bot.ts")],
        "next/server": [join(tempDir, "next-server.d.ts")],
      },
    },
    include: [join(tempDir, "*.ts")],
  };

  writeFileSync(
    join(tempDir, "tsconfig.json"),
    JSON.stringify(tsconfig, null, 2),
  );

  // Create stub for next/server since it's not installed
  writeFileSync(
    join(tempDir, "next-server.d.ts"),
    `
export function after(fn: () => unknown): void;
  `,
  );

  // Write each code block as a separate file
  // The bot.ts file needs to be written first so route.ts can import it
  codeBlocks.forEach((code, index) => {
    // Determine filename based on content
    let filename: string;
    if (code.includes("export const bot = new Chat")) {
      filename = "bot.ts";
    } else if (code.includes("export async function POST")) {
      filename = "route.ts";
      // Fix the import path for the test environment
      code = code.replace("@/lib/bot", "./bot");
    } else {
      filename = `block-${index}.ts`;
    }

    writeFileSync(join(tempDir, filename), code);
  });

  return tempDir;
}

describe("README.md code examples", () => {
  it("should contain valid TypeScript that type-checks", () => {
    // Read README
    const readme = readFileSync(README_PATH, "utf-8");

    // Extract code blocks
    const codeBlocks = extractTypeScriptBlocks(readme);
    expect(codeBlocks.length).toBeGreaterThan(0);

    // Create temp project
    const tempDir = createTempProject(codeBlocks);

    try {
      // Run tsc using the repo's typescript installation
      execSync(`pnpm exec tsc --project ${tempDir}/tsconfig.json --noEmit`, {
        cwd: REPO_ROOT,
        encoding: "utf-8",
        stdio: "pipe",
      });
    } catch (error) {
      const execError = error as { stdout?: string; stderr?: string };
      const output = execError.stdout || execError.stderr || String(error);

      // Clean up before failing
      rmSync(tempDir, { recursive: true, force: true });

      // Fail with helpful error message
      expect.fail(
        `README.md TypeScript code blocks failed type-checking:\n\n${output}\n\n` +
          `Code blocks tested:\n${codeBlocks.map((b, i) => `--- Block ${i} ---\n${b}`).join("\n\n")}`,
      );
    }

    // Clean up
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should have at least a bot definition and route handler", () => {
    const readme = readFileSync(README_PATH, "utf-8");
    const codeBlocks = extractTypeScriptBlocks(readme);

    const hasBotDefinition = codeBlocks.some(
      (block) => block.includes("new Chat") && block.includes("adapters:"),
    );
    const hasRouteHandler = codeBlocks.some((block) =>
      block.includes("export async function POST"),
    );

    expect(
      hasBotDefinition,
      "README should have a Chat instantiation example",
    ).toBe(true);
    expect(hasRouteHandler, "README should have a POST handler example").toBe(
      true,
    );
  });
});
