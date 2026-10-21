## Result summary

Inspected accepted Team design and current mapped source. Team contains member lifecycle/configuration, shared chat timeline/publication, context assembly, response parsing, image handling and runner/system orchestration. No project source changes or tests.

## File lookup

| Path | Description |
|---|---|
| `backend/src/domain/team/team.ts` | TeamStore contract, member validation/lifecycle and run config. |
| `backend/src/domain/team/team-system.ts` | Team status/system facade. |
| `backend/src/domain/team/team-runner.ts` | Team-to-Agent run orchestration. |
| `backend/src/domain/team/group-chat.ts` | Chat validation, mentions, publication/timeline contracts. |
| `backend/src/domain/team/conversation-context.ts` | Stored context and document assembly/repair. |
| `backend/src/domain/team/member-config.ts`, `member-config-format.ts` | Review/activation and member config format. |
| `backend/src/domain/team/member-files.ts`, `member-instructions.ts`, `member-tools.ts` | Member file access and tool/instruction setup. |
| `backend/src/domain/team/member-response.ts`, `final-answer.ts` | Response/answer parsing. |
| `backend/src/domain/team/chat-images.ts` | Image validation and preparation. |
| `.rsi/context/design/backend/domain/team/design.md` | Accepted Team design. |

## Implemented contract

`TeamService` operates through injected `TeamStore`/Config dependencies. It validates member names and fields, exposes member/team views and lifecycle operations, and produces run configuration via `teamRunConfig`. `MemberConfigService` reviews changesets and performs activation planning against stored revisions/workspace-model state. Inputs are workspace/member IDs, revisioned configuration changes and activation requests; outputs are views/review results/activation state or typed application errors. Effects persist member and activation records; callers must satisfy workspace idle/revision checks.

Group-chat helpers validate entries/messages, parse `@Name` mentions, build context entries and produce publication/snapshot results via injected `ChatStore`. Chat text limit is 20,000 characters and default mention limit 32. Chat images allow max four images, 10 MiB each; `prepareChatImage(bytes, filename)` returns metadata and bytes or validation failure. `parseMemberResponse(text)` returns body, mention names and bodyOffset. `ConversationContext` reads history and documents, parses fenced context command JSON and repairs interrupted tool sequences. Example: review then activate a member changeset; publish a validated chat message and use returned timeline cursor to request subsequent changes.

## Implementation notes

Publication reserves ordered timeline/run records; actual model execution is handed to Agent via TeamRunner. HTTP transport is outside this subsystem. Design says private history clears on terminal success and survives failure/restart; confirm exact storage cleanup paths in context implementation/tests.

## Verification and continuation

Inspected declarations and source; no tests/build run. Open: trace all public service methods and Store transactions to capture exact argument/error contracts and check admission ordering, mention budget and context cleanup against tests.

## Automatic retrieval

```json
{"commands":[]}
```
