# PickSetGo feedback source

Use the current central [Feedback Triage method](https://github.com/nimbrethil81/pwa-product-ops/blob/main/operations/FEEDBACK_TRIAGE.md)
and [common contract](https://github.com/nimbrethil81/pwa-product-ops/blob/main/PRODUCT_OPERATIONS.md)
with [this product's adapter](../ops/product-operations.yml). This page owns local
source handling. The central method owns classification, evidence assessment and reporting.

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

More → Settings → About provides separate App and Workout diagnostic reports. Workout
diagnostics keeps only the latest captured Generator or Coach preview, including edits,
as allowlisted text in one local version-1 record (`gf_workout_diagnostics_v1`, capped
at 96,000 characters when serialised). If storage is unavailable, the capture stays
available for the current session. An unchanged composition keeps its original capture
time and composition build. Copying adds the currently loaded build and report time.
The snapshot describes the planned composition and cannot establish whether a session
started or finished. Fixed Workouts and standalone Prep & Recover are excluded. Neither
report is uploaded automatically.

The hosted **PWA Product Operations — Daily Review** task covers PickSetGo feedback in
its combined daily 08:00 Europe/London review window. The task is managed outside this
repository. Prompt or schedule changes require separate approval. Routine reports are ephemeral.
