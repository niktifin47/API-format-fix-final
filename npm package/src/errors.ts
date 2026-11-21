export class ApiFormatFixError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** The document is malformed, encrypted, or otherwise cannot be read. */
export class DocumentParseError extends ApiFormatFixError {}

/** A configured {@link ResourceLimits} value was exceeded. */
export class ResourceLimitError extends ApiFormatFixError {}

/** The requested input or output format is not supported. */
export class UnsupportedFormatError extends ApiFormatFixError {}

/** An option value (preset, color scheme, font, limit, ...) is not valid. */
export class InvalidOptionError extends ApiFormatFixError {}

/** An optional peer dependency required for a format is not installed. */
export class MissingDependencyError extends ApiFormatFixError {
  readonly packageName: string;

  constructor(message: string, packageName: string, options?: ErrorOptions) {
    super(message, options);
    this.packageName = packageName;
  }
}
