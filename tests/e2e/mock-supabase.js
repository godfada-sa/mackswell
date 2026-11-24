// A small in-process stand-in for Supabase (GoTrue + PostgREST) used by the
// end-to-end suite. Requests are intercepted with page.route, so no network is
// involved and the real supabase-js client runs unchanged.
import { randomUUID } from 'node:crypto';

export const MOCK_URL = 'https://mock.supabase.co';
export const MOCK_KEY = 'sb_publishable_mock_key';

const ALEX_ID = '11111111-1111-4111-8111-111111111111';
const ALEX_POST_ID = '22222222-2222-4222-8222-222222222222';

function jsonResponse(route, status, payload) {
  return route.fulfill({
    status,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export async function installMockSupabase(page, options = {}) {
  const now = new Date().toISOString();

  const db = {
    profiles: [
      {
        id: ALEX_ID,
        username: 'alex',
        first_name: 'Alex',
        last_name: 'Johnson',
        email: 'alex@example.com',
        avatar_url: null,
        bio: null,
        birthday: null,
        gender: null,
        created_at: now
      }
    ],
    posts: [
      {
        id: ALEX_POST_ID,
        author_id: ALEX_ID,
        content: 'Hello from Alex',
        image_url: null,
        visibility: 'public',
        created_at: now
      }
    ],
    post_likes: [],
    comments: [],
    follows: [],
    stories: [],
    events: [
      {
        id: '33333333-3333-4333-8333-333333333333',
        creator_id: ALEX_ID,
        title: 'Digital Marketing Summit',
        location: 'Virtual Event',
        starts_at: new Date(Date.now() + 86400000).toISOString()
      }
    ]
  };

  const accounts = new Map(); // email -> { password, user }
  const refreshTokens = new Map(); // token -> user
  const taken = new Set(['alex']);
  const calls = [];

  function createAccount({ email, password, username, firstName = '', lastName = '', birthday = '', gender = '' }) {
    const user = { id: randomUUID(), email, created_at: new Date().toISOString(), user_metadata: {} };
    accounts.set(email, { password, user });
    taken.add(username.toLowerCase());
    db.profiles.push({
      id: user.id,
      username,
      first_name: firstName,
      last_name: lastName,
      email,
      avatar_url: null,
      bio: null,
      birthday: birthday || null,
      gender: gender || null,
      created_at: user.created_at
    });
    return user;
  }

  function publicUser(user) {
    return {
      id: user.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: user.email,
      email_confirmed_at: user.created_at,
      created_at: user.created_at,
      user_metadata: user.user_metadata || {},
      app_metadata: { provider: 'email', providers: ['email'] }
    };
  }

  function sessionFor(user) {
    const refresh = 'refresh-' + user.id;
    refreshTokens.set(refresh, user);
    return {
      access_token: 'access-' + user.id,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: refresh,
      user: publicUser(user)
    };
  }

  function decorate(table, row) {
    if (table === 'posts') {
      return {
        ...row,
        author: db.profiles.find((p) => p.id === row.author_id) || null,
        post_likes: db.post_likes.filter((l) => l.post_id === row.id).map((l) => ({ user_id: l.user_id })),
        comments: db.comments.filter((c) => c.post_id === row.id).map((c) => ({ id: c.id }))
      };
    }
    if (table === 'stories') {
      return { ...row, author: db.profiles.find((p) => p.id === row.author_id) || null };
    }
    return { ...row };
  }

  function filtered(table, url) {
    let rows = db[table].slice();

    url.searchParams.forEach((value, key) => {
      if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(key)) return;

      if (value.startsWith('eq.')) {
        rows = rows.filter((row) => String(row[key]) === value.slice(3));
      } else if (value.startsWith('neq.')) {
        rows = rows.filter((row) => String(row[key]) !== value.slice(4));
      } else if (value.startsWith('gte.')) {
        rows = rows.filter((row) => new Date(row[key]).getTime() >= new Date(value.slice(4)).getTime());
      } else if (value.startsWith('gt.')) {
        rows = rows.filter((row) => new Date(row[key]).getTime() > new Date(value.slice(3)).getTime());
      } else if (value.startsWith('lt.')) {
        rows = rows.filter((row) => new Date(row[key]).getTime() < new Date(value.slice(3)).getTime());
      } else if (value.startsWith('in.(')) {
        const list = value
          .slice(4, -1)
          .split(',')
          .map((entry) => entry.replace(/^"|"$/g, ''));
        rows = rows.filter((row) => list.includes(String(row[key])));
      }
    });

    const order = url.searchParams.get('order');
    if (order) {
      const [column, direction] = order.split('.');
      rows.sort((a, b) => {
        const left = a[column];
        const right = b[column];
        const cmp = typeof left === 'number' ? left - right : String(left).localeCompare(String(right));
        return direction === 'desc' ? -cmp : cmp;
      });
    }

    const limit = url.searchParams.get('limit');
    if (limit) rows = rows.slice(0, Number(limit));

    return rows;
  }

  await page.route('**/auth/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const body = request.postData() ? JSON.parse(request.postData()) : {};
    calls.push({ path, method: request.method() });

    if (path.endsWith('/signup')) {
      const username = (body.data && body.data.username) || '';
      if (taken.has(String(username).toLowerCase())) {
        return jsonResponse(route, 500, {
          code: 500,
          error_code: 'unexpected_failure',
          msg: 'Database error saving new user'
        });
      }

      const user = createAccount({
        email: body.email,
        password: body.password,
        username,
        firstName: (body.data && body.data.first_name) || '',
        lastName: (body.data && body.data.last_name) || '',
        birthday: (body.data && body.data.birthday) || '',
        gender: (body.data && body.data.gender) || ''
      });
      return jsonResponse(route, 200, sessionFor(user));
    }

    if (path.endsWith('/token')) {
      const grant = url.searchParams.get('grant_type');

      if (grant === 'password') {
        const account = accounts.get(body.email);
        if (!account || account.password !== body.password) {
          return jsonResponse(route, 400, {
            error: 'invalid_grant',
            error_description: 'Invalid login credentials'
          });
        }
        return jsonResponse(route, 200, sessionFor(account.user));
      }

      if (grant === 'refresh_token') {
        const user = refreshTokens.get(body.refresh_token);
        if (!user) {
          return jsonResponse(route, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' });
        }
        return jsonResponse(route, 200, sessionFor(user));
      }
    }

    if (path.endsWith('/recover')) return jsonResponse(route, 200, {});
    if (path.endsWith('/logout')) return route.fulfill({ status: 204, body: '' });

    if (path.endsWith('/user')) {
      const header = request.headers()['authorization'] || '';
      const id = header.replace('Bearer access-', '').trim();
      const found = [...accounts.values()].find((entry) => entry.user.id === id);
      if (!found) return jsonResponse(route, 401, { message: 'invalid claim' });
      return jsonResponse(route, 200, publicUser(found.user));
    }

    return jsonResponse(route, 404, { message: 'not mocked: ' + path });
  });

  await page.route('**/rest/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const segments = url.pathname.split('/').filter(Boolean); // rest, v1, ...
    const method = request.method();
    const body = request.postData() ? JSON.parse(request.postData()) : null;
    calls.push({ path: url.pathname, method, query: url.search });

    if (segments[2] === 'rpc') {
      const fn = segments[3];
      if (fn === 'username_available') {
        const name = String((body && body.p_username) || '').toLowerCase();
        return jsonResponse(route, 200, name.length > 0 && !taken.has(name));
      }
      return jsonResponse(route, 404, { message: 'unknown rpc ' + fn });
    }

    const table = segments[2];
    if (!db[table]) {
      return jsonResponse(route, 404, {
        code: 'PGRST205',
        message: "Could not find the table 'public." + table + "' in the schema cache"
      });
    }

    if (method === 'GET') {
      return jsonResponse(route, 200, filtered(table, url).map((row) => decorate(table, row)));
    }

    if (method === 'POST') {
      const items = Array.isArray(body) ? body : [body];
      const inserted = items.map((item) => {
        if (table === 'post_likes') {
          const existing = db.post_likes.find(
            (like) => like.post_id === item.post_id && like.user_id === item.user_id
          );
          if (existing) return existing;
        }
        const row = { id: item.id || randomUUID(), created_at: new Date().toISOString(), ...item };
        db[table].push(row);
        return row;
      });

      const wantsRepresentation = (request.headers()['prefer'] || '').includes('return=representation');
      const wantsSingle = (request.headers()['accept'] || '').includes('vnd.pgrst.object');

      if (!wantsRepresentation) return route.fulfill({ status: 201, body: '' });

      const payload = inserted.map((row) => decorate(table, row));
      return jsonResponse(route, 201, wantsSingle ? payload[0] : payload);
    }

    if (method === 'DELETE') {
      const doomed = filtered(table, url);
      db[table] = db[table].filter((row) => !doomed.includes(row));
      return route.fulfill({ status: 204, body: '' });
    }

    if (method === 'PATCH') {
      const targets = filtered(table, url);
      targets.forEach((row) => Object.assign(row, body));
      return jsonResponse(route, 200, targets.map((row) => decorate(table, row)));
    }

    return jsonResponse(route, 405, { message: 'method not mocked' });
  });

  if (options.account) {
    createAccount(options.account);
  }

  return { db, accounts, calls, taken, ALEX_ID, ALEX_POST_ID, seedAccount: createAccount };
}
