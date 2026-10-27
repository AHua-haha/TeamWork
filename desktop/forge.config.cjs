module.exports = {
  packagerConfig: {
    name: 'RSI Agent',
    appBundleId: 'com.rsiagent.desktop',
    asar: true,
    extraResource: ['.build/frontend-dist'],
    osxSign: false,
  },
  makers: [
    { name: '@electron-forge/maker-zip', platforms: ['darwin'] },
    { name: '@electron-forge/maker-dmg', platforms: ['darwin'] },
  ],
};
