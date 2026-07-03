#[macro_use]
extern crate napi_derive;

#[napi]
pub fn hello() -> String {
    "hello from opencode-x native".to_string()
}
