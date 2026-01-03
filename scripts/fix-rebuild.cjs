const nodeGyp = require('node-gyp')
const grep = require('grep-package-json')

// Set MSVS version to 2022 to ensure modern C++ support
process.env.npm_config_msvs_version = '2022'
// Force C++20 for tree-sitter
process.env.CXXFLAGS = '-std=c++20'

console.log('Using MSVS 2022 and forcing C++20...')
