'use strict';

const path = require('path');
const webpack = require('webpack');

const isDevelopment = process.env.NODE_ENV !== 'production';

/** @type {import('webpack').Configuration} */
const extensionConfig = {
  target: 'node',
  mode: 'none',

  entry: './src/extension.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    clean: true,
    filename: 'extension.js',
    libraryTarget: 'commonjs2'
  },
  externals: {
    vscode: 'commonjs vscode'
  },
  resolve: {
    extensions: ['.ts', '.js', '.wasm'],
    fallback: {
      fs: false,
      path: false,
      crypto: false,
      'node:crypto': false
    }
  },
  experiments: {
    asyncWebAssembly: true,
    syncWebAssembly: true
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: [/node_modules/, /src\/test/],
        use: [
          {
            loader: 'ts-loader',
            options: {
              configFile: path.resolve(__dirname, 'tsconfig.json'),
            }
          }
        ]
      },
      {
        test: /\.wasm$/,
        type: 'webassembly/async'
      }
    ]
  },
  devtool: 'nosources-source-map',
  infrastructureLogging: {
    level: "log",
  }
};

/** @type {import('webpack').Configuration} */
const rendererConfig = {
  target: 'web',
  mode: 'none',

  entry: './src/renderer/index.tsx',
  output: {
    path: path.resolve(__dirname, 'dist-renderer'),
    filename: 'renderer.js',
    clean: true,
    libraryTarget: 'module',
    globalObject: 'window'
  },

  experiments: {
    outputModule: true
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js']
  },
  module: {
    rules: [
      {
        test: /\.d\.ts$/,
        exclude: /node_modules/,
        loader: 'ignore-loader',
      },
      {
        test: /(?<!\.d)\.tsx?$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              configFile: path.resolve(__dirname, 'tsconfig.renderer.json'),
            }
          }
        ]
      },
      {
        test: /\.svg$/i,
        issuer: /\.[jt]sx?$/,
        use: ['@svgr/webpack'],
      },
      {
        test: /\.css$/i,
        use: 'raw-loader',
      },
    ]
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify(isDevelopment ? 'development' : 'production'),
    }),
  ],
  optimization: {
    nodeEnv: false,
  },
  devtool: 'nosources-source-map',
  infrastructureLogging: {
    level: "log",
  }
};

module.exports = [extensionConfig, rendererConfig];