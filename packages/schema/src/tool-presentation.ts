export * as ToolPresentation from "./tool-presentation"

import { Schema } from "effect"
import { ToolContent } from "./llm"
import { optional } from "./schema"

/**
 * UI-neutral tool presentation vocabulary (ADR-018, absorbed from the
 * DeepSeek Harness `presentCall`/`presentResult` card-intent design). A tool
 * declares how one of its calls renders through pure projection functions;
 * any UI (tui, web) projects these intents without special-casing tool names.
 */

export const CallKind = Schema.Literals(["read", "edit", "delete", "move", "search", "execute", "fetch", "other"]).annotate({
  identifier: "ToolPresentation.CallKind",
})
export type CallKind = Schema.Schema.Type<typeof CallKind>

/** A file a call reads or modifies, for UI follow-along. `line` is 1-based. */
export interface FileLocation extends Schema.Schema.Type<typeof FileLocation> {}
export const FileLocation = Schema.Struct({
  path: Schema.String,
  line: optional(Schema.Int),
}).annotate({ identifier: "ToolPresentation.FileLocation" })

/**
 * A single-file change. `oldText` is `null` for a new file or an overwrite
 * (no prior content available at call time).
 */
export interface FileDiff extends Schema.Schema.Type<typeof FileDiff> {}
export const FileDiff = Schema.Struct({
  path: Schema.String,
  oldText: Schema.Union([Schema.String, Schema.Null]),
  newText: Schema.String,
}).annotate({ identifier: "ToolPresentation.FileDiff" })

/** One numbered line of a file; `number` is the 1-based file line number. */
export interface ReadFileLine extends Schema.Schema.Type<typeof ReadFileLine> {}
export const ReadFileLine = Schema.Struct({
  number: Schema.Int,
  text: Schema.String,
}).annotate({ identifier: "ToolPresentation.ReadFileLine" })

/** One matched line of a search result; `lineNumber` is 1-based. */
export interface SearchLineMatch extends Schema.Schema.Type<typeof SearchLineMatch> {}
export const SearchLineMatch = Schema.Struct({
  lineNumber: Schema.Int,
  line: Schema.String,
}).annotate({ identifier: "ToolPresentation.SearchLineMatch" })

/** One file's grouped content matches, in first-seen file order. */
export interface SearchFileMatches extends Schema.Schema.Type<typeof SearchFileMatches> {}
export const SearchFileMatches = Schema.Struct({
  path: Schema.String,
  matches: Schema.Array(SearchLineMatch),
}).annotate({ identifier: "ToolPresentation.SearchFileMatches" })

/** One citeable web source. */
export interface WebSource extends Schema.Schema.Type<typeof WebSource> {}
export const WebSource = Schema.Struct({
  url: Schema.String,
  title: optional(Schema.String),
  snippet: optional(Schema.String),
  publishedAt: optional(Schema.String),
}).annotate({ identifier: "ToolPresentation.WebSource" })

/** The default call card: a titled row with an optional category icon. */
export interface GenericCall extends Schema.Schema.Type<typeof GenericCall> {}
export const GenericCall = Schema.Struct({
  card: Schema.Literal("generic"),
  title: Schema.String,
  kind: optional(CallKind),
  rawInput: optional(Schema.Json),
  content: optional(Schema.Array(ToolContent)),
  locations: optional(Schema.Array(FileLocation)),
}).annotate({ identifier: "ToolPresentation.GenericCall" })

/** A call that IS a shell command running in a working directory. */
export interface TerminalCall extends Schema.Schema.Type<typeof TerminalCall> {}
export const TerminalCall = Schema.Struct({
  card: Schema.Literal("terminal"),
  title: Schema.String,
  description: optional(Schema.String),
  cwd: optional(Schema.String),
}).annotate({ identifier: "ToolPresentation.TerminalCall" })

/** A call that creates or modifies files, rendered as an inline diff. */
export interface DiffCall extends Schema.Schema.Type<typeof DiffCall> {}
export const DiffCall = Schema.Struct({
  card: Schema.Literal("diff"),
  title: Schema.String,
  diffs: Schema.Array(FileDiff),
  locations: optional(Schema.Array(FileLocation)),
}).annotate({ identifier: "ToolPresentation.DiffCall" })

export const Call = Schema.Union([GenericCall, TerminalCall, DiffCall])
  .pipe(Schema.toTaggedUnion("card"))
  .annotate({ identifier: "ToolPresentation.Call" })
export type Call = Schema.Schema.Type<typeof Call>

