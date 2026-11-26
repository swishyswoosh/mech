const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
module.exports = mergeConfig(getDefaultConfig(__dirname), {
 watchFolders: [path.resolve(__dirname, '../app'), path.resolve(__dirname, '../core')],
 resolver: {
  resolveRequest(context, moduleName, platform) {
   if (moduleName === 'react' || moduleName.startsWith('react/') || moduleName === 'react-native' || moduleName.startsWith('react-native/')) {
    return context.resolveRequest({...context, originModulePath: path.join(__dirname, 'index.js')}, moduleName, platform);
   }
   return context.resolveRequest(context, moduleName, platform);
  },
  nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
  blockList: [new RegExp(path.resolve(__dirname, '../web/node_modules').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/.*')],
 },
});
