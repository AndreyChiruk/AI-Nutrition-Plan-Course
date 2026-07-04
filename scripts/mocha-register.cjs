require('dotenv').config({
  path: require('path').resolve(__dirname, '..', '.env'),
});
require('ts-node').register({
  project: require('path').resolve(__dirname, '..', 'tsconfig.test.json'),
  transpileOnly: true,
});
