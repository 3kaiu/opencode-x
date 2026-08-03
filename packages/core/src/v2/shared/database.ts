// V2 shared layer: re-exports the global singleton infrastructure from the
// legacy tree. These MUST remain single instances (a second Database or node
// registry would corrupt state), so V2 modules import them through here rather
// than copying. V2 copies only *functional* modules; infrastructure is shared.
export * as Database from "../../database/database"
