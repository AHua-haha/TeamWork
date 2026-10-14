# Group chat identity labels

Status: complete
Task start commit: 766b72cab2a3a362656b5c76c41217ee18488355
Review boundaries: frontend group-chat presentation and parent frontend contract.

## Design outcomes

- [delivered] Move the user identity label from the input bubble to beneath the outside right avatar, matching member identity stacks.
- [delivered] Remove the visible Working history title from expanded private work, preserving its distinctive shading and fixed header divider.

## Decisions and open questions

The prototype has no user-profile name or account identity. Retain the existing You label beneath its avatar; the bubble contains only submitted text. No new account/configuration feature is introduced. The working section keeps its accessible inspection label, private content and per-run disclosure behavior.

## Checkpoints and remaining work

Delivered shared avatar/name stack styling with the user label outside the message bubble, and removed the working-section title. Frontend build, desktop/mobile browser layout checks and canonical/draft parity checks passed; see tests.jsonl. Browser checks verify name beneath avatar, unchanged input text, untitled expanded work, fixed divider, 800px maximum reading width and no page overflow. Canonical documents match the delivered code. Unrelated .claude/ files are preserved.
