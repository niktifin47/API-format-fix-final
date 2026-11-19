import assert from "node:assert/strict";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import { VERSION } from "../src/index.ts";
import { PromptCancelledError, createPrompt, main } from "../src/main.ts";
import type { CliIo } from "../src/main.ts";
import { docx, makePdf, withTempDir } from "./helpers.ts";

function runCli(args: string[], options: { tty?: boolean; answer?: string; cancel?: boolean } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const prompts: string[] = [];
  const io: CliIo = {
    stdout: { write: (text) => out.push(text) },
    stderr: { write: (text) => err.push(text) },
    stdinIsTTY: options.tty ?? false,
    prompt: async (question) => {
      prompts.push(question);
      if (options.cancel) throw new PromptCancelledError("Cancelled.");
      return options.answer ?? "";
    },
  };
  return main(args, io).then((code) => ({
    code,
    stdout: out.join(""),
    stderr: err.join(""),
    prompts,
  }));
}

test("CLI prints the package version", async () => {
  const result = await runCli(["--version"]);

  assert.equal(result.code, 0);
  assert.equal(result.stdout, `api-format-fix ${VERSION}\n`);
  assert.match(VERSION, /^\d+\.\d+\.\d+/);
});

test("CLI diagnostics are JSON describing formats and optional dependencies", async () => {
  const result = await runCli(["--diagnostics"]);

  const diagnostics = JSON.parse(result.stdout);
  assert.equal(result.code, 0);
  assert.equal(diagnostics.version, VERSION);
  assert.ok(diagnostics.node);
  assert.ok(diagnostics.platform);
  assert.deepEqual(diagnostics.formats[".rtf"], { read: true, write: false });
  assert.deepEqual(diagnostics.formats[".pdf"], { read: true, write: true });
  assert.deepEqual(Object.keys(diagnostics.optional_dependencies), ["pdf"]);
  assert.deepEqual(diagnostics.optional_dependencies.pdf, { "pdfjs-dist": true, pdfkit: true });
});

test("CLI lists presets, color schemes, and fonts", async () => {
  const result = await runCli(["--list-presets"]);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /^formal: Times New Roman, 11 pt, colors=navy\nfriendly: Arial, 11 pt, colors=teal\n/);
  assert.match(result.stdout, /Color schemes: navy, teal, spectrum-001/);
  assert.match(result.stdout, /Font families: Alegreya, Arial/);
});

