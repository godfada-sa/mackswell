import { test, expect } from '@playwright/test';
import { installMockSupabase, MOCK_URL, MOCK_KEY } from './mock-supabase.js';

const ACCOUNT = {
  email: 'mack@example.com',
  password: 'Passw0rd@',
  username: 'mackswell',
  firstName: 'Mack',
  lastName: 'Swell'
};

let mock;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ([url, key]) => {
      window.SUPABASE_CONFIG = { url, anonKey: key };
    },
    [MOCK_URL, MOCK_KEY]
  );

  mock = await installMockSupabase(page);
});

test('sign-up wizard creates the account and its profile', async ({ page }) => {
  await page.goto('/signup-form.html');
  await page.fill('#firstName', 'Mack');
  await page.fill('#lastName', 'Swell');
  await page.fill('#email', 'mack@example.com');
  await page.click('.next-btn');
  await page.waitForURL('**/nextpage-signup.html');

  await page.selectOption('#month', '5');
  await page.fill('#day', '14');
  await page.fill('#year', '1995');
  await page.selectOption('#gender', 'male');
  await page.click('.next-btn');
  await page.waitForURL('**/nextpage-signu.html');

  await page.fill('#username', 'mackswell');
  await page.click('#nextButton');
  await page.waitForURL('**/nextpage-sign.html');

  await expect(page.locator('#usernameDisplay')).toHaveText('mackswell');

  await page.fill('#password', 'Passw0rd@');
  await page.fill('#confirmPassword', 'Passw0rd@');
  await page.click('#nextButton');
  await page.waitForURL('**/nextpage.html');

  const profile = mock.db.profiles.find((row) => row.username === 'mackswell');
  expect(profile).toBeTruthy();
  expect(profile.email).toBe('mack@example.com');
  expect(profile.birthday).toBe('1995-05-14');
  expect(profile.gender).toBe('male');
});

test('a taken username is rejected before the account is created', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      'sp_signup_draft',
      JSON.stringify({ email: 'mack@example.com', firstName: 'Mack', lastName: 'Swell' })
    );
  });

  await page.goto('/nextpage-signu.html');
  await page.fill('#username', 'alex');
  await page.click('#nextButton');

  await expect(page.locator('#username-error')).toBeVisible();
  await expect(page.locator('#username-error')).toContainText('already taken');
  expect(page.url()).toContain('nextpage-signu.html');
  expect(mock.calls.some((call) => call.path.includes('username_available'))).toBe(true);
});

test('wrong password shows an error and a correct one opens the feed', async ({ page }) => {
  mock.seedAccount(ACCOUNT);
  await page.goto('/Social.html');
  await page.fill('#email', ACCOUNT.email);
  await page.fill('#password', 'Wrongpass1!');
  await page.click('.login-button');

  await expect(page.locator('#password-error')).toBeVisible();
  await expect(page.locator('#password-error')).toContainText('Incorrect password');
  expect(page.url()).toContain('Social.html');

  await page.fill('#password', ACCOUNT.password);
  await page.click('.login-button');
  await page.waitForURL('**/hom.html');
});

test('the feed renders the signed-in profile and real posts', async ({ page }) => {
  mock.seedAccount(ACCOUNT);
  await page.goto('/Social.html');
  await page.fill('#email', ACCOUNT.email);
  await page.fill('#password', ACCOUNT.password);
  await page.click('.login-button');
  await page.waitForURL('**/hom.html');

  await expect(page.locator('#profile-handle')).toHaveText('@mackswell');
  await expect(page.locator('#profile-name')).toHaveText('Mack Swell');
  await expect(page.locator('#stat-posts')).toHaveText('0');

  const firstPost = page.locator('#feed-panel .post').first();
  await expect(firstPost.locator('h4')).toHaveText('Alex Johnson');
  await expect(firstPost.locator('.post-content')).toHaveText('Hello from Alex');

  const like = firstPost.locator('[data-like]');
  await expect(like.locator('span')).toHaveText('0');
  await like.click();
  await expect(like.locator('span')).toHaveText('1');
  expect(mock.db.post_likes).toHaveLength(1);

  await like.click();
  await expect(like.locator('span')).toHaveText('0');
  expect(mock.db.post_likes).toHaveLength(0);
});

test('posting from the composer adds the post to the feed', async ({ page }) => {
  mock.seedAccount(ACCOUNT);
  await page.goto('/Social.html');
  await page.fill('#email', ACCOUNT.email);
  await page.fill('#password', ACCOUNT.password);
  await page.click('.login-button');
  await page.waitForURL('**/hom.html');

  await page.fill('#composer-input', 'Backend is live');
  await page.click('#feed-panel button.btn');

  await expect(page.locator('#feed-panel .post-content').first()).toHaveText('Backend is live');
  expect(mock.db.posts).toHaveLength(2);
  expect(mock.db.posts[1].content).toBe('Backend is live');
  await expect(page.locator('#stat-posts')).toHaveText('1');
});

test('following a suggested person is stored', async ({ page }) => {
  mock.seedAccount(ACCOUNT);
  await page.goto('/Social.html');
  await page.fill('#email', ACCOUNT.email);
  await page.fill('#password', ACCOUNT.password);
  await page.click('.login-button');
  await page.waitForURL('**/hom.html');

  const suggestion = page.locator('.suggestion-item').first();
  await expect(suggestion.locator('h4')).toHaveText('Alex Johnson');
  await suggestion.locator('button').click();
  await expect(suggestion.locator('button')).toHaveText('Following');

  expect(mock.db.follows).toHaveLength(1);
  expect(mock.db.follows[0].following_id).toBe(mock.ALEX_ID);
});

test('forgot password asks Supabase to send a reset email', async ({ page }) => {
  mock.seedAccount(ACCOUNT);
  await page.goto('/forgottenpassword.html');

  const resetRequest = page.waitForRequest(
    (request) => request.url().includes('/auth/v1/recover') && request.method() === 'POST'
  );

  await page.fill('#email', ACCOUNT.email);
  await page.click('#reset-button');

  const request = await resetRequest;
  expect(request.postData()).toContain(ACCOUNT.email);
  await expect(page.locator('#success-message')).toBeVisible();
});

test('the feed is protected when signed out', async ({ page }) => {
  await page.goto('/hom.html');
  await page.waitForURL('**/Social.html');
  await expect(page.locator('h1')).toHaveText('Welcome Back');
});

test('signing out returns to the sign-in page', async ({ page }) => {
  mock.seedAccount(ACCOUNT);
  await page.goto('/Social.html');
  await page.fill('#email', ACCOUNT.email);
  await page.fill('#password', ACCOUNT.password);
  await page.click('.login-button');
  await page.waitForURL('**/hom.html');

  await page.click('[data-signout]');
  await page.waitForURL('**/Social.html');

  await page.goto('/hom.html');
  await page.waitForURL('**/Social.html');
});
