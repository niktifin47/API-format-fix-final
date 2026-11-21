import { MissingDependencyError } from "./errors.ts";

function isMissingPackage(error: unknown, packageName: string): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return (
    (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") &&
    error.message.includes(`Cannot find package '${packageName}'`)
  );
}

/** Lazily load an optional peer dependency, replacing "not found" with an actionable error. */
export async function importOptional<T>(
  load: () => Promise<T>,
  feature: string,
  packageName: string,
): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (isMissingPackage(error, packageName)) {
      throw new MissingDependencyError(
        `${feature} requires ${packageName}. Install it with \`npm install ${packageName}\`.`,
        packageName,
        { cause: error },
      );
    }
    throw error;
  }
}
