import {
  cors,
  db,
  fail,
  out,
  verifyTelegram,
  withTimeout
} from '../_shared.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: cors
    });
  }

  try {
    const body = await req.json();
    const initData = String(body.initData || '');

    const { user: tgUser, startParam } =
      await verifyTelegram(initData);

    const supabase = db();

    const telegramId = Number(tgUser.id);

    if (!telegramId) {
      throw new Error('Invalid Telegram user ID.');
    }

    const referralCode =
      `EBITO${telegramId}`;

    // Query existing user with timeout
    let existing;
    try {
      const result = await withTimeout(
        supabase
          .from('users')
          .select('*')
          .eq('telegram_id', telegramId)
          .maybeSingle(),
        5000
      );
      
      if (result.error) {
        throw result.error;
      }
      
      existing = result.data;
    } catch (err) {
      throw new Error(
        `Failed to look up user account: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }

    let user = existing;

    if (!user) {
      let referredBy: number | null = null;

      // Look up referrer if referral code provided
      if (
        startParam &&
        startParam.startsWith('ref_')
      ) {
        try {
          const code =
            startParam.substring(4);

          const referrerResult = await withTimeout(
            supabase
              .from('users')
              .select('telegram_id')
              .eq('referral_code', code)
              .maybeSingle(),
            3000
          );

          if (
            !referrerResult.error &&
            referrerResult.data &&
            Number(referrerResult.data.telegram_id) !== telegramId
          ) {
            referredBy =
              Number(referrerResult.data.telegram_id);
          }
        } catch (err) {
          // Log referral lookup failure but don't block signup
          console.warn(
            'Referral lookup failed:',
            err instanceof Error ? err.message : String(err)
          );
        }
      }

      // Create new user with timeout
      try {
        const createResult = await withTimeout(
          supabase
            .from('users')
            .insert({
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
            })
            .select('*')
            .single(),
          5000
        );

        if (createResult.error) {
          throw createResult.error;
        }

        user = createResult.data;
      } catch (err) {
        throw new Error(
          `Failed to create user account: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }

      // Insert referral record if applicable (non-blocking)
      if (referredBy) {
        try {
          await withTimeout(
            supabase
              .from('referrals')
              .insert({
                referrer_id: referredBy,
                referred_id: telegramId,
                reward: 0
              }),
            2000
          );
        } catch (err) {
          // Log but don't fail auth if referral insert fails
          console.warn(
            'Failed to record referral:',
            err instanceof Error ? err.message : String(err)
          );
        }
      }
    } else {
      // Update existing user with timeout
      try {
        const updateResult = await withTimeout(
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
          5000
        );

        if (!updateResult.error && updateResult.data) {
          user = updateResult.data;
        }
      } catch (err) {
        // Log but continue with existing user data if update fails
        console.warn(
          'Failed to update user profile:',
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    if (!user) {
      throw new Error('Failed to load or create user account.');
    }

    return out({
      ok: true,
      user: {
        ...user,
        telegram_id: String(
          user.telegram_id
        )
      }
    });
  } catch (error) {
    console.error('telegram-auth error:', error);

    return fail(
      error,
      400
    );
  }
});
