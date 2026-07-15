import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: { extend: { colors: { orion: { ink: '#070a0f', panel: '#101720', blue: '#3b82f6', green: '#35d56f', gold: '#e3bb4f' } } } },
  plugins: []
};

export default config;
