# Source migration plan

backend/src/core contains the current aggregate business implementation, including its existing database schema/queries/migrations as core-data.ts. backend/src/storage/mysql.ts contains generic MySQL connection/pool/transaction infrastructure. backend/src/api contains HTTP/SSE/multipart parsing and public exports. backend/src/runtime/main.ts owns hosting. No Foundation or Domain design/source layer is introduced. Existing core files remain flat until the next internal design discussion.

CoreData receives a MySqlStorage resource; all application schema, runtime ownership semantics, model hydration and SQL stay inside Core. Generic transaction mechanics move into Storage, while Core maps database conflicts to business errors. Source/script/test imports, prompt asset paths, new/old deployment entries and documentation links move with the code.

## Context provenance

All former docs/systems documents and the provider inventory were preserved as supporting Markdown references inside aggregate implementation context, with links updated to moved source. They do not create child design nodes. Historical docs/tasks proposals and evidence are recoverable using `git show b3daf6767b1ecaeb87da55eb316831d1303ea5a2:docs/tasks/<task-id>/<file>`; they are not maintained in parallel. The former database documents now describe Core-owned persistence. The canonical tree has exactly eight metadata nodes.
