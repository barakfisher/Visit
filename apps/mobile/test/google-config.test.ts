import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const configure = createRequire(import.meta.url)('../app.config.js');
test('native Google build config uses claimed HTTPS paths and retires ID-token SDK plugins', () => {
  const original = process.env.EXPO_PUBLIC_GOOGLE_NATIVE_RETURN_URL;
  try {
    delete process.env.EXPO_PUBLIC_GOOGLE_NATIVE_RETURN_URL;
    const base = { name: 'Visit', slug: 'visit', plugins: ['expo-router'], ios: {}, android: {} };
    const off = configure({ config: base });
    assert.equal(off.ios.associatedDomains, undefined);
    assert.equal(off.android.intentFilters, undefined);
    process.env.EXPO_PUBLIC_GOOGLE_NATIVE_RETURN_URL = 'https://visit.example.test/auth/google';
    const on = configure({ config: base });
    assert.deepEqual(on.ios.associatedDomains, ['applinks:visit.example.test']);
    assert.deepEqual(on.android.intentFilters[0].data, [{ scheme: 'https', host: 'visit.example.test', path: '/auth/google' }]);
    assert.equal(on.android.intentFilters[0].autoVerify, true);
    assert.equal(on.plugins.some((plugin: unknown) => String(plugin).includes('google-signin')), false);
    for (const value of ['visit://auth/google', 'http://visit.example.test/auth/google', 'https://visit.example.test/auth/email', 'https://visit.example.test/auth/google#grant=secret', 'https://user:secret@visit.example.test/auth/google']) {
      process.env.EXPO_PUBLIC_GOOGLE_NATIVE_RETURN_URL = value;
      assert.throws(() => configure({ config: base }));
    }
  } finally { if (original === undefined) delete process.env.EXPO_PUBLIC_GOOGLE_NATIVE_RETURN_URL; else process.env.EXPO_PUBLIC_GOOGLE_NATIVE_RETURN_URL = original; }
});