test("CLI formats a file and reports the result", async () => {
  await withTempDir(async (directory) => {
    const source = join(directory, "input.md");
    const destination = join(directory, "output.html");
    await writeFile(source, "# Resume\n\n- Built tools", "utf8");

    const result = await runCli([source, destination, "--preset", "friendly", "--color-scheme", "navy"]);

    assert.equal(result.code, 0);
    assert.equal(result.stdout, `Formatted ${source} -> ${destination}\n`);
    const rendered = await readFile(destination, "utf8");
    assert.match(rendered, /font-family: Arial/);
    assert.match(rendered, /#17365d/);
  });
});

test("CLI reports usage and format errors concisely", async () => {
  const unsupported = await runCli(["input.md", "output.doc"]);
  assert.equal(unsupported.code, 2);
  assert.match(unsupported.stderr, /Unsupported output format '.doc'/);

  const missingOutput = await runCli(["input.md"]);
  assert.equal(missingOutput.code, 2);
  assert.match(missingOutput.stderr, /input and output paths are required/);

  const unknownOption = await runCli(["--bogus"]);
  assert.equal(unknownOption.code, 2);
  assert.match(unknownOption.stderr, /api-format-fix: error: .*--bogus/);

  const extra = await runCli(["a.md", "b.md", "c.md"]);
  assert.equal(extra.code, 2);
  assert.match(extra.stderr, /unrecognized arguments: c.md/);
});

test("CLI validates choices and limits", async () => {
  const preset = await runCli(["a.md", "b.html", "--preset", "nope"]);
  assert.equal(preset.code, 2);
  assert.match(preset.stderr, /argument --preset: invalid choice: 'nope' \(choose from 'formal', 'friendly'\)/);

  assert.match((await runCli(["a.md", "b.html", "--font-family", "Comic"])).stderr, /--font-family: invalid choice/);
  for (const value of ["0", "-1", "1.5", "abc", ""]) {
    const result = await runCli(["a.md", "b.html", `--max-text-chars=${value}`]);
    assert.equal(result.code, 2, value);
    assert.match(result.stderr, /argument --max-text-chars: must be a positive integer/);
  }
  assert.equal((await runCli(["a.md", "b.html", "--max-text-chars", "-1"])).code, 2);
});

test("CLI prompts before removing hidden characters", async () => {
  await withTempDir(async (directory) => {
    const source = join(directory, "input.md");
    const destination = join(directory, "output.md");
    await writeFile(source, "Visible\u2066hidden\u2069", "utf8");

    const result = await runCli([source, destination], { tty: true, answer: "yes" });

    assert.equal(result.code, 0);
    assert.match(result.prompts[0] ?? "", /Found 2 suspicious invisible\/control character\(s\)/);
    assert.equal(await readFile(destination, "utf8"), "Visiblehidden\n");

    const declined = await runCli([source, destination], { tty: true, answer: "n" });
    assert.equal(declined.code, 0);
    assert.match(await readFile(destination, "utf8"), /\u2066/);

    const explicit = await runCli([source, destination, "--remove-hidden-characters"], { tty: true });
    assert.equal(explicit.prompts.length, 0);
    assert.equal(await readFile(destination, "utf8"), "Visiblehidden\n");

    const piped = await runCli([source, destination]);
    assert.equal(piped.prompts.length, 0);
    assert.match(await readFile(destination, "utf8"), /\u2066/);
  });
});

test("the prompt returns answers, treats end of input as no, and cancels on Ctrl+C", async () => {
  const ask = (terminal: boolean, feed: (input: PassThrough) => void): Promise<string> => {
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume();
    const answer = createPrompt(input, output, terminal)("Remove? [y/N] ");
    feed(input);
    return answer;
  };

  assert.equal(await ask(false, (input) => input.write("yes\n")), "yes");
  assert.equal(await ask(false, (input) => input.end()), "");
  assert.equal(await ask(true, (input) => input.write("y\r")), "y");
  assert.equal(await ask(true, (input) => input.end()), "");
  await assert.rejects(ask(true, (input) => input.write("\x03")), PromptCancelledError);
});

test("CLI exits with 130 and writes nothing when the prompt is cancelled", async () => {
  await withTempDir(async (directory) => {
    const source = join(directory, "input.md");
    const destination = join(directory, "output.md");
    await writeFile(source, "Visible\u2066hidden\u2069", "utf8");

    const result = await runCli([source, destination], { tty: true, cancel: true });

    assert.equal(result.code, 130);
    assert.match(result.stderr, /Cancelled\./);
    await assert.rejects(stat(destination), { code: "ENOENT" });
  });
});

test("CLI reports malformed documents concisely", async () => {
  await withTempDir(async (directory) => {
    for (const [name, contents, message] of [
      ["input.pdf", "not a PDF", /Could not read PDF document/],
      ["input.docx", "not a DOCX", /Could not read DOCX document/],
      ["input.odt", "not an ODT", /Could not read ODT document/],
    ] as const) {
      const source = join(directory, name);
      await writeFile(source, contents);

      const result = await runCli([source, join(directory, "output.md")]);

      assert.equal(result.code, 2, name);
      assert.match(result.stderr, message);
      assert.ok(result.stderr.includes(source));
      assert.doesNotMatch(result.stderr, /\n\s+at /);
    }
  });
});

test("CLI reports encrypted PDFs concisely", async () => {
  await withTempDir(async (directory) => {
    const source = join(directory, "encrypted.pdf");
    await writeFile(
      source,
      await makePdf((pdf) => pdf.text("secret"), { userPassword: "secret", ownerPassword: "secret" }),
    );

    const result = await runCli([source, join(directory, "output.md")]);

    assert.equal(result.code, 2);
    assert.match(result.stderr, /encrypted PDFs are not supported/);
    assert.ok(result.stderr.includes(source));
  });
});

test("CLI enforces explicit limits without writing output", async () => {
  await withTempDir(async (directory) => {
    const source = join(directory, "input.md");
    const destination = join(directory, "output.md");
    await writeFile(source, "Resume", "utf8");

    const result = await runCli(["--max-input-bytes", "4", source, destination]);

    assert.equal(result.code, 2);
    assert.match(result.stderr, /maxInputBytes/);
    await assert.rejects(stat(destination), { code: "ENOENT" });

    const archive = join(directory, "input.docx");
    await writeFile(archive, docx(`<w:p><w:r><w:t>${"x".repeat(4000)}</w:t></w:r></w:p>`));
    const bomb = await runCli(["--max-decompressed-bytes", "1000", archive, destination]);
    assert.equal(bomb.code, 2);
    assert.match(bomb.stderr, /maxDecompressedBytes/);
  });
});

test("CLI reports missing files and --debug shows a stack trace", async () => {
  await withTempDir(async (directory) => {
    const missing = await runCli([join(directory, "missing.md"), join(directory, "out.md")]);
    assert.equal(missing.code, 2);
    assert.match(missing.stderr, /ENOENT/);

    const source = join(directory, "input.docx");
    await writeFile(source, "not a DOCX");
    const debug = await runCli(["--debug", source, join(directory, "out.md")]);
    assert.equal(debug.code, 1);
    assert.match(debug.stderr, /DocumentParseError: Could not read DOCX document/);
    assert.match(debug.stderr, /\n\s+at /);
  });
});
