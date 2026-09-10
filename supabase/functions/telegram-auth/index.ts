import {
  cors,
  db,
  fail,
  out,
  verifyTelegram,
  withTimeout
} from '../_shared.ts';

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    // Parse request body
    let body;
    try {
      body = await req.json();
    } catch (err) {
      return fail('Request body is not valid JSON', 400);
    }

    const initData = String(body.initData || '');

    // Step 1: Verify Telegram initData
    let tgUser, startParam;
    try {
      const verified = await verifyTelegram(initData);
      tgUser = verified.user;
      startParam = verified.startParam;
      console.log('[telegram-auth] Telegram verification successful');
    } catch (err) {
      return fail(
        err instanceof Error ? err.message : String(err),
        400
      );
    }

    // Step 2: Initialize Supabase client
    let supabase;
    try {
      supabase = db();
      console.log('[telegram-auth] Supabase client initialized');
    } catch (err) {
      return fail(
        `Failed to initialize database client: ${
          err instanceof Error ? err.message : String(err)
        }`,
        500
      );
    }

    const telegramId = Number(tgUser.id);
    if (!telegramId || telegramId <= 0) {
      return fail('Invalid Telegram user ID', 400);
    }

    const referralCode = `EBITO${telegramId}`;
    console.log(`[telegram-auth] Processing user ${telegramId}`);

    /* ===================================================
       STEP 3: LOOKUP EXISTING USER
       Timeout: 4s (query should be fast)
       ===================================================== */

    console.log(`[telegram-auth] Querying users table for telegram_id=${telegramId}`);
    let existing;
    try {
      const result = await withTimeout(
        `SELECT users WHERE telegram_id=${telegramId}`,
        supabase
          .from('users')
          .select('*')
          .eq('telegram_id', telegramId)
          .maybeSingle(),
        4000
      );

      if (result.error) {
        return fail(
          `Database SELECT failed: ${result.error.message} (Code: ${result.error.code})`,
          400
        );
      }
      existing = result.data;
      console.log(
        `[telegram-auth] User lookup complete: ${existing ? 'found' : 'not found'}`
      );
    } catch (err) {
      return fail(
        `User lookup timeout/error: ${
          err instanceof Error ? err.message : String(err)
        }`,
        503
      );
    }

    let user = existing;

    /* ===================================================
       STEP 4: CREATE NEW USER IF NOT EXISTS
       Timeout: 4s (INSERT should be fast)
       ===================================================== */

    if (!user) {
      console.log(`[telegram-auth] Creating new user ${telegramId}`);

      let referredBy: number | null = null;

      // Optional: lookup referrer (non-blocking, timeout 2s)
      if (startParam && startParam.startsWith('ref_')) {
        try {
          const referrerCode = startParam.substring(4);
          console.log(`[telegram-auth] Looking up referrer code: ${referrerCode}`);

          const referrerResult = await withTimeout(
            `SELECT users WHERE referral_code='${referrerCode}'`,
            supabase
              .from('users')
              .select('telegram_id')
              .eq('referral_code', referrerCode)
              .maybeSingle(),
            2000
          );

          if (
            !referrerResult.error &&
            referrerResult.data &&
            Number(referrerResult.data.telegram_id) !== telegramId
          ) {
            referredBy = Number(referrerResult.data.telegram_id);
            console.log(`[telegram-auth] Referrer found: ${referredBy}`);
          }
        } catch (err) {
          console.warn(
            `[telegram-auth] Referrer lookup failed (non-blocking): ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      }

      // INSERT new user
      console.log(`[telegram-auth] Inserting new user ${telegramId}`);
      try {
        const insertData = {
          telegram_id: telegramId,
          username: tgUser.username || null,
          first_name: tgUser.first_name || null,
          last_name: tgUser.last_name || null,
          photo_url: tgUser.photo_url || null,
          coins: 0,
          energy: 1000,
          max_energy: 1000,
          level: 1,
          referral_code: referralCode,
          referred_by: referredBy,
          total_taps: 0,
          airdrop_points: 0,
          tap_power: 1,
          profit_hour: 0
        };
        console.log('[telegram-auth] Insert payload:', JSON.stringify(insertData));

        const createResult = await withTimeout(
          `INSERT users telegram_id=${telegramId}`,
          supabase
            .from('users')
            .insert(insertData)
            .select('*')
            .single(),
          4000
        );

        if (createResult.error) {
          return fail(
            `Database INSERT failed: ${createResult.error.message} (Code: ${createResult.error.code})`,
            400
          );
        }

        user = createResult.data;
        console.log(`[telegram-auth] User created: ${telegramId}`);
      } catch (err) {
        return fail(
          `User creation failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
          503
        );
      }

      // Optional: Record referral (non-blocking, timeout 2s)
      if (referredBy) {
        try {
          console.log(
            `[telegram-auth] Recording referral ${referredBy} -> ${telegramId}`
          );
          await withTimeout(
            `INSERT referrals`,
            supabase
              .from('referrals')
              .insert({
                referrer_id: referredBy,
                referred_id: telegramId,
                reward: 0
              }),
            2000
          );
          console.log('[telegram-auth] Referral recorded');
        } catch (err) {
          console.warn(
            `[telegram-auth] Referral recording failed (non-blocking): ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      }
    } else {
      // UPDATE existing user
      console.log(`[telegram-auth] Updating existing user ${telegramId}`);
      try {
        const updateResult = await withTimeout(
          `UPDATE users telegram_id=${telegramId}`,
          supabase
            .from('users')
            .update({
              username: tgUser.username || null,
              first_name: tgUser.first_name || null,
              last_name: tgUser.last_name || null,
              photo_url: tgUser.photo_url || null,
              updated_at: new Date().toISOString()
            })
            .eq('telegram_id', telegramId)
            .select('*')
            .single(),
          4000
        );

        if (updateResult.error) {
          console.warn(
            `[telegram-auth] Update failed (continuing with existing data): ${
              updateResult.error.message
            }`
          );
          // Don't return error - use existing user data
        } else if (updateResult.data) {
          user = updateResult.data;
          console.log(`[telegram-auth] User updated: ${telegramId}`);
        }
      } catch (err) {
        console.warn(
          `[telegram-auth] Update error (continuing with existing data): ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    // Final validation
    if (!user || !user.telegram_id) {
      return fail('Failed to load user record', 500);
    }

    console.log(`[telegram-auth] SUCCESS: User ${telegramId} authenticated`);

    // ALWAYS return JSON success
    return out({
      ok: true,
      user: {
        ...user,
        telegram_id: String(user.telegram_id)
      }
    });
  } catch (error) {
    // Final catch-all - should never happen but guarantees JSON response
    console.error('[telegram-auth] UNHANDLED ERROR:', error);
    return fail(
      error instanceof Error ? error.message : String(error),
      500
    );
  }
});
