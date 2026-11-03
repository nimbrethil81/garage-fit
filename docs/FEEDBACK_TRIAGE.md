# PickSetGo feedback source

Use the current central [Feedback Triage method](https://github.com/nimbrethil81/pwa-product-ops/blob/main/operations/FEEDBACK_TRIAGE.md)
and [common contract](https://github.com/nimbrethil81/pwa-product-ops/blob/main/PRODUCT_OPERATIONS.md)
with [this product's adapter](../ops/product-operations.yml). This page owns only local
source handling; the central method owns classification, evidence assessment and reporting.

- Source: the connected Gmail account **picksetgoapp@gmail.com**; verify the selected
  account before reading. Support reporting uses subject **PickSetGo — Problem report**
  and user-supplied text, screenshots or diagnostics ([#375](https://github.com/nimbrethil81/garage-fit/issues/375)).
  Search beyond unread/inbox mail so archived substantive follow-ups are considered.
- Destination: **nimbrethil81/garage-fit**, despite the PickSetGo public name. Search open
  and completed issues before proposing a sanitised development handover. An approved
  issue authorises planning only; implementation requires a separate instruction.
- Access: opt-in permits Observe/Prepare only through the authorised Gmail connection.
  Obtain explicit human approval of each specific GitHub issue creation/update, external
  reply, status/label change or archive operation. Approval of one does not authorise the
  others. Prepare drafts in the decision report; do not save Gmail drafts automatically.

## Existing Gmail disposition

Apply exactly one appropriate feedback status only after specific approval:

| Existing label | Local meaning |
| --- | --- |
| Feedback / Awaiting review | Needs a decision or renewed review. |
| Feedback / Awaiting information | Clarification or evidence remains outstanding. |
| Feedback / Logged | Approved follow-up has actually been recorded in an existing/new issue. |
| Feedback / Deferred | Explicitly deferred, with the reason/revisit condition in source history. |
| Feedback / Closed | Approved no-action or resolved disposition. |

Archive completed items only with approval; leave unresolved items visible. Logged does
not mean fixed or customer-resolved. Reading/unread status is not evidence of processing.
Use thread/message history and the latest substantive update alongside labels; suppress
unchanged processed items. Substantive replies or new evidence reopen assessment even on
archived/Logged/Closed threads; propose renewed review and any necessary status change,
without changing the inbox automatically. Disclose uncertain prior disposition.

Ignore account/security notifications and spam for feedback triage, leaving them untouched.
Internal test reports generally need no reply; propose an acknowledgement for genuine
external customers, subject to approval. Missing connector access or unreadable attachments
must be reported as coverage limitations; request the minimum missing evidence and leave
the case unresolved rather than claiming an empty inbox or inferring screenshot contents.

Keep original evidence in Gmail. This repository is public: propose only approved,
sanitised details for issues. A coding agent needs an approved sanitised excerpt or a
separately authorised, securely accessible visual handover; a private Gmail link or
ChatGPT-only attachment does not establish that access. Do not upload private evidence.

The existing **PickSetGo Feedback Triage** daily ChatGPT task runs in the 08:00
Europe/London window. Reuse it; do not create another scheduler. Prompt changes require
separate approval. Routine reports remain ephemeral, as required by the central method.
