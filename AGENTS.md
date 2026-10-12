# wiki-beta implementation boundaries

- The implementation target is this `wiki-beta` repository.
- `product-kb-deploy` supplies read-only legacy reference material for parity work.
- Public pages read approved, publish-enabled rows from the `wiki_beta_content` Feishu projection.
- Public document bodies are read server-side through the Feishu reader and expose a controlled error state when unavailable.
- Management navigation keeps the existing visual shell while directing operations to the server-configured Feishu Base view, form, or workflow.
- The public client entry stays independent from the platform toolkit; the platform runtime loads at the management route boundary.
- Server credentials remain server-side and diagnostics expose configuration state without secret values.
- Keep schema changes, Base writes, sync runs, and Miaoda releases as separately authorized operations.
- Stage explicit files for commits and preserve unrelated user-owned worktree changes.
