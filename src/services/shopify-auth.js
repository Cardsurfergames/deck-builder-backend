/**
 * Shopify Auth Service
 * 
 * Handles the Client Credentials Grant flow for Dev Dashboard apps.
 * Exchanges Client ID + Client Secret for a short-lived access token.
 * Tokens expire after 24 hours - this service caches and auto-refreshes them.
 */

const { URLSearchParams } = require('node:url');

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  // Return cached token if still valid (with 60-second buffer)
  if (cachedToken && Date.now() < tokenExpiresAt - 60000) {
    console.log('[SHOPIFY-AUTH] Using cached access token');
    return cachedToken;
  }

  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;

  if (!clientId || !clientSecret || !storeDomain) {
    console.error('[SHOPIFY-AUTH] Missing credentials!');
    console.error(`[SHOPIFY-AUTH] Client ID: ${clientId ? 'SET' : 'MISSING'}`);
    console.error(`[SHOPIFY-AUTH] Client Secret: ${clientSecret ? 'SET' : 'MISSING'}`);
    console.error(`[SHOPIFY-AUTH] Store Domain: ${storeDomain ? 'SET' : 'MISSING'}`);
    throw new Error('Missing Shopify credentials in environment variables');
  }

  console.log('[SHOPIFY-AUTH] Requesting new Shopify access token...');
  console.log(`[SHOPIFY-AUTH] Store domain: ${storeDomain}`);
  console.log(`[SHOPIFY-AUTH] Client ID: ${clientId ? clientId.substring(0, 8) + '...' : 'EMPTY'}`);
  console.log(`[SHOPIFY-AUTH] Client Secret: ${clientSecret ? '***SET*** (length: ' + clientSecret.length + ')' : 'EMPTY'}`);

  const tokenUrl = `https://${storeDomain}/admin/oauth/access_token`;
  console.log(`[SHOPIFY-AUTH] Token URL: ${tokenUrl}`);

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  console.log(`[SHOPIFY-AUTH] Response status: ${response.status} ${response.statusText}`);

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[SHOPIFY-AUTH] Token request failed: ${response.status} - ${errorText}`);
    throw new Error(`Failed to get access token: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  console.log(`[SHOPIFY-AUTH] Token response keys: ${Object.keys(data).join(', ')}`);
  
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in || 86399) * 1000;
  
  console.log(`[SHOPIFY-AUTH] Successfully obtained new access token (expires in ~${Math.round((data.expires_in || 86399) / 3600)}h)`);
  return cachedToken;
}

/**
 * Make an authenticated request to the Shopify Admin API (GraphQL)
 */
async function shopifyGraphQL(query, variables = {}) {
  const token = await getAccessToken();
  const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
  const url = `https://${storeDomain}/admin/api/2026-01/graphql.json`;
  
  console.log(`[SHOPIFY-GQL] Making GraphQL request to ${url}`);
  console.log(`[SHOPIFY-GQL] Query preview: ${query.substring(0, 100).replace(/\s+/g, ' ')}...`);
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[SHOPIFY-GQL] Request failed: ${response.status} - ${errorText}`);
    throw new Error(`Shopify GraphQL error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  
  if (data.errors) {
    console.error(`[SHOPIFY-GQL] GraphQL errors:`, JSON.stringify(data.errors, null, 2));
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(data.errors)}`);
  }

  console.log(`[SHOPIFY-GQL] Request successful`);
  return data;
}

/**
 * Make an authenticated request to the Shopify Admin REST API
 */
async function shopifyREST(endpoint) {
  const token = await getAccessToken();
  const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
  const url = `https://${storeDomain}/admin/api/2026-01/${endpoint}`;
  
  console.log(`[SHOPIFY-REST] Making REST request to ${url}`);
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'X-Shopify-Access-Token': token,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[SHOPIFY-REST] Request failed: ${response.status} - ${errorText}`);
    throw new Error(`Shopify REST error: ${response.status} - ${errorText}`);
  }

  console.log(`[SHOPIFY-REST] Request successful`);
  return response.json();
}

module.exports = { getAccessToken, shopifyGraphQL, shopifyREST };
