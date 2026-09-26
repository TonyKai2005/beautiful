import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

export interface AssetLoadProgress {
  loaded: number;
  total: number | null;
  ratio: number | null;
}

type ProgressListener = (progress: AssetLoadProgress) => void;

/**
 * Shared glTF loader for both the corridor and Project Orbit.
 *
 * Assets stay local, byte progress remains observable, and the official Three
 * loaders handle KTX2, Meshopt, complete glTF materials and named animation
 * clips. This deliberately replaces the previous narrow static-geometry parser.
 */
export class GlbAssetLoader {
  private readonly loader: GLTFLoader;
  private readonly ktx2Loader: KTX2Loader;

  constructor(renderer: THREE.WebGLRenderer) {
    this.ktx2Loader = new KTX2Loader()
      .setTranscoderPath("/assets/transcoders/basis/")
      .setWorkerLimit(window.innerWidth <= 820 ? 1 : 2)
      .detectSupport(renderer);
    this.loader = new GLTFLoader()
      .setKTX2Loader(this.ktx2Loader)
      .setMeshoptDecoder(MeshoptDecoder);
  }

  async load(url: string, onProgress?: ProgressListener): Promise<GLTF> {
    await MeshoptDecoder.ready;
    const response = await fetch(url, { cache: "force-cache" });
    if (!response.ok) throw new Error(`Unable to load ${url} (${response.status})`);

    const totalHeader = response.headers.get("content-length");
    const total = totalHeader ? Number(totalHeader) : null;
    const buffer = response.body
      ? await this.readStream(response.body, total, onProgress)
      : await response.arrayBuffer();
    if (!response.body) onProgress?.({ loaded: buffer.byteLength, total, ratio: total ? 1 : null });

    const basePath = new URL(url, window.location.href);
    basePath.pathname = basePath.pathname.slice(0, basePath.pathname.lastIndexOf("/") + 1);
    return this.loader.parseAsync(buffer, basePath.href);
  }

  dispose(): void {
    this.ktx2Loader.dispose();
  }

  private async readStream(
    stream: ReadableStream<Uint8Array>,
    total: number | null,
    onProgress?: ProgressListener,
  ): Promise<ArrayBuffer> {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress?.({ loaded, total, ratio: total ? Math.min(1, loaded / total) : null });
    }

    const bytes = new Uint8Array(loaded);
    let cursor = 0;
    chunks.forEach((chunk) => {
      bytes.set(chunk, cursor);
      cursor += chunk.byteLength;
    });
    return bytes.buffer;
  }
}
