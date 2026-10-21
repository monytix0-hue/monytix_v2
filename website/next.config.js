const { loadEnvConfig } = require("@next/env");
const path = require("path");

loadEnvConfig(path.join(__dirname, ".."));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
};

module.exports = nextConfig;
