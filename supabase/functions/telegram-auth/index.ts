import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  cors,
  db,
  fail,
  out,
  verifyTelegram
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

    const { data: existing, error: findError } =
      await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', telegramId)
        .maybeSingle();

    if (findError) {
      throw findError;
    }

    let user = existing;

    if (!user) {
      let referredBy: number | null = null;

      if (
        startParam &&
        startParam.startsWith('ref_')
      ) {
        const code =
          startParam.substring(4);

        const { data: referrer } =
          await supabase
            .from('users')
            .select('telegram_id')
            .eq('referral_code', code)
            .maybeSingle();

        if (
          referrer &&
          Number(referrer.telegram_id) !== telegramId
        ) {
          referredBy =
            Number(referrer.telegram_id);
        }
      }

      const { data: created, error: createError } =
        await supabase
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
          .single();

      if (createError) {
        throw createError;
      }

      user = created;

      if (referredBy) {
        await supabase
          .from('referrals')
          .insert({
            referrer_id: referredBy,
            referred_id: telegramId,
            reward: 0
          });
      }
    } else {
      const { data: updated, error: updateError } =
        await supabase
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
          .single();

      if (!updateError && updated) {
        user = updated;
      }
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
    console.error(error);

    return fail(
      error,
      400
    );
  }
});
