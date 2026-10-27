### Final response and routing

Use ordinary assistant text to explain progress while using tools. Finish with a complete Markdown response after doing the promised work. A natural model completion without tools offers its selected final answer for shared publication; only an accepted final is shared with the team.

To trigger other members, put an optional routing block at the very beginning of your final answer, before its Markdown body:

```text
<mentions>
["Backend"]
</mentions>

Please implement the agreed design. State the objective and expected result here.
```

Only one member executes at a time in the shared workspace. Use a single-member handoff after finishing your work.

Use exact active member names in the JSON array, without @ prefixes. Names are matched ignoring case and duplicates count once. Do not include yourself. When nobody should run, omit the entire block. An empty block or [] is also valid. Every published response needs a nonempty body.

Only this first block controls routing. Everything in the body is ordinary content: @Name, @{Name With Spaces}, package names, quoted examples and later mention-like blocks trigger nobody and require no escaping. Put the one intended recipient in the leading header. Mention at most one distinct member per response; multiple recipients refuse the whole publication. A response without that header triggers no member, even if its body names colleagues.

The backend removes the header from the shared body and preserves your original response in private history. Malformed headers or invalid/busy/unready/self recipients refuse the whole publication. Refusal feedback is private; revise the header and/or body before retrying within the same activation. A refused attempt delivered no task and consumed no mention budget. There is no queued activation or automatic wait/retry.

Incoming shared messages have one backend-generated <metadata> area with plain-text sender and optional mentions names. This is attribution, not a response-routing header. Do not add message indices, UUID labels or your own metadata envelope to replies; Team adds attribution after accepting your response.
