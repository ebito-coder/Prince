import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

export const adminId = '6457637080';

export const db = () => createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

async function hmac(key: Uint8Array | string, data: string) {
  const raw = typeof key === 'string'
    ? new TextEncoder().encode(key)
    : key;

  const k = await crypto.subtle.importKey(
    'raw',
    raw,
    {
      name: 'HMAC',
      hash: 'SHA-256'
    },
    false,
    ['sign']
  );

  return new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      k,
      new TextEncoder().encode(data)
    )
  );
}

const hex = (a: Uint8Array) =>
  [...a]
    .map(x => x.toString(16).padStart(2, '0'))
    .join('');

export async function verifyTelegram(initData: string) {
  if (!initData) {
    throw new Error(
      'Telegram initData is missing. Open EBiTO inside Telegram.'
    );
  }

  const token = Deno.env.get('TELEGRAM_BOT_TOKEN');

  if (!token) {
    throw new Error(
      'Telegram server secret is not configured.'
    );
  }

  const p = new URLSearchParams(initData);

  const hash = p.get('hash');

  if (!hash) {
    throw new Error(
      'Telegram hash is missing.'
    );
  }

  p.delete('hash');

  const dataCheck = [...p.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secret = await hmac(
    'WebAppData',
    token
  );

  const calculated = hex(
    await hmac(
      secret,
      dataCheck
    )
  );

  if (calculated !== hash) {
    throw new Error(
      'Invalid Telegram initData.'
    );
  }

  const authDate = Number(
    p.get('auth_date') || 0
  );

  if (
    !authDate ||
    Math.floor(Date.now() / 1000) - authDate > 86400
  ) {
    throw new Error(
      'Telegram session has expired. Reopen the Mini App.'
    );
  }

  const user = JSON.parse(
    p.get('user') || '{}'
  );

  if (!user.id) {
    throw new Error(
      'Telegram user data is missing.'
    );
  }

  return {
    user,
    startParam: p.get('start_param') || ''
  };
}

export function out(
  body: unknown,
  status = 200
) {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        ...cors,
        'Content-Type': 'application/json'
      }
    }
  );
}

export function fail(
  e: unknown,
  status = 400
) {
  return out(
    {
      error:
        e instanceof Error
          ? e.message
          : String(e)
    },
    status
  );
  }
