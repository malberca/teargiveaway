import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildAuthorizeUrl,
  cleanAuthorizationCode,
  describeTokenError,
  INSTAGRAM_LOGIN_SCOPES,
  parseLongLivedToken,
  parseShortLivedToken,
} from './instagramLogin.ts'

test('the authorize URL points to instagram.com with every required parameter', () => {
  const url = buildAuthorizeUrl({ clientId: '123', redirectUri: 'https://t.example/api/instagram/callback', state: 'abc' })
  assert.equal(url.origin + url.pathname, 'https://www.instagram.com/oauth/authorize')
  assert.equal(url.searchParams.get('client_id'), '123')
  assert.equal(url.searchParams.get('redirect_uri'), 'https://t.example/api/instagram/callback')
  assert.equal(url.searchParams.get('response_type'), 'code')
  assert.equal(url.searchParams.get('state'), 'abc')
  assert.equal(url.searchParams.get('scope'), 'instagram_business_basic,instagram_business_manage_comments')
  assert.equal(INSTAGRAM_LOGIN_SCOPES.includes('instagram_business_manage_comments'), true)
})

test('the authorize URL does not ask for Facebook or publishing permissions', () => {
  const scope = buildAuthorizeUrl({ clientId: '1', redirectUri: 'https://t.example/cb', state: 's' }).searchParams.get('scope')
  assert.doesNotMatch(scope, /pages_|business_management|content_publish|manage_messages/)
})

test('cleanAuthorizationCode removes the trailing #_ and whitespace', () => {
  assert.equal(cleanAuthorizationCode('AQBcode#_'), 'AQBcode')
  assert.equal(cleanAuthorizationCode(' AQBcode#'), 'AQBcode')
  assert.equal(cleanAuthorizationCode('AQBcode'), 'AQBcode')
})

test('parseShortLivedToken accepts the documented data-array response', () => {
  const token = parseShortLivedToken({ data: [{ access_token: 'IGQ123', user_id: 1784, permissions: 'instagram_business_basic' }] })
  assert.equal(token.accessToken, 'IGQ123')
  assert.equal(token.userId, '1784')
  assert.equal(token.expiresIn, 3600)
})

test('parseShortLivedToken accepts the flat response too', () => {
  const token = parseShortLivedToken({ access_token: 'IGQ456', user_id: '1784' })
  assert.equal(token.accessToken, 'IGQ456')
  assert.equal(token.userId, '1784')
})

test('parseShortLivedToken rejects a response without a token', () => {
  assert.throws(() => parseShortLivedToken({ data: [{ user_id: 1 }] }), /token de acceso/)
  assert.throws(() => parseShortLivedToken(null), /token de acceso/)
  assert.throws(() => parseShortLivedToken('texto'), /token de acceso/)
})

test('parseLongLivedToken returns the 60-day token and ignores malformed responses', () => {
  assert.deepEqual(parseLongLivedToken({ access_token: 'LONG', token_type: 'bearer', expires_in: 5183944 }), { accessToken: 'LONG', expiresIn: 5183944 })
  assert.equal(parseLongLivedToken({ access_token: 'LONG' }), null)
  assert.equal(parseLongLivedToken({ expires_in: 10 }), null)
  assert.equal(parseLongLivedToken(undefined), null)
})

test('describeTokenError reads the three shapes Instagram and Graph use', () => {
  assert.equal(describeTokenError({ error_type: 'OAuthException', code: 400, error_message: 'Invalid authorization code' }), 'Invalid authorization code')
  assert.equal(describeTokenError({ error: { message: 'Invalid OAuth access token' } }), 'Invalid OAuth access token')
  assert.equal(describeTokenError({ error_description: 'Redirect URI mismatch' }), 'Redirect URI mismatch')
  assert.match(describeTokenError({}), /rechazó el código/)
})
