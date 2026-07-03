use napi_derive::napi;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
#[napi(object)]
pub struct EnvInput {
    pub model_id: String,
    pub provider_id: String,
    pub directory: String,
    pub worktree: String,
    pub is_git: bool,
    pub platform: String,
    pub date: String,
}

#[derive(Serialize, Deserialize)]
#[napi(object)]
pub struct ReferenceInfo {
    pub name: String,
    pub path: String,
    pub description: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[napi(object)]
pub struct SkillInfo {
    pub name: String,
    pub description: Option<String>,
    pub location: String,
}

#[derive(Serialize, Deserialize)]
#[napi(object)]
pub struct McpInstruction {
    pub name: String,
    pub instructions: String,
    pub tools: Vec<String>,
}

#[napi]
pub fn select_provider_template(model_id: String) -> String {
    if model_id.contains("gpt-4") || model_id.contains("o1") || model_id.contains("o3") {
        String::from("beast")
    } else if model_id.contains("gpt") {
        if model_id.contains("codex") {
            String::from("codex")
        } else {
            String::from("gpt")
        }
    } else if model_id.contains("gemini-") {
        String::from("gemini")
    } else if model_id.contains("claude") {
        String::from("anthropic")
    } else if model_id.to_lowercase().contains("trinity") {
        String::from("trinity")
    } else if model_id.to_lowercase().contains("kimi") {
        String::from("kimi")
    } else {
        String::from("default")
    }
}

#[napi]
pub fn assemble_environment(
    env: EnvInput,
    references: Vec<ReferenceInfo>,
) -> String {
    let mut block = format!(
        "You are powered by the model named {}. The exact model ID is {}/{}\n\
         Here is some useful information about the environment you are running in:\n\
         <env>\n\
         \x20 Working directory: {}\n\
         \x20 Workspace root folder: {}\n\
         \x20 Is directory a git repo: {}\n\
         \x20 Platform: {}\n\
         \x20 Today's date: {}\n\
         </env>",
        env.model_id,
        env.provider_id,
        env.model_id,
        env.directory,
        env.worktree,
        if env.is_git { "yes" } else { "no" },
        env.platform,
        env.date,
    );

    if !references.is_empty() {
        let mut refs = String::from(
            "\nProject references provide additional directories that can be accessed when relevant.\n\
             <available_references>",
        );
        let mut sorted: Vec<&ReferenceInfo> = references.iter().collect();
        sorted.sort_by(|a, b| a.name.cmp(&b.name));
        for r in &sorted {
            refs.push_str(&format!("\n  <reference>\n    <name>{}</name>\n    <path>{}</path>", r.name, r.path));
            if let Some(desc) = &r.description {
                refs.push_str(&format!("\n    <description>{}</description>", desc));
            }
            refs.push_str("\n  </reference>");
        }
        refs.push_str("\n</available_references>");
        block.push('\n');
        block.push_str(&refs);
    }

    block
}

#[napi]
pub fn assemble_skills_block(skills: Vec<SkillInfo>, verbose: bool) -> String {
    let described: Vec<&SkillInfo> = skills.iter().filter(|s| s.description.is_some()).collect();
    if described.is_empty() {
        return String::from("No skills are currently available.");
    }

    let mut sorted: Vec<&&SkillInfo> = described.iter().collect();
    sorted.sort_by(|a, b| a.name.cmp(&b.name));

    if verbose {
        let mut result = String::from("<available_skills>");
        for skill in &sorted {
            result.push_str(&format!(
                "\n  <skill>\n    <name>{}</name>\n    <description>{}</description>\n    <location>{}</location>\n  </skill>",
                skill.name,
                skill.description.as_deref().unwrap_or(""),
                skill.location
            ));
        }
        result.push_str("\n</available_skills>");
        result
    } else {
        let mut result = String::from("## Available Skills");
        for skill in &sorted {
            result.push_str(&format!(
                "\n- **{}**: {}",
                skill.name,
                skill.description.as_deref().unwrap_or("")
            ));
        }
        result
    }
}

#[napi]
pub fn assemble_mcp_block(instructions: Vec<McpInstruction>) -> String {
    if instructions.is_empty() {
        return String::new();
    }

    let mut result = String::from("<mcp_instructions>");
    for item in &instructions {
        result.push_str(&format!("\n  <server name=\"{}\">", escape_xml(&item.name)));
        for line in item.instructions.lines() {
            result.push_str(&format!("\n    {}", line));
        }
        result.push_str("\n  </server>");
    }
    result.push_str("\n</mcp_instructions>");
    result
}

fn escape_xml(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[napi]
pub fn assemble_system_prompt(
    agent_prompt: Option<String>,
    provider_template: String,
    env_block: String,
    instruction_block: Vec<String>,
    skills_block: String,
    user_system: Option<String>,
    json_schema: bool,
) -> Vec<String> {
    let mut parts: Vec<String> = Vec::new();

    let base = agent_prompt.unwrap_or(provider_template);

    let mut system_parts: Vec<&str> = Vec::new();
    system_parts.push(&base);
    system_parts.push(&env_block);
    for inst in &instruction_block {
        system_parts.push(inst);
    }
    if !skills_block.is_empty() {
        system_parts.push(&skills_block);
    }

    let system_str = system_parts.join("\n");
    parts.push(system_str);

    if let Some(us) = user_system {
        if !us.is_empty() {
            parts.push(us);
        }
    }

    if json_schema {
        parts.push(String::from(STRUCTURED_OUTPUT));
    }

    parts
}

static STRUCTURED_OUTPUT: &str = "\
You are a function that outputs valid JSON. Never include any text before or after the JSON object. \
Your output must always be a single JSON object that conforms to the provided schema. \
Do not wrap the JSON in markdown code blocks or any other formatting.";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_select_provider_template() {
        assert_eq!(select_provider_template("claude-sonnet-4".into()), "anthropic");
        assert_eq!(select_provider_template("gpt-4o".into()), "beast");
        assert_eq!(select_provider_template("gpt-4o-codex".into()), "beast");
        assert_eq!(select_provider_template("gpt-4".into()), "beast");
        assert_eq!(select_provider_template("o1-preview".into()), "beast");
        assert_eq!(select_provider_template("gemini-2.5-pro".into()), "gemini");
        assert_eq!(select_provider_template("trinity-v1".into()), "trinity");
        assert_eq!(select_provider_template("kimi-v2".into()), "kimi");
        assert_eq!(select_provider_template("unknown-model".into()), "default");
    }

    #[test]
    fn test_environment_block() {
        let env = EnvInput {
            model_id: "gpt-4".into(),
            provider_id: "openai".into(),
            directory: "/home/user/project".into(),
            worktree: "/home/user/project".into(),
            is_git: true,
            platform: "darwin".into(),
            date: "Mon Jan 1 2024".into(),
        };
        let result = assemble_environment(env, vec![]);
        assert!(result.contains("You are powered by the model named gpt-4"));
        assert!(result.contains("Is directory a git repo: yes"));
        assert!(result.contains("Platform: darwin"));
    }

    #[test]
    fn test_environment_with_references() {
        let env = EnvInput {
            model_id: "gpt-4".into(),
            provider_id: "openai".into(),
            directory: "/home/user/project".into(),
            worktree: "/home/user/project".into(),
            is_git: true,
            platform: "darwin".into(),
            date: "Mon Jan 1 2024".into(),
        };
        let refs = vec![ReferenceInfo {
            name: "shared-lib".into(),
            path: "/home/user/shared".into(),
            description: Some("Shared library".into()),
        }];
        let result = assemble_environment(env, refs);
        assert!(result.contains("available_references"));
        assert!(result.contains("shared-lib"));
    }

    #[test]
    fn test_skills_block_verbose() {
        let skills = vec![
            SkillInfo {
                name: "test".into(),
                description: Some("A test skill".into()),
                location: "/skills/test/SKILL.md".into(),
            },
        ];
        let result = assemble_skills_block(skills.clone(), true);
        assert!(result.contains("<available_skills>"));
        assert!(result.contains("test"));
        assert!(result.contains("A test skill"));

        let result2 = assemble_skills_block(skills, false);
        assert!(result2.contains("## Available Skills"));
        assert!(result2.contains("test"));
    }

    #[test]
    fn test_mcp_block() {
        let instructions = vec![McpInstruction {
            name: "my-server".into(),
            instructions: "Do something".into(),
            tools: vec!["tool1".into()],
        }];
        let result = assemble_mcp_block(instructions);
        assert!(result.contains("my-server"));

        let empty: Vec<McpInstruction> = vec![];
        assert!(assemble_mcp_block(empty).is_empty());
    }

    #[test]
    fn test_system_prompt_assembly() {
        let result = assemble_system_prompt(
            None,
            "default prompt".into(),
            "env block".into(),
            vec!["instruction 1".into()],
            "skills block".into(),
            None,
            false,
        );
        assert_eq!(result.len(), 1);
        assert!(result[0].contains("default prompt"));
        assert!(result[0].contains("env block"));
        assert!(result[0].contains("instruction 1"));
    }
}
