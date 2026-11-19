// Preloaded with `node --import` to simulate an install without the optional PDF packages.
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    const blocked = ["pdfkit", "pdfjs-dist"].find(
      (name) => specifier === name || specifier.startsWith(`${name}/`),
    );
    if (blocked) {
      throw Object.assign(new Error(`Cannot find package '${blocked}' imported from ${context.parentURL}`), {
        code: "ERR_MODULE_NOT_FOUND",
      });
    }
    return nextResolve(specifier, context);
  },
});
