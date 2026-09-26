import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "node_modules/three/examples/jsm/libs/basis");
const target = resolve(root, "public/assets/transcoders/basis");

await mkdir(target, { recursive: true });
await Promise.all([
  copyFile(resolve(source, "basis_transcoder.js"), resolve(target, "basis_transcoder.js")),
  copyFile(resolve(source, "basis_transcoder.wasm"), resolve(target, "basis_transcoder.wasm")),
]);

console.log(`Basis transcoders copied to ${target}`);
