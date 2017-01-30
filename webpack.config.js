var Plugin = require('./plugin');

module.exports = {
  entry: {
    app: './src/A.js'
  },
  output: {
    filename: '[name].js'
  },
  module: {
    loaders: [
      {
        test: /.jsx?$/,
        loader: 'babel-loader',
        query: {
          presets: ['es2015']
        }
      }
    ]
  },
  plugins: [
    new Plugin(),
  ]
}
