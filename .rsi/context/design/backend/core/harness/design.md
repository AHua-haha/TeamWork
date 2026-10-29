# Retired Harness design reference

## Purpose and boundary

This node is retained only so existing member assignment references remain resolvable. It owns no implementation, tools, prompts or permission policy. The separate Harness system is removed. The current [React Harness system](../react-harness/design.md) is a separate Core sibling that uses Agent data-model operations.

## Interface contract

No active interface is exposed by this retired node. Agent assembles File and Default React Harnesses. Team owns assignment guidance and configuration review/activation; Workspace owns bootstrap templates.

## Constraints

Initial React Harness tools have no design/path, command, sandbox or Git approval gates. Preserve existing files, context/history identities, signatures and durable file-state records. Passive legacy member fields do not restore enforcement. Future member configuration representation and permission policy require separate design.
