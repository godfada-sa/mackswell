/* SocialPortal data + auth layer.
 *
 * Loaded as a classic script after vendor/supabase.js and js/config.js, and
 * exposes a single global: window.SP.
 */
(function () {
  'use strict';

  var config = window.SUPABASE_CONFIG || {};
  var configured =
    Boolean(config.url) &&
    Boolean(config.anonKey) &&
    !/YOUR_/.test(config.url) &&
    !/YOUR_/.test(config.anonKey);

  var client = null;
  if (configured && window.supabase) {
    client = window.supabase.createClient(config.url, config.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
  }

  var DRAFT_KEY = 'sp_signup_draft';

  var draft = {
    get: function () {
      try {
        return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || '{}') || {};
      } catch (err) {
        return {};
      }
    },
    merge: function (patch) {
      var next = Object.assign(draft.get(), patch);
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(next));
      return next;
    },
    clear: function () {
      sessionStorage.removeItem(DRAFT_KEY);
    }
  };

  function requireClient() {
    if (!client) {
      throw new Error(
        'Supabase is not configured. Add your project URL and anon key to js/config.js.'
      );
    }
    return client;
  }

  function fail(error) {
    if (error) throw error;
  }

  /* ---------------------------------------------------------------- auth -- */

  async function getSession() {
    if (!client) return null;
    var res = await client.auth.getSession();
    return res.data ? res.data.session : null;
  }

  async function getUser() {
    var session = await getSession();
    return session ? session.user : null;
  }

  /** Redirects to the sign-in page when there is no session. Returns the user. */
  async function requireUser() {
    var user = await getUser();
    if (!user) {
      window.location.replace('Social.html');
      return null;
    }
    return user;
  }

  async function signUp(email, password) {
    var d = draft.get();
    var res = await requireClient().auth.signUp({
      email: email,
      password: password,
      options: {
        data: {
          username: d.username || '',
          first_name: d.firstName || '',
          last_name: d.lastName || '',
          gender: d.gender || '',
          birthday: d.birthday || ''
        },
        emailRedirectTo: window.location.origin + '/Social.html'
      }
    });
    return res;
  }

  async function signIn(email, password) {
    if (!client) {
      return {
        data: null,
        error: new Error('Supabase is not configured. Add your project URL and anon key to js/config.js.')
      };
    }
    return client.auth.signInWithPassword({ email: email, password: password });
  }

  async function signOut() {
    if (client) await client.auth.signOut();
    draft.clear();
  }

  async function sendPasswordReset(email) {
    return requireClient().auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/Social.html?type=recovery'
    });
  }

  async function updatePassword(password) {
    return requireClient().auth.updateUser({ password: password });
  }

  async function usernameAvailable(username) {
    var res = await requireClient().rpc('username_available', { p_username: username });
    fail(res.error);
    return res.data === true;
  }

  /* ---------------------------------------------------------------- data -- */

  async function profile(id) {
    var res = await requireClient()
      .from('profiles')
      .select('id,username,first_name,last_name,avatar_url,bio,created_at')
      .eq('id', id)
      .maybeSingle();
    fail(res.error);
    return res.data;
  }

  async function profileStats(id) {
    var c = requireClient();
    var results = await Promise.all([
      c.from('follows').select('following_id').eq('follower_id', id),
      c.from('follows').select('follower_id').eq('following_id', id),
      c.from('posts').select('id').eq('author_id', id)
    ]);
    results.forEach(function (r) {
      fail(r.error);
    });
    return {
      following: (results[0].data || []).length,
      followers: (results[1].data || []).length,
      posts: (results[2].data || []).length
    };
  }

  async function feed() {
    var res = await requireClient()
      .from('posts')
      .select(
        'id,content,image_url,visibility,created_at,' +
          'author:profiles(id,username,first_name,last_name,avatar_url),' +
          'post_likes(user_id),comments(id)'
      )
      .order('created_at', { ascending: false })
      .limit(50);
    fail(res.error);
    return res.data || [];
  }

  async function createPost(content) {
    var user = await getUser();
    if (!user) throw new Error('You need to sign in first.');
    var res = await requireClient()
      .from('posts')
      .insert({ author_id: user.id, content: content.trim() })
      .select('id,content,created_at,author_id')
      .single();
    fail(res.error);
    return res.data;
  }

  async function toggleLike(postId, liked) {
    var user = await getUser();
    if (!user) throw new Error('You need to sign in first.');
    var c = requireClient();
    if (liked) {
      var del = await c.from('post_likes').delete().eq('post_id', postId).eq('user_id', user.id);
      fail(del.error);
      return false;
    }
    var ins = await c.from('post_likes').insert({ post_id: postId, user_id: user.id });
    fail(ins.error);
    return true;
  }

  async function follow(targetId) {
    var user = await getUser();
    if (!user) throw new Error('You need to sign in first.');
    var res = await requireClient()
      .from('follows')
      .insert({ follower_id: user.id, following_id: targetId });
    fail(res.error);
  }

  async function unfollow(targetId) {
    var user = await getUser();
    if (!user) throw new Error('You need to sign in first.');
    var res = await requireClient()
      .from('follows')
      .delete()
      .eq('follower_id', user.id)
      .eq('following_id', targetId);
    fail(res.error);
  }

  async function suggestions(limit) {
    var user = await getUser();
    var query = requireClient()
      .from('profiles')
      .select('id,username,first_name,last_name,avatar_url')
      .limit(limit || 3);
    if (user) query = query.neq('id', user.id);
    var res = await query;
    fail(res.error);
    return res.data || [];
  }

  async function stories() {
    var res = await requireClient()
      .from('stories')
      .select('id,caption,image_url,created_at,author:profiles(id,username)')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(12);
    fail(res.error);
    return res.data || [];
  }

  async function events(limit) {
    var res = await requireClient()
      .from('events')
      .select('id,title,location,starts_at')
      .order('starts_at', { ascending: true })
      .limit(limit || 4);
    fail(res.error);
    return res.data || [];
  }

  window.SP = {
    configured: configured,
    client: client,
    draft: draft,
    getSession: getSession,
    getUser: getUser,
    requireUser: requireUser,
    signUp: signUp,
    signIn: signIn,
    signOut: signOut,
    sendPasswordReset: sendPasswordReset,
    updatePassword: updatePassword,
    usernameAvailable: usernameAvailable,
    profile: profile,
    profileStats: profileStats,
    feed: feed,
    createPost: createPost,
    toggleLike: toggleLike,
    follow: follow,
    unfollow: unfollow,
    suggestions: suggestions,
    stories: stories,
    events: events
  };
})();
