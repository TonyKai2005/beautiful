import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const toolDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(toolDirectory, "..");
const fontFile = join(
  projectDirectory,
  "node_modules/@fontsource/barlow-condensed/files/barlow-condensed-latin-900-normal.woff",
);
const generator = join(projectDirectory, "node_modules/.bin/msdf-bmfont");
const outputDirectory = join(projectDirectory, "src/assets/fonts");
const outputStem = "spatial-title-msdf";
const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,:;!?&+-/()'";
const temporaryDirectory = await mkdtemp(join(tmpdir(), "egain-spatial-font-"));

try {
  const charsetFile = join(temporaryDirectory, "charset.txt");
  await writeFile(charsetFile, `${charset}\n`, "utf8");

  const result = spawnSync(
    generator,
    [
      "--output-type",
      "json",
      "--filename",
      outputStem,
      "--font-size",
      "128",
      "--charset-file",
      charsetFile,
      "--texture-size",
      "1024,1024",
      "--texture-padding",
      "8",
      "--border",
      "3",
      "--distance-range",
      "16",
      "--field-type",
      "msdf",
      "--round-decimal",
      "4",
      "--pot",
      "--square",
      fontFile,
    ],
    { cwd: temporaryDirectory, encoding: "utf8" },
  );

  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`MSDF generator exited with status ${String(result.status)}`);
  }

  const generatedJson = join(
    temporaryDirectory,
    `${basename(fontFile, ".woff")}.json`,
  );
  const fontData = JSON.parse(await readFile(generatedJson, "utf8"));
  fontData.pages = [`${outputStem}.png`];
  fontData.meta = {
    source: "@fontsource/barlow-condensed 900 latin",
    generator: "msdf-bmfont-xml 2.8.0",
    fieldType: "msdf",
    generatedBy: "npm run font:spatial",
  };

  await mkdir(outputDirectory, { recursive: true });
  await copyFile(
    join(temporaryDirectory, `${outputStem}.png`),
    join(outputDirectory, `${outputStem}.png`),
  );
  await writeFile(
    join(outputDirectory, `${outputStem}.json`),
    `${JSON.stringify(fontData, null, 2)}\n`,
    "utf8",
  );

  process.stdout.write(
    `Generated ${outputStem}.png and ${outputStem}.json in src/assets/fonts\n`,
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
