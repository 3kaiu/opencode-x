#[macro_use]
extern crate napi_derive;

use std::sync::OnceLock;
use tiktoken_rs::CoreBPE;

static CL100K: OnceLock<CoreBPE> = OnceLock::new();

fn get_cl100k() -> &'static CoreBPE {
    CL100K.get_or_init(|| tiktoken_rs::cl100k_base().expect("Failed to load cl100k_base tokenizer"))
}

#[napi]
pub fn hello() -> String {
    "hello from opencode-x native".to_string()
}

#[napi]
pub fn count_tokens(text: String, model: Option<String>) -> i32 {
    let bpe = match model.as_deref() {
        Some("gpt-4" | "gpt-4-32k" | "gpt-4-turbo" | "gpt-4o" | "gpt-4o-mini" | "gpt-3.5-turbo" | "gpt-35-turbo") => get_cl100k(),
        Some("text-davinci-003" | "text-davinci-002") => {
            static P50K: OnceLock<CoreBPE> = OnceLock::new();
            P50K.get_or_init(|| tiktoken_rs::p50k_base().expect("Failed to load p50k_base"))
        }
        Some("text-davinci-001" | "text-ada-001" | "text-babbage-001" | "text-curie-001") => {
            static R50K: OnceLock<CoreBPE> = OnceLock::new();
            R50K.get_or_init(|| tiktoken_rs::r50k_base().expect("Failed to load r50k_base"))
        }
        _ => get_cl100k(),
    };
    bpe.encode_with_special_tokens(&text).len() as i32
}

#[napi]
pub fn count_tokens_estimate(text: String) -> i32 {
    get_cl100k().encode_with_special_tokens(&text).len() as i32
}
