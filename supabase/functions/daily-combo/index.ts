import {
  db,
  cors,
  out,
  fail,
  verifyTelegram
} from '../_shared.ts';

function dateKey() {
  return new Date().toISOString().slice(0, 10);
}

function seeded(date: string, n: number) {
  let h = 2166136261;

  for (const c of date) {
    h = Math.imul(
      h ^ c.charCodeAt(0),
      16777619
    );
  }

  h = Math.abs(h);

  return (
    h +
    n * 1013904223
  ) >>> 0;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: cors
    });
  }

  try {
    const body = await req.json();

    const {
      initData,
      action
    } = body;

    const {
      user: tgUser
    } = await verifyTelegram(initData);

    const supa = db();

    const today = dateKey();

    // Get all Mine cards
    const {
      data: cards,
      error: cardsErr
    } = await supa
      .from('upgrades')
      .select('*')
      .order('id');

    if (cardsErr) {
      throw cardsErr;
    }

    if (!cards || cards.length < 3) {
      throw new Error(
        'Add at least 3 Mine cards before using Daily Combo.'
      );
    }

    // Find today's combo
    let {
      data: combo
    } = await supa
      .from('daily_combos')
      .select('*')
      .eq('combo_date', today)
      .maybeSingle();

    // Create today's combo if it does not exist
    if (!combo) {
      const indexes = new Set<number>();

      let i = 0;

      while (indexes.size < 3) {
        indexes.add(
          seeded(today, i++) % cards.length
        );
      }

      const ids = [...indexes].map(
        index => cards[index].id
      );

      const {
        data: created,
        error: createErr
      } = await supa
        .from('daily_combos')
        .insert({
          combo_date: today,
          card_1: ids[0],
          card_2: ids[1],
          card_3: ids[2],
          reward: 5000000
        })
        .select('*')
        .single();

      if (createErr) {
        throw createErr;
      }

      combo = created;
    }

    // The database uses card_1, card_2 and card_3
    const ids = [
      combo.card_1,
      combo.card_2,
      combo.card_3
    ];

    // Get the actual card information
    const chosen = cards.filter(card =>
      ids.includes(card.id)
    );

    // Get the user's owned upgrades
    const {
      data: owned,
      error: ownedErr
    } = await supa
      .from('user_upgrades')
      .select('upgrade_id,level')
      .eq('telegram_id', tgUser.id)
      .in('upgrade_id', ids);

    if (ownedErr) {
      throw ownedErr;
    }

    const ownedMap = new Map(
      (owned || []).map(item => [
        Number(item.upgrade_id),
        Number(item.level)
      ])
    );

    // User must own all 3 cards
    const complete = ids.every(
      id =>
        (ownedMap.get(Number(id)) || 0) > 0
    );

    // Get user
    const {
      data: user,
      error: userErr
    } = await supa
      .from('users')
      .select('*')
      .eq('telegram_id', tgUser.id)
      .single();

    if (userErr || !user) {
      throw new Error(
        'EBiTO account not found.'
      );
    }

    // Check whether today's reward has already been claimed
    const claimed =
      user.last_daily_combo === today &&
      user.daily_combo_claimed === true;

    // Claim reward
    if (action === 'claim') {

      if (claimed) {
        throw new Error(
          'Daily Combo reward already claimed today.'
        );
      }

      if (!complete) {
        throw new Error(
          'Upgrade all 3 Daily Combo cards first.'
        );
      }

      const reward =
        Number(combo.reward || 5000000);

      const {
        data: updated,
        error: updateErr
      } = await supa
        .from('users')
        .update({
          coins:
            Number(user.coins) + reward,

          airdrop_points:
            Number(user.airdrop_points || 0) +
            reward,

          last_daily_combo: today,

          daily_combo_claimed: true,

          updated_at:
            new Date().toISOString()
        })
        .eq('telegram_id', tgUser.id)
        .select('*')
        .single();

      if (updateErr) {
        throw updateErr;
      }

      // Record transaction
      const {
        error: transactionErr
      } = await supa
        .from('transactions')
        .insert({
          telegram_id: tgUser.id,
          type: 'daily_combo',
          amount: reward,
          reference_id: today,
          metadata: {
            cards: ids
          }
        });

      if (transactionErr) {
        throw transactionErr;
      }

      return out({
        user: updated,

        reward,

        combo: {
          ...combo,
          cards: chosen,
          complete: true,
          claimed: true
        }
      });
    }

    // Normal Daily Combo request
    return out({
      combo: {
        ...combo,
        cards: chosen,
        complete,
        claimed
      }
    });

  } catch (e) {
    return fail(e);
  }
});
