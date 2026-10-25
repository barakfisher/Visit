module.exports = ({ config }) => {
  const nativeReturn = process.env.EXPO_PUBLIC_GOOGLE_NATIVE_RETURN_URL;
  let host;
  if (nativeReturn) {
    const url = new URL(nativeReturn);
    if (url.protocol !== 'https:' || url.pathname !== '/auth/google' || url.search || url.hash || url.username || url.password || url.port) throw new Error('EXPO_PUBLIC_GOOGLE_NATIVE_RETURN_URL must be an HTTPS /auth/google URL without query or fragment.');
    host = url.hostname;
  }
  return {
    ...config,
    ios: { ...config.ios, ...(host ? { associatedDomains: [...(config.ios?.associatedDomains || []), `applinks:${host}`] } : {}) },
    android: { ...config.android, ...(host ? { intentFilters: [...(config.android?.intentFilters || []), { action: 'VIEW', autoVerify: true, category: ['BROWSABLE', 'DEFAULT'], data: [{ scheme: 'https', host, path: '/auth/google' }] }] } : {}) },
    plugins: [
      ...(config.plugins || []),
      ['expo-localization', { supportsRTL: true, supportedLocales: ['he', 'en'] }],
    ],
  };
};
