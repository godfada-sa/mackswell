// Verifies the live Supabase project configured in js/config.js.
//
//   node tools/live-check.mjs            read-only: settings + table presence
//   node tools/live-check.mjs --write    also signs up a throwaway user, posts,
//                                        likes and cleans up after itself
//   node tools/live-check.mjs --write --email you@example.com --password '...'
//                                        uses an already-confirmed account, for
//                                        projects that require email confirmation
//
// Exit code 0 means the backend is usable by the site.
import { readFile } from 'node:fs/promises';

const configSource = await readFile(new URL('../js/config.js', import.meta.url), 'utf8');
const url = (configSource.match(/url:\s*'([^']+)'/) || [])[1];
const key = (configSource.match(/anonKey:\s*'([^']+)'/) || [])[1];

if (!url || !key || url.includes('YOUR_')) {
  console.error('js/config.js does not contain a project URL and key yet.');
  process.exit(1);
}

const TABLES = ['profiles', 'posts', 'post_likes', 'comments', 'follows', 'stories', 'events'];
const headers = { apikey: key, Authorization: 'Bearer ' + key };
const write = process.argv.includes('--write');
const argValue = (name) => {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : null;
};
const userEmail = argValue('--email');
const userPassword = argValue('--password');

let failures = 0;
const ok = (message) => console.log('  ok   ' + message);
const bad = (message) => {
  failures += 1;
  console.log('  FAIL ' + message);
};

console.log(`Project: ${url}`);

const settings = await fetch(url + '/auth/v1/settings', { headers });
if (!settings.ok) {
  console.error(`Auth endpoint rejected the key (HTTP ${settings.status}).`);
  process.exit(1);
}
const settingsBody = await settings.json();
ok('publishable key accepted');
settingsBody.external && settingsBody.external.email ? ok('email sign-in enabled') : bad('email sign-in disabled');

console.log('Tables:');
const missing = [];
for (const table of TABLES) {
  const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, { headers });
  if (res.status === 200) {
    ok(table);
  } else {
    missing.push(table);
    bad(`${table} (HTTP ${res.status})`);
  }
}

if (missing.length) {
  console.log('\nApply supabase/schema.sql in the Supabase SQL editor, then re-run this check.');
  process.exit(1);
}

if (write) {
  console.log('Write path:');
  let session = null;
  let userId;

  if (userEmail && userPassword) {
    // Projects with "Confirm email" enabled never return a session from signup,
    // so verification has to start from an account that is already confirmed.
    const login = await fetch(url + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: userEmail, password: userPassword })
    });
    const loginBody = await login.json();
    if (login.ok && loginBody.access_token) {
      ok('sign in as ' + userEmail);
      session = { access_token: loginBody.access_token, user: loginBody.user };
    } else {
      bad(`sign in: ${loginBody.msg || loginBody.error_description || loginBody.message || login.status}`);
    }
  } else {
    const email = `codex-check-${Date.now()}@example.com`;
    const password = 'Passw0rd@';
    const username = 'check' + Date.now().toString().slice(-6);

    const signup = await fetch(url + '/auth/v1/signup', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, data: { username, first_name: 'Live', last_name: 'Check' } })
    });
    const signupBody = await signup.json();
    const signedUp = signup.ok;
    if (!signedUp) {
      bad(`sign up: ${signupBody.msg || signupBody.message || signup.status}`);
    } else {
      ok('sign up');
    }
    session = signupBody.session || null;
    userId = signupBody.user && signupBody.user.id;

    if (!session) {
      console.log('  note  project requires email confirmation, so no session was returned');
      // profiles are readable with the publishable key, so the trigger can still
      // be verified even though no post can be written without a session.
      if (signedUp) {
        const row = await fetch(`${url}/rest/v1/profiles?select=id,username&username=eq.${username}`, { headers });
        const rows = row.ok ? await row.json() : [];
        rows.length === 1
          ? ok('profile row created by trigger')
          : bad(`profile row not created by trigger (HTTP ${row.status})`);
      }
      console.log('\nRe-run with a confirmed account to test the write path:');
      console.log("  node tools/live-check.mjs --write --email you@example.com --password 'your-password'");
      console.log('Or Dashboard -> Authentication -> Providers -> Email -> disable "Confirm email".');
      process.exit(1);
    }
  }

  if (!session) {
    process.exit(1);
  }

  const authHeaders = { ...headers, Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' };
  userId = session.user.id;

  const profileRes = await fetch(`${url}/rest/v1/profiles?select=id,username&id=eq.${userId}`, { headers: authHeaders });
  const profiles = await profileRes.json();
  profiles.length === 1 ? ok('profile row created by trigger') : bad('profile row not created by trigger');

  const postRes = await fetch(url + '/rest/v1/posts', {
    method: 'POST',
    headers: { ...authHeaders, Prefer: 'return=representation' },
    body: JSON.stringify({ author_id: userId, content: 'Live backend check' })
  });
  const posts = await postRes.json();
  postRes.ok ? ok('insert post') : bad('insert post: ' + JSON.stringify(posts).slice(0, 160));
  const postId = posts[0] && posts[0].id;

  if (postId) {
    const likeRes = await fetch(url + '/rest/v1/post_likes', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ post_id: postId, user_id: userId })
    });
    likeRes.ok ? ok('like post') : bad('like post: HTTP ' + likeRes.status);

    const cleanup = await fetch(`${url}/rest/v1/posts?id=eq.${postId}`, { method: 'DELETE', headers: authHeaders });
    cleanup.ok ? ok('delete own post (RLS)') : bad('delete own post: HTTP ' + cleanup.status);

    const foreign = await fetch(`${url}/rest/v1/posts`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ author_id: '11111111-1111-4111-8111-111111111111', content: 'should fail' })
    });
    foreign.ok ? bad('RLS allowed posting as another user') : ok('RLS blocks posting as another user');
  }

  const signOut = await fetch(url + '/auth/v1/logout', { method: 'POST', headers: authHeaders });
  signOut.ok || signOut.status === 204 ? ok('sign out') : bad('sign out: HTTP ' + signOut.status);
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
