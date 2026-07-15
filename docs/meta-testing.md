# Meta Events Manager QA

1. Set `META_TEST_EVENT_CODE` in the Vercel environment and redeploy.
2. In Events Manager, open Test events and use the same code.
3. Open the published Framer page, accept analytics consent, refresh once, then click an official Telegram CTA.
4. Confirm `PageView`, `ViewContent` and `Lead` arrive. Browser and server `Lead` records should have the same event ID and be deduplicated.
5. Click Support and confirm `Contact` is sent instead of `Lead`.
6. Remove the test code after validation. Never send a browser `Purchase`; the API rejects it without `x-orion-internal-secret`.
