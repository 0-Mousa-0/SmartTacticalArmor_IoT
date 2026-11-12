# Documentation

| # | Document | What it covers |
|---|---|---|
| 01 | [High-level plan](01-high-level-plan.md) | Problem, scope, phased roadmap, requirements, architecture decisions, free-tier budgets, risks, milestones, quality gates |
| 02 | [Structural UML](02-uml-structural.md) | Deployment, components, packages (backend, frontend, firmware), domain model, layers, firmware classes, database ERD |
| 03 | [Behavioral UML](03-uml-behavioral.md) | Use cases, sequence diagrams (telemetry and AI, fall escalation, commands, Last Will, sign-in, live refresh), state machines, activity diagrams |
| 04 | [REST API reference](04-api-reference.md) | Every endpoint, roles, errors and real example payloads (Swagger UI: `/api/v1/docs`) |
| 05 | [MQTT protocol](05-mqtt-protocol.md) | Topics, QoS, payloads, alert bitmask, commands, delivery guarantees, bandwidth |
| 06 | [Supabase setup](06-setup-supabase.md) | Create the PostgreSQL database and connect the backend |
| 07 | [EMQX setup](07-setup-emqx.md) | Create the MQTT broker, accounts and access rules |
| 08 | [Render deployment](08-deploy-render.md) | Deploy the API and the dashboard from `render.yaml` |
| 09 | [SCM and QA](09-scm-and-qa.md) | Branching, versioning, configuration, migrations, CI/CD, test strategy, defects, definition of done |
| 10 | [Technical overview](10-technical-overview.md) | End-to-end block diagram, the protocol on every link, languages, frameworks and versions, hardware, cloud services, security, timing |

Component guides: [backend](../backend/README.md) · [frontend](../frontend/README.md) ·
[firmware](../firmware/README.md) · [simulator](../tools/simulator/README.md) · [end-to-end test](../tools/e2e/README.md)

## Suggested reading order

| You are… | Read |
|---|---|
| A judge or reviewer | 10 (the whole system on one page) → 01 → 03 (fall sequence) → the screenshots in the main README |
| Setting the system up | 06 → 07 → 08 → [firmware](../firmware/README.md) |
| A developer joining the project | 01 → 02 → 09 → the backend and frontend READMEs → 04 / 05 when needed |

The diagrams are written in [Mermaid](https://mermaid.js.org), which GitHub renders directly in the
browser.