/** The default completed card: an optional replacement title and content. */
export interface GenericResult extends Schema.Schema.Type<typeof GenericResult> {}
export const GenericResult = Schema.Struct({
  card: Schema.Literal("generic"),
  title: optional(Schema.String),
  content: optional(Schema.Array(ToolContent)),
}).annotate({ identifier: "ToolPresentation.GenericResult" })

/** Completed terminal state: captured output and exit status. */
export interface TerminalResult extends Schema.Schema.Type<typeof TerminalResult> {}
export const TerminalResult = Schema.Struct({
  card: Schema.Literal("terminal"),
  title: optional(Schema.String),
  output: optional(Schema.String),
  exitCode: optional(Schema.Int),
  signal: optional(Schema.String),
}).annotate({ identifier: "ToolPresentation.TerminalResult" })

/** Completed file mutation rendered as an inline diff card. */
export interface DiffResult extends Schema.Schema.Type<typeof DiffResult> {}
export const DiffResult = Schema.Struct({
  card: Schema.Literal("diff"),
  title: optional(Schema.String),
  diffs: Schema.Array(FileDiff),
}).annotate({ identifier: "ToolPresentation.DiffResult" })

/** Completed content search grouped by file. */
export interface SearchMatchesResult extends Schema.Schema.Type<typeof SearchMatchesResult> {}
export const SearchMatchesResult = Schema.Struct({
  card: Schema.Literal("search"),
  shape: Schema.Literal("matches"),
  title: optional(Schema.String),
  files: Schema.Array(SearchFileMatches),
  truncated: Schema.Boolean,
  total: Schema.Int,
}).annotate({ identifier: "ToolPresentation.SearchMatchesResult" })

/** Completed path search as a flat path list. */
export interface SearchPathsResult extends Schema.Schema.Type<typeof SearchPathsResult> {}
export const SearchPathsResult = Schema.Struct({
  card: Schema.Literal("search"),
  shape: Schema.Literal("paths"),
  title: optional(Schema.String),
  paths: Schema.Array(Schema.String),
  truncated: Schema.Boolean,
  total: Schema.Int,
}).annotate({ identifier: "ToolPresentation.SearchPathsResult" })

export const SearchResult = Schema.Union([SearchMatchesResult, SearchPathsResult])
  .pipe(Schema.toTaggedUnion("shape"))
  .annotate({ identifier: "ToolPresentation.SearchResult" })
export type SearchResult = Schema.Schema.Type<typeof SearchResult>

/** Completed file read rendered as a line-numbered code view. */
export interface ReadResult extends Schema.Schema.Type<typeof ReadResult> {}
export const ReadResult = Schema.Struct({
  card: Schema.Literal("read"),
  title: optional(Schema.String),
  path: Schema.String,
  offset: Schema.Int,
  lines: Schema.Array(ReadFileLine),
  totalLines: optional(Schema.Int),
  lang: optional(Schema.String),
  content: optional(Schema.Array(ToolContent)),
}).annotate({ identifier: "ToolPresentation.ReadResult" })

/** Completed web search: structured sources the model cited. */
export interface WebSearchResult extends Schema.Schema.Type<typeof WebSearchResult> {}
export const WebSearchResult = Schema.Struct({
  card: Schema.Literal("web"),
  kind: Schema.Literal("search"),
  title: optional(Schema.String),
  sources: Schema.Array(WebSource),
  answer: optional(Schema.String),
  truncated: Schema.Boolean,
}).annotate({ identifier: "ToolPresentation.WebSearchResult" })

/** Completed web fetch: retrieval summary; the body stays in the raw result. */
export interface WebFetchResult extends Schema.Schema.Type<typeof WebFetchResult> {}
export const WebFetchResult = Schema.Struct({
  card: Schema.Literal("web"),
  kind: Schema.Literal("fetch"),
  title: optional(Schema.String),
  url: Schema.String,
  statusCode: optional(Schema.Int),
  truncated: optional(Schema.Boolean),
}).annotate({ identifier: "ToolPresentation.WebFetchResult" })

export const WebResult = Schema.Union([WebSearchResult, WebFetchResult])
  .pipe(Schema.toTaggedUnion("kind"))
  .annotate({ identifier: "ToolPresentation.WebResult" })
export type WebResult = Schema.Schema.Type<typeof WebResult>

export const Result = Schema.Union([
  GenericResult,
  TerminalResult,
  DiffResult,
  SearchResult,
  ReadResult,
  WebResult,
])
  .pipe(Schema.toTaggedUnion("card"))
  .annotate({ identifier: "ToolPresentation.Result" })
export type Result = Schema.Schema.Type<typeof Result>