import {
  cors,
  db,
  fail,
  out,
  verifyTelegram
} from '../_shared.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    const body = await req.json();

    const { user: tgUser } =
      await verifyTelegram(String(body.initData || ''));

    const supabase = db();
    const telegramId = Number(tgUser.id);
    const action = String(body.action || '');

    const { data: user, error: userError } =
      await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', telegramId)
        .single();

    if (userError || !user) {
      throw new Error('User account not found.');
    }

    // TAP
    if (action === 'tap') {
      const amount = Math.max(
        1,
        Math.min(20, Number(body.amount || 1))
      );

      const now = Date.now();
      const lastTap =
        user.last_tap_at
          ? new Date(user.last_tap_at).getTime()
          : 0;

      // Prevent impossible ultra-fast requests.
      if (lastTap && now - lastTap < 50) {
        throw new Error('Tap rate is too fast.');
      }

      const availableEnergy = Number(user.energy || 0);

      if (availableEnergy < amount) {
        throw new Error('Not enough energy.');
      }

      const tapPower =
        Math.max(1, Number(user.tap_power || 1));

      const reward = amount * tapPower;
      const newCoins =
        Number(user.coins || 0) + reward;
      const newEnergy =
        availableEnergy - amount;
      const totalTaps =
        Number(user.total_taps || 0) + amount;

      const { data: updated, error } =
        await supabase
          .from('users')
          .update({
            coins: newCoins,
            energy: newEnergy,
            total_taps: totalTaps,
            airdrop_points:
              Number(user.airdrop_points || 0) + amount,
            last_tap_at:
              new Date(now).toISOString(),
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
          type: 'tap',
          amount: reward,
          metadata: {
            taps: amount,
            tap_power: tapPower
          }
        });

      return out({
        ok: true,
        action: 'tap',
        reward,
        user: updated
      });
    }

    // UPGRADE
    if (action === 'upgrade') {
      const upgradeId =
        Number(body.upgradeId || 0);

      if (!upgradeId) {
        throw new Error('Upgrade ID is required.');
      }

      const { data: upgrade, error: upgradeError } =
        await supabase
          .from('upgrades')
          .select('*')
          .eq('id', upgradeId)
          .single();

      if (upgradeError || !upgrade) {
        throw new Error('Upgrade not found.');
      }

      const cost =
        Number(upgrade.cost || 0);

      if (Number(user.coins || 0) < cost) {
        throw new Error('Not enough coins.');
      }

      const { data: owned } =
        await supabase
          .from('user_upgrades')
          .select('*')
          .eq('telegram_id', telegramId)
          .eq('upgrade_id', upgradeId)
          .maybeSingle();

      const currentLevel =
        Number(owned?.level || 0);

      const nextLevel =
        currentLevel + 1;

      if (
        Number(upgrade.level || 1) <
        nextLevel
      ) {
        throw new Error('This upgrade has reached its maximum level.');
      }

      const newCoins =
        Number(user.coins || 0) - cost;

      if (owned) {
        const { error } =
          await supabase
            .from('user_upgrades')
            .update({
              level: nextLevel
            })
            .eq('id', owned.id);

        if (error) throw error;
      } else {
        const { error } =
          await supabase
            .from('user_upgrades')
            .insert({
              telegram_id: telegramId,
              upgrade_id: upgradeId,
              level: nextLevel
            });

        if (error) throw error;
      }

      const newTapPower =
        Math.max(
          1,
          Number(user.tap_power || 1) +
          Number(upgrade.tap_bonus || 0)
        );

      const newMaxEnergy =
        Math.max(
          1000,
          Number(user.max_energy || 1000) +
          Number(upgrade.energy_bonus || 0)
        );

      const { data: updated, error } =
        await supabase
          .from('users')
          .update({
            coins: newCoins,
            tap_power: newTapPower,
            max_energy: newMaxEnergy,
            energy: Math.min(
              Number(user.energy || 0),
              newMaxEnergy
            ),
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
          type: 'upgrade',
          amount: -cost,
          metadata: {
            upgrade_id: upgradeId,
            level: nextLevel
          }
        });

      return out({
        ok: true,
        action: 'upgrade',
        user: updated
      });
    }

    // TASK CLAIM
    if (action === 'task') {
      const taskId =
        Number(body.taskId || 0);

      if (!taskId) {
        throw new Error('Task ID is required.');
      }

      const { data: task } =
        await supabase
          .from('tasks')
          .select('*')
          .eq('id', taskId)
          .eq('active', true)
          .single();

      if (!task) {
        throw new Error('Task not found or inactive.');
      }

      const { data: existing } =
        await supabase
          .from('user_tasks')
          .select('*')
          .eq('telegram_id', telegramId)
          .eq('task_id', taskId)
          .maybeSingle();

      if (existing?.completed) {
        throw new Error('Task already claimed.');
      }

      const reward =
        Number(task.reward || 0);

      if (existing) {
        const { error } =
          await supabase
            .from('user_tasks')
            .update({
              completed: true,
              completed_at:
                new Date().toISOString()
            })
            .eq('id', existing.id);

        if (error) throw error;
      } else {
        const { error } =
          await supabase
            .from('user_tasks')
            .insert({
              telegram_id: telegramId,
              task_id: taskId,
              completed: true,
              completed_at:
                new Date().toISOString()
            });

        if (error) throw error;
      }

      const { data: updated, error } =
        await supabase
          .from('users')
          .update({
            coins:
              Number(user.coins || 0) + reward,
            airdrop_points:
              Number(user.airdrop_points || 0) + reward,
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
          type: 'task_reward',
          amount: reward,
          metadata: {
            task_id: taskId
          }
        });

      return out({
        ok: true,
        action: 'task',
        reward,
        user: updated
      });
    }

    // SPEED TAP GAME
    if (action === 'game') {
      const score =
        Math.max(
          0,
          Math.min(
            1000,
            Number(body.score || 0)
          )
        );

      const reward =
        Math.floor(score * 10);

      const { error: scoreError } =
        await supabase
          .from('game_scores')
          .insert({
            telegram_id: telegramId,
            game: 'speed-tap',
            score,
            reward
          });

      if (scoreError) throw scoreError;

      const { data: updated, error } =
        await supabase
          .from('users')
          .update({
            coins:
              Number(user.coins || 0) + reward,
            airdrop_points:
              Number(user.airdrop_points || 0) + reward,
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
          type: 'game_reward',
          amount: reward,
          metadata: {
            game: 'speed-tap',
            score
          }
        });

      return out({
        ok: true,
        action: 'game',
        score,
        reward,
        user: updated
      });
    }

    throw new Error('Unknown action.');
  } catch (error) {
    console.error(error);
    return fail(error, 400);
  }
});
