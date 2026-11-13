class DocumentParseError(ValueError):
    """Raised when an input document cannot be parsed."""


class ResourceLimitError(ValueError):
    """Raised when an input exceeds a caller-configured resource limit."""
