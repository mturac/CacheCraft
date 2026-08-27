# Security Policy

## Supported versions

Security fixes are provided for the latest released minor version.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's private vulnerability reporting feature for this repository. Include:

- the affected version or commit;
- a minimal reproduction;
- expected and observed behavior;
- any impact on prompt confidentiality, cache isolation, or generated provider payloads.

CacheCraft never sends prompt content to a remote service. Consumers remain responsible for protecting input plan files, generated payloads, and provider credentials.
