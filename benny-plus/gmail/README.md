# Gmail import

The current flow reads Gmail in the browser through the importing user’s own Google connection. No sandbox approval is needed.

Workspace owners import in the main app. Visitors install `helper.jsx` in their own Mana workspace, where the owner-only OAuth proxy uses their connection. The helper returns to Benny+ when finished.

Each run checks up to 25 receipt-like messages with eight workers. Imported documents persist in the private API; duplicates and previously skipped non-purchases return without another AI read. No mailbox content or credentials belong in this repository.

`import_sandbox_legacy.py` preserves the earlier sandbox importer for reference; the app no longer invokes it.
