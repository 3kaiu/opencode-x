use napi::{
    threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
    Error, Result, Status,
};
use napi_derive::napi;
use std::sync::Arc;

#[napi(object)]
pub struct SseStreamOptions {
    pub url: String,
    pub method: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
    pub timeout_ms: Option<i32>,
    pub max_retries: Option<i32>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct SseEvent {
    pub data: String,
    pub event_type: Option<String>,
    pub id: Option<String>,
}

type SseCallback = ThreadsafeFunction<SseEvent>;
type ErrorCallback = ThreadsafeFunction<String>;
type DoneCallback = ThreadsafeFunction<()>;

#[napi]
pub async fn stream_sse(
    options: SseStreamOptions,
    on_event: SseCallback,
    on_error: ErrorCallback,
    on_done: DoneCallback,
) -> Result<()> {
    let max_retries = options.max_retries.unwrap_or(2).max(0);
    let timeout_ms = options.timeout_ms.unwrap_or(120_000);
    let tsfn = Arc::new(on_event);
    let tsfn_error = Arc::new(on_error);
    let tsfn_done = Arc::new(on_done);

    for attempt in 0..=max_retries {
        match try_stream_once(&options, timeout_ms, &tsfn).await {
            Ok(()) => {
                let _ = tsfn_done.call(Ok(()), ThreadsafeFunctionCallMode::NonBlocking);
                return Ok(());
            }
            Err(e) => {
                if attempt < max_retries {
                    let backoff_ms = 500 * 2u64.pow(attempt as u32);
                    tokio::time::sleep(tokio::time::Duration::from_millis(backoff_ms)).await;
                    continue;
                }
                let msg = format!("{e}");
                let _ = tsfn_error.call(Ok(msg.clone()), ThreadsafeFunctionCallMode::NonBlocking);
                return Err(Error::new(Status::GenericFailure, msg));
            }
        }
    }

    let _ = tsfn_done.call(Ok(()), ThreadsafeFunctionCallMode::NonBlocking);
    Ok(())
}

async fn try_stream_once(
    options: &SseStreamOptions,
    timeout_ms: i32,
    tsfn: &Arc<SseCallback>,
) -> Result<()> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(timeout_ms as u64))
        .pool_max_idle_per_host(0)
        .build()
        .map_err(|e| Error::from_reason(format!("Failed to build HTTP client: {e}")))?;

    let method: reqwest::Method = options
        .method
        .parse()
        .map_err(|e| Error::from_reason(format!("Invalid HTTP method: {e}")))?;
    let mut req = client.request(method, &options.url);

    for (key, val) in &options.headers {
        req = req.header(key, val);
    }
    if !options.body.is_empty() {
        req = req
            .header("content-type", "application/json")
            .body(options.body.clone());
    }

    let response = req
        .send()
        .await
        .map_err(|e| Error::from_reason(format!("HTTP request failed: {e}")))?;
    let status = response.status();

    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(Error::from_reason(format!("HTTP {status}: {body}")));
    }

    let mut buf: Vec<u8> = Vec::new();
    let mut current_event_type: Option<String> = None;
    let mut current_id: Option<String> = None;
    let mut current_data = String::new();

    let mut stream = response.bytes_stream();
    use futures_util::StreamExt;

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| Error::from_reason(format!("Stream error: {e}")))?;
        for &byte in chunk.iter() {
            buf.push(byte);
            if byte == b'\n' {
                let line = String::from_utf8_lossy(&buf).trim().to_string();
                buf.clear();

                if line.is_empty() {
                    if !current_data.is_empty() {
                        let event = SseEvent {
                            data: std::mem::take(&mut current_data),
                            event_type: current_event_type.take(),
                            id: current_id.take(),
                        };
                        let _ = tsfn.call(Ok(event), ThreadsafeFunctionCallMode::NonBlocking);
                    }
                } else if let Some(value) = line.strip_prefix("data:") {
                    let trimmed = value.trim();
                    if !current_data.is_empty() {
                        current_data.push('\n');
                    }
                    current_data.push_str(trimmed);
                } else if let Some(value) = line.strip_prefix("event:") {
                    current_event_type = Some(value.trim().to_string());
                } else if let Some(value) = line.strip_prefix("id:") {
                    current_id = Some(value.trim().to_string());
                }
            }
        }
    }

    if !current_data.is_empty() {
        let event = SseEvent {
            data: std::mem::take(&mut current_data),
            event_type: current_event_type.take(),
            id: current_id.take(),
        };
        let _ = tsfn.call(Ok(event), ThreadsafeFunctionCallMode::NonBlocking);
    }

    Ok(())
}
