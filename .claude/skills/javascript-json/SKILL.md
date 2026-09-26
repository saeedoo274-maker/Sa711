---
name: javascript-json
description: "Correct, safe, and fast JSON handling in JavaScript/TypeScript. Use when parsing, validating, serializing, transforming, streaming, or diffing JSON; when writing config/package.json/tsconfig; when designing JSON APIs or payloads; or when debugging JSON errors (SyntaxError: Unexpected token, circular structure, BigInt, Date round-trips, precision loss)."
---

# JavaScript JSON

JSON is untrusted input until validated. Parse at the boundary, validate immediately, and pass typed values inward.

## Parsing

- Always wrap `JSON.parse` of external data; report the source and a short excerpt, never the full payload (it may hold secrets).
  ```ts
  function parseJson(text: string, source: string): unknown {
    try { return JSON.parse(text); }
    catch (e) { throw new Error(`Invalid JSON from ${source}: ${(e as Error).message}`); }
  }
  ```
- Type the result as `unknown`, never `any`. Narrow with a schema (below) before use.
- `fetch`: check `res.ok` and `content-type` before `await res.json()`; an HTML error page throws "Unexpected token <".
- Strip a UTF-8 BOM (`text.replace(/^﻿/, "")`) from files read from disk.
- JSON has no comments or trailing commas. `tsconfig.json`/`.vscode` are JSONC — use a JSONC parser (`jsonc-parser`) for those, not `JSON.parse`.

## Validation (schema at the boundary)

Prefer one schema that yields both the runtime check and the static type.

```ts
import { z } from "zod";
const User = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  age: z.number().int().nonnegative().optional(),
  createdAt: z.coerce.date(),
});
type User = z.infer<typeof User>;

const result = User.safeParse(parseJson(body, "POST /users"));
if (!result.success) return badRequest(result.error.flatten());
```

- Use `safeParse` at request/IO boundaries (return 400 with field errors); use `parse` where invalid data is a bug.
- Reject unknown keys on inputs that are written to a DB (`.strict()`), to block mass-assignment.
- Cross-language contracts or published APIs: use JSON Schema + Ajv (`ajv` with `ajv-formats`), compile once and reuse the validator.
- Never validate with hand-written `typeof` chains beyond two or three fields.

## Security

- Prototype pollution: never deep-merge parsed JSON into existing objects without skipping `__proto__`, `constructor`, `prototype`. Prefer `structuredClone` + schema-validated objects, or `Object.create(null)` maps.
- Never `eval` or `new Function` JSON. Never build JSON with string concatenation — use `JSON.stringify`.
- Embedding JSON in HTML `<script>`: escape `<`, `>`, `&`, U+2028, U+2029 (e.g. `.replace(/</g, "\\u003c")`) to prevent `</script>` injection.
- Cap body size before parsing (`express.json({ limit: "100kb" })`); huge inputs block the event loop.

## Serialization

- `JSON.stringify(value, null, 2)` for files humans read; no indentation over the wire.
- Things that do not survive a round-trip — handle explicitly:
  | Value | What `stringify` does | Fix |
  |---|---|---|
  | `Date` | ISO string; parses back as string | `z.coerce.date()` or reviver |
  | `BigInt` | throws | `toJSON`/replacer → string |
  | `Map`/`Set` | `{}` | `Object.fromEntries(map)` / `[...set]` |
  | `undefined`, functions | key dropped (array slot → `null`) | explicit `null` if key must exist |
  | `NaN`/`Infinity` | `null` | validate numbers are finite |
  | numbers > 2^53 | precision loss on parse | send as strings |
- Circular references throw "Converting circular structure to JSON": serialize a DTO, not the ORM/DOM object. For logs only, use a replacer with a `WeakSet`.
- Stable output (hashes, snapshots, diffs): sort keys recursively before stringify.
- Define `toJSON()` on classes to control their public shape (hide passwords, internal fields).

## Deep copy and equality

- Deep copy: `structuredClone(obj)` (handles Date/Map/Set/cycles). `JSON.parse(JSON.stringify(x))` silently loses data — avoid.
- Deep equality: `node:util` `isDeepStrictEqual`, or compare canonical (sorted-key) strings.

## Large data

- Do not `JSON.parse` files over ~50 MB in one go. Stream: NDJSON (one object per line) via `readline`, or `stream-json` for a single huge array.
- Prefer NDJSON for logs, exports, and batch APIs — appendable and streamable.
- In hot paths, parse once and pass objects; do not re-stringify to "copy".

## API payload design

- camelCase keys, consistent across the API. ISO 8601 UTC timestamps. Money as integer minor units or decimal strings, never floats.
- Envelope errors consistently, e.g. `{ "error": { "code": "VALIDATION_FAILED", "message": "...", "details": {...} } }`.
- Use `null` for "known empty" and omit for "not provided" — pick and document one meaning.
- Paginate lists (`{ items, nextCursor }`) instead of returning unbounded arrays.

## Files and config

- Read/write JSON files atomically: write to `file.tmp` then `rename`.
- `package.json`: edit with `npm pkg set` or parse-modify-stringify with 2-space indent and trailing newline; never regex-edit.
- Import JSON in ESM with `import data from "./x.json" with { type: "json" }` (Node 22+), or `fs.readFile` + parse.

## Debugging checklist

1. `Unexpected token <` → got HTML (404/500 page, wrong URL, auth redirect). Log status + first 200 chars.
2. `Unexpected end of JSON input` → empty body (204, aborted stream) or truncated read.
3. `Unexpected token '` or `u` → single quotes / `undefined` — the producer is not emitting JSON.
4. Numbers wrong → >2^53 precision loss.
5. Dates are strings → no coercion after parse.
