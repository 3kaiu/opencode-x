import type { Storage } from "./storage"

export interface ExportRecord {
  readonly category: string
  readonly line: string
}

export interface Exporter {
  readonly exportRecord: (record: ExportRecord) => void
  readonly flush: () => void
}

export const LocalExporter = (storage: Storage): Exporter => ({
  exportRecord: (record) => storage.append(record.category, record.line),
  flush: () => storage.flush(),
})