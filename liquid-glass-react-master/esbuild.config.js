const esbuild = require('esbuild');
const path = require('path');

const createBuildConfig = (format) => ({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format,
  outfile: format === 'esm' ? 'dist/index.esm.js' : 'dist/index.js',
  external: ['react', 'react-dom'],
  target: ['es2020'],
  jsx: 'automatic',
  jsxImportSource: 'react',
  minify: process.env.NODE_ENV === 'production',
  sourcemap: true,
  platform: 'browser',
  splitting: false,
  loader: {
    '.tsx': 'tsx',
    '.ts': 'ts',
    '.js': 'js',
    '.jsx': 'jsx'
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development')
  }
});

const buildAll = async () => {
  try {
    console.log('🚀 Building ESM bundle...');
    await esbuild.build(createBuildConfig('esm'));
    console.log('✅ ESM bundle built successfully');

    console.log('🚀 Building CJS bundle...');
    await esbuild.build(createBuildConfig('cjs'));
    console.log('✅ CJS bundle built successfully');

    console.log('🎉 All bundles built successfully!');
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
};

const watch = async () => {
  try {
    console.log('👀 Starting watch mode for ESM bundle...');
    const ctx = await esbuild.context(createBuildConfig('esm'));
    await ctx.watch();
    console.log('✅ Watch mode active - listening for changes...');
  } catch (error) {
    console.error('❌ Watch mode failed:', error);
    process.exit(1);
  }
};

// Check command line arguments
const args = process.argv.slice(2);
if (args.includes('--watch')) {
  watch();
} else {
  buildAll();
}

module.exports = { createBuildConfig, buildAll, watch };