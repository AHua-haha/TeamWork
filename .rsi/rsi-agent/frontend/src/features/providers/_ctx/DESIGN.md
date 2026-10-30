# Providers

## Purpose and responsibilities

Providers manages the browser workflows for provider connections, credentials and model configuration. It presents forms and statuses while the backend validates, encrypts and persists provider settings.

## Interface contract

Providers uses the shared backend client for provider/model operations, keeps editable form and request state, and displays explicit validation and connection failures. It does not persist secrets directly in feature code or decide backend credential policy.

**Input:** provider records, model records, editable user configuration and request outcomes.

**Output:** provider/model configuration views and explicit save, test, refresh or removal requests.

**Effect:** browser form state and backend requests after explicit user actions; durable provider state remains backend-owned.

**Usage example:** a user enters a provider API key, submits the form, and sees the backend’s accepted record or an explicit refusal while the editable input remains available where supported.
