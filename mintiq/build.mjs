import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "dist");
await mkdir(dist, { recursive: true });
await writeFile(join(dist, "index.html"), "<!doctype html><title></title>\n");
