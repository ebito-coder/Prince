import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/* =========================================================
   EBiTO COIN — SHARED SUPABASE EDGE FUNCTION HELPERS
   ========================================================= */

// CORS
export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':
    'POST, GET, OPTIONS'
};

// Admin Telegram ID
export const adminId = '6457637080';

/* =========================================================
    SUPABASE DATABASE CLIENT WITH QUERY TIMEOUT
    ========================================================= */

export const db = () => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');

  // Newer Supabase projects may expose the newer secret key.
  // Keep the old service-role key as a fallback.
  const serviceKey =
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
    Deno.env.get('SUPABASE_SECRET_KEY');

  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL is not configured.');
  }

  if (!serviceKey) {
    throw new Error(
      'Supabase server secret key is not configured.'
    );
  }

  return createClient(supabaseUrl, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    db: {
      schema: 'public'
    }
  });
};

/* =========================================================
    QUERY TIMEOUT WRAPPER
    Ensures Supabase queries don't hang indefinitely
    ========================================================= */

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = 5000
): Promise<T> {
  const timeoutPromise = new Promise<T>((_, reject) =>
    setTimeout(
      () =>
        reject(
          new Error(
            `Query timed out after ${timeoutMs}ms. Database may be unavailable.`
          )
        ),
      timeoutMs
    )
  );

  return Promise.race([promise, timeoutPromise]);
}

/* =========================================================
    HMAC SHA-256
    Used for Telegram Web App initData verification
    ========================================================= */

async function hmac(
  key: Uint8Array | string,
  data: string
): Promise<ArrayBuffer> {
  const keyBytes =
    typeof key === 'string'
      ? new TextEncoder().encode(key)
      : key;

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    {
      name: 'HMAC',
      hash: 'SHA-256'
    },
    false,
    ['sign']
  );

  return await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    new TextEncoder().encode(data)
  );
}

/* =========================================================
    ARRAY BUFFER → HEX
    ========================================================= */

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/* =========================================================
    VERIFY TELEGRAM MINI APP INIT DATA
    ========================================================= */

export async function verifyTelegram(initData: string) {
  if (!initData) {
    throw new Error(
      'Telegram initData is missing. Open EBiTO inside Telegram.'
    );
  }

  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');

  if (!botToken) {
    throw new Error(
      'Telegram server secret is not configured.'
    );
  }

  const params = new URLSearchParams(initData);

  const receivedHash = params.get('hash');

  if (!receivedHash) {
    throw new Error('Telegram hash is missing.');
  }

  // Remove hash before creating Telegram's data-check-string.
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  /*
    Telegram verification:

    secret_key = HMAC_SHA256(
      key = "WebAppData",
      data = bot_token
    )

    calculated_hash = HMAC_SHA256(
      key = secret_key,
      data = data_check_string
    )
  */

  const secretKey = await hmac(
    'WebAppData',
    botToken
  );

  const calculatedHash = hex(
    await hmac(
      new Uint8Array(secretKey),
      dataCheckString
    )
  );

  if (calculatedHash !== receivedHash) {
    throw new Error(
      'Invalid Telegram initData.'
    );
  }

  /* =======================================================
     CHECK TELEGRAM SESSION AGE
     ======================================================= */

  const authDate = Number(
    params.get('auth_date') || 0
  );

  if (!authDate) {
    throw new Error(
      'Telegram auth_date is missing.'
    );
  }

  const currentTime =
    Math.floor(Date.now() / 1000);

  const sessionAge =
    currentTime - authDate;

  // 24-hour validity
  if (sessionAge > 86400) {
    throw new Error(
      'Telegram session has expired. Reopen the Mini App.'
    );
  }

  /* =======================================================
     READ TELEGRAM USER
     ======================================================= */

  const userString = params.get('user');

  if (!userString) {
    throw new Error(
      'Telegram user data is missing.'
    );
  }

  let user: any;

  try {
    user = JSON.parse(userString);
  } catch {
    throw new Error(
      'Telegram user data is invalid.'
    );
  }

  if (!user?.id) {
    throw new Error(
      'Telegram user ID is missing.'
    );
  }

  /* =======================================================
     REFERRAL START PARAMETER
     ======================================================= */

  const startParam =
    params.get('start_param') || '';

  return {
    user,
    startParam
  };
}

/* =========================================================
    STANDARD SUCCESS RESPONSE
    ========================================================= */

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

/* =========================================================
    STANDARD ERROR RESPONSE
    ========================================================= */

export function fail(
  error: unknown,
  status = 400
) {
  let message = 'Unknown error';

  if (error instanceof Error) {
    message = error.message;
  } else if (
    typeof error === 'string'
  ) {
    message = error;
  } else {
    try {
      message = JSON.stringify(error);
    } catch {
      message = 'Unknown error';
    }
  }

  console.error(
    'EBiTO Edge Function Error:',
    message
  );

  return new Response(
    JSON.stringify({
      ok: false,
      error: message
    }),
    {
      status,
      headers: {
        ...cors,
        'Content-Type': 'application/json'
      }
    }
  );
}
