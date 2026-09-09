# EBiTO Coin — Corrected Supabase Build

This package contains the EBiTO Coin frontend plus corrected Supabase Edge Functions.

## Files
- `index.html` — Telegram Mini App frontend
- `migration.sql` — database additions, RLS read policies, starter Mine cards and tasks
- `supabase/functions/_shared.ts` — shared Telegram verification/server helpers
- `supabase/functions/telegram-auth/index.ts` — verifies Telegram initData and creates/updates users
- `supabase/functions/game-action/index.ts` — server-side taps, upgrades, tasks and game rewards
- `supabase/functions/daily-combo/index.ts` — daily 3-card Mine combo and reward claim
- `supabase/functions/admin/index.ts` — server-protected admin functions for Telegram ID 6457637080

## Supabase secrets
In Supabase Edge Function secrets, configure:
- `TELEGRAM_BOT_TOKEN` — your BotFather token
- `SUPABASE_SERVICE_ROLE_KEY` — your Supabase service-role key (server secret only)

Do NOT put either secret in `index.html` or GitHub.

## Deploy functions
From a Supabase CLI environment:

```bash
supabase functions deploy telegram-auth
supabase functions deploy game-action
supabase functions deploy daily-combo
supabase functions deploy admin
```

The shared `_shared.ts` file is imported by these functions and should remain in `supabase/functions/`.

## Important security note
The current frontend reads cards/tasks/leaderboard directly from Supabase, but browser writes to economy tables are intentionally not allowed. Coin-changing operations go through the Edge Functions.

For a fully hardened launch, add database-level atomic RPCs/rate limits and verification for external social tasks before distributing valuable rewards.
