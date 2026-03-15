// src/features/editor/components/Editor/constants.ts

export const SUPPORTED_LANGUAGES = [
  { label: "Auto-detect", value: ""           },
  { label: "Bash",        value: "bash"        },
  { label: "CSS",         value: "css"         },
  { label: "Go",          value: "go"          },
  { label: "HTML",        value: "xml"         },
  { label: "Java",        value: "java"        },
  { label: "JavaScript",  value: "javascript"  },
  { label: "JSON",        value: "json"        },
  { label: "Markdown",    value: "markdown"    },
  { label: "Python",      value: "python"      },
  { label: "Rust",        value: "rust"        },
  { label: "SQL",         value: "sql"         },
  { label: "TypeScript",  value: "typescript"  },
  { label: "YAML",        value: "yaml"        },
] as const;

export type LanguageValue = typeof SUPPORTED_LANGUAGES[number]["value"];