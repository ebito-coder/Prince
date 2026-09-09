import {
  db,
  cors,
  out,
  fail,
  verifyTelegram,
  adminId
} from '../_shared.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: cors
    });
  }

  try {
    const body = await req.json();

    const { user } =
      await verifyTelegram(body.initData);

    // Only the EBiTO admin can use this function
    if (String(user.id) !== adminId) {
      return fail(
        new Error('Admin access denied.'),
        403
      );
    }

    const supa = db();
    const action = body.action || 'stats';

    // Dashboard statistics
    if (action === 'stats') {
      const [
        usersResult,
        userRowsResult,
        recentResult,
        tasksResult,
        cardsResult
      ] = await Promise.all([
        supa
          .from('users')
          .select('*', {
            count: 'exact',
            head: true
          }),

        supa
          .from('users')
          .select(
            'coins,total_taps,airdrop_points'
          ),

        supa
          .from('users')
          .select(
            'telegram_id,first_name,username,coins,level,created_at'
          )
          .order('created_at', {
            ascending: false
          })
          .limit(20),

        supa
          .from('tasks')
          .select('*', {
            count: 'exact',
            head: true
          }),

        supa
          .from('upgrades')
          .select('*', {
            count: 'exact',
            head: true
          })
      ]);

      const rows =
        userRowsResult.data || [];

      const totalCoins =
        rows.reduce(
          (total, user) =>
            total + Number(user.coins || 0),
          0
        );

      const totalTaps =
        rows.reduce(
          (total, user) =>
            total +
            Number(user.total_taps || 0),
          0
        );

      const totalAirdrop =
        rows.reduce(
          (total, user) =>
            total +
            Number(user.airdrop_points || 0),
          0
        );

      return out({
        stats: {
          users: usersResult.count || 0,
          coins: totalCoins,
          taps: totalTaps,
          airdrop: totalAirdrop,
          tasks: tasksResult.count || 0,
          cards: cardsResult.count || 0
        },

        recent:
          recentResult.data || []
      });
    }

    // List users
    if (action === 'list_users') {
      const {
        data,
        error
      } = await supa
        .from('users')
        .select('*')
        .order('coins', {
          ascending: false
        })
        .limit(100);

      if (error) {
        throw error;
      }

      return out({
        users: data || []
      });
    }

    // Add or remove coins
    if (action === 'adjust_coins') {
      const target =
        Number(body.telegram_id);

      const amount =
        Math.trunc(
          Number(body.amount)
        );

      if (
        !target ||
        !Number.isFinite(amount) ||
        amount === 0
      ) {
        throw new Error(
          'Invalid coin adjustment.'
        );
      }

      const {
        data: targetUser,
        error: targetError
      } = await supa
        .from('users')
        .select('coins')
        .eq(
          'telegram_id',
          target
        )
        .single();

      if (
        targetError ||
        !targetUser
      ) {
        throw new Error(
          'Target user not found.'
        );
      }

      const nextCoins =
        Math.max(
          0,
          Number(targetUser.coins) +
            amount
        );

      const {
        data: updated,
        error: updateError
      } = await supa
        .from('users')
        .update({
          coins: nextCoins,
          updated_at:
            new Date().toISOString()
        })
        .eq(
          'telegram_id',
          target
        )
        .select('*')
        .single();

      if (updateError) {
        throw updateError;
      }

      await supa
        .from('admin_actions')
        .insert({
          admin_telegram_id:
            Number(adminId),
          action:
            'adjust_coins',
          target_telegram_id:
            target,
          metadata: {
            amount
          }
        });

      await supa
        .from('transactions')
        .insert({
          telegram_id: target,
          type:
            'admin_adjustment',
          amount,
          metadata: {
            admin: adminId
          }
        });

      return out({
        user: updated
      });
    }

    throw new Error(
      'Unknown admin action.'
    );

  } catch (e) {
    return fail(e);
  }
});
