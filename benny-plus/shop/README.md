# Benny+ Shop browsers

- `install_shop_browser.py`: per-user installer. Benny+ copies it into the user's own Mana workspace and runs it in their own sandbox (`benny-shop` service). Card autofill details are encrypted in that user's sandbox.
- `hosted_server.py`: fallback for Mana accounts that can't run their own sandbox yet (the setup call returns 402/403). One shared service in the Benny+ host's sandbox (`benny-shop-hosted`), with:
  - a private, isolated browser context per user (separate cookies and sign-ins), closed after 15 idle minutes, at most 6 at once;
  - access only for signed-in users who already have Benny+ records (identity from Mana forward-auth `X-Sender-Uid`);
  - all traffic through a built-in egress proxy that refuses loopback, private, link-local and internal destinations (including redirects and WebSockets), and blocked service workers;
  - per-user encrypted autofill cards that are never returned to a browser. Nothing clicks Place order or pays.

The app records the choice as `<uid>/file-system/benny-shop/service = {hosted: true}` and reads the shared address from `apps/benny-plus/app/shop-hosted`.
