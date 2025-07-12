function isProductionHttps() {
  const isProd = process.env.NODE_ENV === 'production';
  const domain = process.env.DOMAIN_NAME;
  return isProd && domain && !domain.includes('localhost') && !domain.startsWith('127.');
}
module.exports = isProductionHttps;
