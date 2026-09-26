# Sa711 — Claude Code Skills

52 programming and design skills for Claude Code.

## Install everything with one command

Run in any terminal (or paste it to Claude in a new conversation and ask it to run it):

```bash
git clone --depth 1 https://github.com/saeedoo274-maker/Sa711.git /tmp/sa711 && mkdir -p ~/.claude/skills && cp -r /tmp/sa711/.claude/skills/* ~/.claude/skills/ && rm -rf /tmp/sa711 && ls ~/.claude/skills
```

This installs the skills at user level (`~/.claude/skills`), so they work in every project on that machine.
Sessions opened on this repository load them automatically from `.claude/skills/` with no install step.

To pull the latest upstream versions of the third-party skills later: `npx skills update`.

## Skills

| Skill | Source | What it does |
|---|---|---|
| `api-design-principles` | wshobson/agents | Master REST and GraphQL API design principles to build intuitive, scalable, and maintainable APIs that delight develo… |
| `brainstorming` | obra/superpowers | You MUST use this before any creative work - creating features, building components, adding functionality, or modifyi… |
| `canvas-design` | anthropics/skills | Create beautiful visual art in .png and .pdf documents using design philosophy. You should use this skill when the us… |
| `caveman-commit` | juliusbrussee/caveman | Write a Conventional Commits message compressed to intent only. Use for "write a commit", "commit message", /commit o… |
| `caveman-compress` | juliusbrussee/caveman | Compress a memory file such as CLAUDE.md or a todo list into caveman format to save input tokens, keeping a readable … |
| `caveman` | juliusbrussee/caveman | Ultra-compressed communication mode that cuts output tokens while keeping technical accuracy. Levels: lite, full, ult… |
| `clean-code` | sickn33/agentic-awesome-skills | This skill embodies the principles of "Clean Code" by Robert C. Martin (Uncle Bob). Use it to transform "code that wo… |
| `design-taste-frontend` | leonxlnx/taste-skill | Anti-slop frontend skill for landing pages, portfolios, and redesigns. The agent reads the brief, infers the right de… |
| `diagnosing-bugs` | mattpocock/skills | Diagnosis loop for hard bugs and performance regressions. Use when the user says "diagnose"/"debug this", or reports … |
| `domain-modeling` | mattpocock/skills | Build and sharpen a project's domain model. Use when discussing codebase terminology, writing or editing a CONTEXT.md… |
| `emil-design-eng` | emilkowalski/skills | This skill encodes Emil Kowalski's philosophy on UI polish, component design, animation decisions, and the invisible … |
| `error-handling-patterns` | wshobson/agents | Master error handling patterns across languages including exceptions, Result types, error propagation, and graceful d… |
| `executing-plans` | obra/superpowers | Use when executing an implementation plan in the current session as the implementer yourself — your human partner cho… |
| `find-skills` | custom (this repo) | Helps users discover and install agent skills when they ask questions like "how do I do X", "find a skill for X", "is… |
| `frontend-design` | anthropics/skills | Guidance for distinctive, intentional visual design when building new UI or reshaping an existing one. Helps with aes… |
| `git-commit` | github/awesome-copilot | Execute git commit with conventional commit message analysis, intelligent staging, and message generation. Use when u… |
| `grill-me` | mattpocock/skills | A relentless interview to sharpen a plan or design. |
| `grill-with-docs` | mattpocock/skills | A relentless interview to sharpen a plan or design, which also creates docs (ADR's and glossary) as we go. |
| `high-end-visual-design` | leonxlnx/taste-skill | Teaches the AI to design like a high-end agency. Defines the exact fonts, spacing, shadows, card structures, and anim… |
| `implement` | mattpocock/skills | Implement a piece of work based on a spec or set of tickets. |
| `improve-animations` | emilkowalski/skills | Survey a codebase's animation and motion code as a senior motion advisor, then produce a prioritized audit and self-c… |
| `improve-codebase-architecture` | mattpocock/skills | Scan a codebase for deepening opportunities, present them as a visual HTML report, then grill through whichever one y… |
| `javascript-json` | custom (this repo) | Correct, safe, and fast JSON handling in JavaScript/TypeScript. Use when parsing, validating, serializing, transformi… |
| `javascript-testing-patterns` | wshobson/agents | Implement comprehensive testing strategies using Jest, Vitest, and Testing Library for unit tests, integration tests,… |
| `javascript-typescript-jest` | github/awesome-copilot | Best practices for writing JavaScript/TypeScript tests using Jest, including mocking strategies, test structure, and … |
| `mcp-builder` | anthropics/skills | Guide for creating high-quality MCP (Model Context Protocol) servers that enable LLMs to interact with external servi… |
| `modern-javascript-patterns` | wshobson/agents | Master ES6+ features including async/await, destructuring, spread operators, arrow functions, promises, modules, iter… |
| `nodejs-backend-patterns` | wshobson/agents | Build production-ready Node.js backend services with Express/Fastify, implementing middleware patterns, error handlin… |
| `performance-optimization` | addyosmani/agent-skills | Optimizes application performance across frontend, backend, queries, and databases. Use when performance requirements… |
| `prototype` | mattpocock/skills | Build a throwaway prototype to answer a design question. Use when the user wants to sanity-check whether a state mode… |
| `receiving-code-review` | obra/superpowers | Use when receiving code review feedback, before implementing suggestions, especially if feedback seems unclear or tec… |
| `redesign-existing-projects` | leonxlnx/taste-skill | Upgrades existing websites and apps to premium quality. Audits current design, identifies generic AI patterns, and ap… |
| `refactor` | github/awesome-copilot | Surgical code refactoring to improve maintainability without changing behavior. Covers extracting functions, renaming… |
| `requesting-code-review` | obra/superpowers | Use when completing tasks, implementing major features, or before merging to verify work meets requirements |
| `resolving-merge-conflicts` | mattpocock/skills | Use when you need to resolve an in-progress git merge/rebase conflict. |
| `shadcn` | shadcn/ui | Manages shadcn components and projects — adding, searching, fixing, debugging, styling, and composing UI, including c… |
| `subagent-driven-development` | obra/superpowers | Use when executing implementation plans with independent tasks in the current session |
| `supabase-postgres-best-practices` | supabase/agent-skills | Postgres best practices maintained by Supabase, for Postgres running anywhere. Load this skill BEFORE writing or chan… |
| `systematic-debugging` | obra/superpowers | Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes |
| `tdd` | mattpocock/skills | Test-driven development. Use when the user wants to build features or fix bugs test-first, mentions "red-green-refact… |
| `to-spec` | mattpocock/skills | Turn the current conversation into a spec and publish it to the project issue tracker: no interview, just synthesis o… |
| `typescript-advanced-types` | wshobson/agents | Master TypeScript's advanced type system including generics, conditional types, mapped types, template literals, and … |
| `ui-ux-pro-max` | nextlevelbuilder/ui-ux-pro-max-skill | UI/UX design intelligence for web, mobile, and desktop. This skill should be used when designing, building, reviewing… |
| `vercel-composition-patterns` | vercel-labs/agent-skills | React composition patterns that scale. Use when refactoring components with boolean prop proliferation, building flex… |
| `vercel-react-best-practices` | vercel-labs/agent-skills | React and Next.js performance optimization guidelines from Vercel Engineering. This skill should be used when writing… |
| `vercel-react-native-skills` | vercel-labs/agent-skills | React Native and Expo best practices for building performant mobile apps. Use when building React Native components, … |
| `verification-before-completion` | obra/superpowers | Use when about to claim work is complete, fixed, or passing, before committing or creating PRs - requires running ver… |
| `web-artifacts-builder` | anthropics/skills | Suite of tools for creating elaborate, multi-component claude.ai HTML artifacts using modern frontend web technologie… |
| `web-design-guidelines` | vercel-labs/agent-skills | Review UI code for Web Interface Guidelines compliance. Use when asked to "review my UI", "check accessibility", "aud… |
| `webapp-testing` | anthropics/skills | Toolkit for interacting with and testing local web applications using Playwright. Supports verifying frontend functio… |
| `writing-plans` | obra/superpowers | Use when you have a spec or requirements for a multi-step task, before touching code |
| `zod` | pproenca/dot-skills | Zod schema validation best practices for type safety, parsing, and error handling. This skill should be used when def… |
