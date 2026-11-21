import { createHash } from "node:crypto";

import { formatContent } from "../../src/index.ts";

const bytes = await formatContent("# Title\n\nBody text\n\n- item\n\n1. one", ".md", ".docx");
console.log(createHash("sha256").update(bytes).digest("hex"));
