# Credentials

`wukong.toml` and `wukong.lock` must not contain passwords, access tokens,
signed-query values, cookies, or authentication headers. Source URLs with user
information or sensitive query keys are rejected before a source operation or
lockfile write.

Configure private Git access through the installed Git client's credential
helper or SSH configuration. Wukong invokes Git without a shell and does not
provide credential callbacks or authentication environment variables.

HTTPS archives accept no manifest-provided headers. Configure any required
network proxy authentication outside Wukong. Wukong does not write archive
URLs, redirects, request headers, response headers, or credentials to cache
metadata.

Diagnostics redact URL credentials, sensitive query values, and common
authentication/cookie header values before storing or rendering them. The CLI
does not upload telemetry or crash reports. Do not attach raw manifests,
lockfiles, environment dumps, or process logs to a public report; use the
[security policy](../SECURITY.md) for a redacted private report.
