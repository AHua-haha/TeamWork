---
summary: Provider connection forms, model discovery and explicit save, refresh and removal workflows.
include:
  - frontend/src/features/providers/ProvidersPage.tsx
  - frontend/src/shared/backend-client/
---

# Providers usage contract

`ProvidersPage` receives a `ConfigClient`, connection records, loading/error state, a refresh function and optional focused record id. It lists configured connections, shows protocol, endpoint and key-presence metadata, and loads each connection's model choices.

Users can add or edit a label, provider, endpoint, protocol and optional API key; existing keys remain when the secret field is blank and can be explicitly cleared. Save calls the shared client, refreshes records and attempts model discovery when needed. Users can refresh models, retry failed loads, delete a connection after confirmation, and expand model metadata.

Inputs are backend records, request outcomes and editable draft values. Outputs are rendered forms and explicit create/update/discovery/delete requests. Backend validation and credential policy remain authoritative; request errors are shown, latest records can be reviewed after an edit conflict, and supported drafts remain visible while a request fails. Secrets are sent through the client and are not persisted in feature state after the form closes.

Example:

```tsx
<ProvidersPage api={config} records={connections} loading={loading} loadError={error}
  refresh={reloadConnections} focusId={selectedId} clearFocus={clearSelection} />
```

Model metadata includes source, verification, context window, output limit and reasoning availability. A listed model is presented as a choice; successful model use remains the credential check.
