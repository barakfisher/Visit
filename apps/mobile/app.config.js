module.exports = ({ config }) => {
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  return {
    ...config,
    plugins: [
      ...(config.plugins || []),
      ['expo-localization', { supportsRTL: true, supportedLocales: ['he', 'en'] }],
      ...(iosClientId ? [['@react-native-google-signin/google-signin', { iosUrlScheme: `com.googleusercontent.apps.${iosClientId.replace(/\.apps\.googleusercontent\.com$/, '')}` }]] : []),
    ],
  };
};
