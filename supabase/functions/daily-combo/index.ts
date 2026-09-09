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

    const { user: tgUser } =
      await verifyTelegram(
        String(body.initData || '')
      );

    const supabase = db();
    const telegramId = Number(tgUser.id);

    const today =
      new Date().toISOString().slice(0, 10);

    const action =
      String(body.action || 'get');

    // GET TODAY'S COMBO
    if (action === 'get') {
      let { data: combo } =
        await supabase
          .from('daily_combos')
          .select('*')
          .eq('combo_date', today)
          .maybeSingle();

      if (!combo) {
        const { data: cards } =
          await supabase
            .from('upgrades')
            .select('*')
            .order('id', {
              ascending: true
            });

        if (!cards || cards.length < 3) {
          throw new Error(
            'Not enough Mine cards to create the Daily Combo.'
          );
        }

        // Pick 3 cards for today's combo.
        const shuffled = [...cards].sort(
          () => Math.random() - 0.5
        );

        const selected =
          shuffled.slice(0, 3);

        const { data: created, error } =
          await supabase
            .from('daily_combos')
            .insert({
              combo_date: today,
              card1_id: selected[0].id,
              card2_id: selected[1].id,
              card3_id: selected[2].id,
              reward: 5000000
            })
            .select('*')
            .single();

        if (error) throw error;

        combo = created;
      }

      const ids = [
        combo.card1_id,
        combo.card2_id,
        combo.card3_id
      ];

      const { data: cards } =
        await supabase
          .from('upgrades')
          .select('*')
          .in('id', ids);

      return out({
        ok: true,
        combo,
        cards: cards || [],
        date: today
      });
    }

    // CLAIM DAILY COMBO
    if (action === 'claim') {
      const { data: combo } =
        await supabase
          .from('daily_combos')
          .select('*')
          .eq('combo_date', today)
          .maybeSingle();

      if (!combo) {
        throw new Error(
          'Today\'s Daily Combo does not exist.'
        );
      }

      const { data: user } =
        await supabase
          .from('users')
          .select('*')
          .eq('telegram_id', telegramId)
          .single();

      if (!user) {
        throw new Error(
          'User account not found.'
        );
      }

      if (user.last_daily_combo === today) {
        throw new Error(
          'Daily Combo reward already claimed today.'
        );
      }

      const requiredCards = [
        combo.card1_id,
        combo.card2_id,
        combo.card3_id
      ];

      const { data: owned } =
        await supabase
          .from('user_upgrades')
          .select('upgrade_id, level')
          .eq('telegram_id', telegramId)
          .in('upgrade_id', requiredCards);

      const ownedIds =
        new Set(
          (owned || []).map(
            x => Number(x.upgrade_id)
          )
        );

      const complete =
        requiredCards.every(
          id => ownedIds.has(Number(id))
        );

      if (!complete) {
        throw new Error(
          'You must own all 3 Daily Combo cards before claiming the reward.'
        );
      }

      const reward =
        Number(combo.reward || 5000000);

      const { data: updated, error } =
        await supabase
          .from('users')
          .update({
            coins:
              Number(user.coins || 0) + reward,
            airdrop_points:
              Number(user.airdrop_points || 0) + reward,
            last_daily_combo: today,
            daily_combo_claimed: true,
            updated_at:
              new Date().toISOString()
          })
          .eq('telegram_id', telegramId)
          .select('*')
          .single();

      if (error) throw error;

      await supabase
        .from('transactions')
        .insert({
          telegram_id: telegramId,
          type: 'daily_combo',
          amount: reward,
          metadata: {
            combo_date: today,
            cards: requiredCards
          }
        });

      return out({
        ok: true,
        claimed: true,
        reward,
        user: updated
      });
    }

    throw new Error(
      'Unknown Daily Combo action.'
    );

  } catch (error) {
    console.error(error);

    return fail(
      error,
      400
    );
  }
});
