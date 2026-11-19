import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** The package version, read from package.json so it cannot drift. */
export const VERSION: string = (require("../package.json") as { version: string }).version;
