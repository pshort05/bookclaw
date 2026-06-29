# Sources

Local-only document store. Drop reference documents here (research notes,
reference texts, source material, etc.) to be **scanned to generate additional
content for BookClaw**. These documents are **never uploaded** — `.gitignore`
ignores everything in this directory except this `README.md`, mirroring the
`skills/premium/` convention.

- Put any file types here you want available as source material.
- Nothing under `sources/` is committed or pushed (except this README).
- Treat the contents as untrusted input at the scan boundary (validate before
  injecting into prompts), consistent with the rest of the project's input
  handling.
