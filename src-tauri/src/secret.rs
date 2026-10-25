//! Recognises credentials in copied text so they never reach the disk.

struct Rule {
    prefix: &'static str,
    /// Minimum characters after the prefix.
    min: usize,
    /// Exact characters after the prefix, when the format fixes it.
    exact: Option<usize>,
    /// Kind id; the UI turns it into words in the user's language.
    name: &'static str,
}

const fn rule(prefix: &'static str, min: usize, name: &'static str) -> Rule {
    Rule { prefix, min, exact: None, name }
}

// Longer prefixes first so "sk-ant-" wins over "sk-".
const RULES: &[Rule] = &[
    rule("sk-ant-", 32, "anthropic"),
    rule("sk-proj-", 32, "openai"),
    rule("sk_live_", 16, "stripe"),
    rule("rk_live_", 16, "stripe"),
    rule("github_pat_", 40, "github"),
    rule("ghp_", 36, "github"),
    rule("gho_", 36, "github"),
    rule("ghu_", 36, "github"),
    rule("ghs_", 36, "github"),
    rule("ghr_", 36, "github"),
    rule("glpat-", 20, "gitlab"),
    rule("xoxb-", 20, "slack"),
    rule("xoxp-", 20, "slack"),
    rule("xoxa-", 20, "slack"),
    rule("xapp-", 20, "slack"),
    rule("npm_", 36, "npm"),
    rule("hf_", 30, "huggingface"),
    Rule { prefix: "AIza", min: 35, exact: Some(35), name: "google" },
    Rule { prefix: "AKIA", min: 16, exact: Some(16), name: "aws" },
    Rule { prefix: "ASIA", min: 16, exact: Some(16), name: "aws" },
    rule("sk-", 40, "openai"),
];

const BULLETS: &str = "••••••••";

fn is_token_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '-' || c == '_'
}

fn match_token(token: &str) -> Option<&'static Rule> {
    RULES.iter().find(|r| {
        let Some(body) = token.strip_prefix(r.prefix) else { return false };
        let len_ok = match r.exact {
            Some(n) => body.len() == n,
            None => body.len() >= r.min,
        };
        // AWS ids are upper-case only; everything else is a mixed token.
        let chars_ok = if r.prefix.starts_with("AKIA") || r.prefix.starts_with("ASIA") {
            body.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
        } else {
            body.chars().all(is_token_char)
        };
        len_ok && chars_ok
    })
}

fn has_private_key(text: &str) -> bool {
    text.contains("-----BEGIN") && text.contains("PRIVATE KEY-----")
}

fn tokens(text: &str) -> impl Iterator<Item = &str> {
    text.split(|c: char| !is_token_char(c)).filter(|t| !t.is_empty())
}

/// Returns the kind of secret found in `text` (e.g. "aws"), if any.
pub fn detect(text: &str) -> Option<&'static str> {
    if has_private_key(text) {
        return Some("private_key");
    }
    tokens(text).find_map(match_token).map(|r| r.name)
}

/// Keeps a recognisable prefix and the last four characters.
pub fn mask(text: &str) -> String {
    let t = text.trim();
    if t.chars().count() < 12 {
        return BULLETS.to_string();
    }
    let prefix = match_token(t).map(|r| r.prefix).unwrap_or(&t[..4]);
    let tail: String = t.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
    format!("{prefix}{BULLETS}{tail}")
}

/// Replaces every secret inside `text` with its masked form.
pub fn redact(text: &str) -> String {
    if has_private_key(text) {
        return format!("-----BEGIN PRIVATE KEY----- {BULLETS}");
    }
    let mut out = text.to_string();
    for token in tokens(text) {
        if match_token(token).is_some() {
            out = out.replace(token, &mask(token));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rand(n: usize) -> String {
        "aB3dE6gH9jK2mN5pQ8sT1vW4yZ7".chars().cycle().take(n).collect()
    }

    #[test]
    fn finds_anthropic_keys() {
        assert_eq!(detect(&format!("sk-ant-api03-{}", rand(40))), Some("anthropic"));
    }

    #[test]
    fn finds_openai_keys_inside_an_env_line() {
        let line = format!("export OPENAI_API_KEY=sk-proj-{}", rand(48));
        assert_eq!(detect(&line), Some("openai"));
    }

    #[test]
    fn finds_aws_access_keys() {
        assert_eq!(detect("AKIAIOSFODNN7EXAMPLE"), Some("aws"));
    }

    #[test]
    fn finds_github_tokens() {
        assert_eq!(detect(&format!("ghp_{}", rand(36))), Some("github"));
        assert_eq!(detect(&format!("github_pat_{}", rand(60))), Some("github"));
    }

    #[test]
    fn finds_slack_google_and_stripe() {
        assert_eq!(detect(&format!("xoxb-1234-5678-{}", rand(24))), Some("slack"));
        assert_eq!(detect(&format!("AIza{}", rand(35))), Some("google"));
        assert_eq!(detect(&format!("sk_live_{}", rand(24))), Some("stripe"));
    }

    #[test]
    fn finds_private_keys() {
        let pem = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjE\n-----END OPENSSH PRIVATE KEY-----";
        assert_eq!(detect(pem), Some("private_key"));
    }

    #[test]
    fn ignores_ordinary_text() {
        assert_eq!(detect("sk-ripsi bab 2 sudah dikirim"), None);
        assert_eq!(detect("AKIA saja"), None);
        assert_eq!(detect("ghp_short"), None);
        assert_eq!(detect("Rapat sprint dipindah ke Kamis"), None);
    }

    #[test]
    fn masks_all_but_prefix_and_last_four() {
        let key = format!("sk-ant-api03-{}wxyz", rand(36));
        assert_eq!(mask(&key), "sk-ant-••••••••wxyz");
    }

    #[test]
    fn redacts_only_the_key_inside_a_line() {
        let key = format!("sk-proj-{}9f3a", rand(44));
        let line = format!("OPENAI_API_KEY={key} # dev");
        assert_eq!(redact(&line), "OPENAI_API_KEY=sk-proj-••••••••9f3a # dev");
    }

    #[test]
    fn masks_short_secrets_completely() {
        assert_eq!(mask("abcd1234"), "••••••••");
    }
}
