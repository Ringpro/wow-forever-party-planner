# Security

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Report them privately through GitHub instead: **Security → Report a vulnerability** on this repository.

Include what you found, how to reproduce it, and what an attacker could do with it. We'll reply as soon as we can. This is a small hobby project, so please allow a few days.

Things we especially care about:
- One group seeing another group's availability or members
- Taking over someone's account or session
- Forged Discord requests being accepted

## Secrets

No secrets belong in this repository. Production secrets live in Cloudflare (`wrangler secret put`); local ones in `apps/web/.dev.vars`, which git ignores. If you spot a committed secret, report it as above.
