use napi::bindgen_prelude::*;
use napi_derive::napi;
use rusqlite::OpenFlags;
use std::sync::Mutex;

struct DbInner {
    conn: rusqlite::Connection,
}

#[napi]
pub struct Database {
    inner: Mutex<DbInner>,
}

#[napi]
impl Database {
    #[napi(constructor)]
    pub fn new(path: String) -> Result<Self> {
        let conn = rusqlite::Connection::open_with_flags(
            &path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
        )
        .map_err(|e| Error::from_reason(format!("Failed to open database: {e}")))?;

        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA busy_timeout = 5000;
             PRAGMA cache_size = -64000;
             PRAGMA foreign_keys = ON;",
        )
        .map_err(|e| Error::from_reason(format!("Failed to set PRAGMAs: {e}")))?;

        Ok(Database {
            inner: Mutex::new(DbInner { conn }),
        })
    }

    #[napi]
    pub fn exec(&self, sql: String, params: Vec<serde_json::Value>) -> Result<i32> {
        let guard = self
            .inner
            .lock()
            .map_err(|e| Error::from_reason(format!("Lock error: {e}")))?;

        let sql_params = json_to_rusqlite_params(params);
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            sql_params.iter().map(|p| p as &dyn rusqlite::types::ToSql).collect();

        let count = guard.conn.execute(&sql, param_refs.as_slice()).map_err(|e| {
            Error::from_reason(format!("Execute error: {e}"))
        })?;

        Ok(count as i32)
    }

    #[napi]
    pub fn query_all(
        &self,
        sql: String,
        params: Vec<serde_json::Value>,
    ) -> Result<Vec<serde_json::Value>> {
        let guard = self
            .inner
            .lock()
            .map_err(|e| Error::from_reason(format!("Lock error: {e}")))?;

        let sql_params = json_to_rusqlite_params(params);
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            sql_params.iter().map(|p| p as &dyn rusqlite::types::ToSql).collect();

        let mut stmt = guard.conn.prepare(&sql).map_err(|e| {
            Error::from_reason(format!("Prepare error: {e}"))
        })?;

        let column_names: Vec<String> = stmt.column_names().iter().map(|c| c.to_string()).collect();

        let row_iter = stmt
            .query_map(param_refs.as_slice(), |row| {
                let mut obj = serde_json::Map::new();
                for (i, name) in column_names.iter().enumerate() {
                    let val: rusqlite::types::Value = row.get(i)?;
                    obj.insert(name.clone(), rusqlite_value_to_json(val));
                }
                Ok(serde_json::Value::Object(obj))
            })
            .map_err(|e| Error::from_reason(format!("Query error: {e}")))?;

        let mut rows = Vec::new();
        for row_result in row_iter {
            rows.push(
                row_result.map_err(|e| Error::from_reason(format!("Row error: {e}")))?,
            );
        }

        Ok(rows)
    }

    #[napi]
    pub fn query_values(
        &self,
        sql: String,
        params: Vec<serde_json::Value>,
    ) -> Result<Vec<Vec<serde_json::Value>>> {
        let guard = self
            .inner
            .lock()
            .map_err(|e| Error::from_reason(format!("Lock error: {e}")))?;

        let sql_params = json_to_rusqlite_params(params);
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            sql_params.iter().map(|p| p as &dyn rusqlite::types::ToSql).collect();

        let mut stmt = guard.conn.prepare(&sql).map_err(|e| {
            Error::from_reason(format!("Prepare error: {e}"))
        })?;

        let ncols = stmt.column_count();

        let row_iter = stmt
            .query_map(param_refs.as_slice(), |row| {
                let mut values = Vec::with_capacity(ncols);
                for i in 0..ncols {
                    let val: rusqlite::types::Value = row.get(i)?;
                    values.push(rusqlite_value_to_json(val));
                }
                Ok(values)
            })
            .map_err(|e| Error::from_reason(format!("Query error: {e}")))?;

        let mut rows = Vec::new();
        for row_result in row_iter {
            rows.push(
                row_result.map_err(|e| Error::from_reason(format!("Row error: {e}")))?,
            );
        }

        Ok(rows)
    }
}

fn rusqlite_value_to_json(val: rusqlite::types::Value) -> serde_json::Value {
    match val {
        rusqlite::types::Value::Null => serde_json::Value::Null,
        rusqlite::types::Value::Integer(n) => serde_json::Value::Number(n.into()),
        rusqlite::types::Value::Real(f) => serde_json::json!(f),
        rusqlite::types::Value::Text(s) => serde_json::Value::String(s),
        rusqlite::types::Value::Blob(b) => {
            serde_json::Value::Array(b.into_iter().map(|byte| serde_json::Value::Number((byte).into())).collect())
        }
    }
}

fn json_to_rusqlite_params(params: Vec<serde_json::Value>) -> Vec<rusqlite::types::Value> {
    params
        .into_iter()
        .map(|v| match v {
            serde_json::Value::Null => rusqlite::types::Value::Null,
            serde_json::Value::Bool(b) => rusqlite::types::Value::Integer(b as i64),
            serde_json::Value::Number(n) => {
                if let Some(i) = n.as_i64() {
                    rusqlite::types::Value::Integer(i)
                } else if let Some(f) = n.as_f64() {
                    rusqlite::types::Value::Real(f)
                } else {
                    rusqlite::types::Value::Null
                }
            }
            serde_json::Value::String(s) => rusqlite::types::Value::Text(s),
            serde_json::Value::Array(arr) => {
                rusqlite::types::Value::Text(serde_json::to_string(&arr).unwrap_or_default())
            }
            serde_json::Value::Object(obj) => {
                rusqlite::types::Value::Text(serde_json::to_string(&obj).unwrap_or_default())
            }
        })
        .collect()
}
