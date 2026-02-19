/**
 * Deck Parser Service
 * 
 * Parses deck lists from various formats:
 * - Plain text (standard MTG format: "1 Card Name" or "1x Card Name")
 * - Moxfield URLs
 * - Archidekt URLs (future)
 * - MTGGoldfish URLs (future)
 */

/**
 * Parse a plain text deck list
 * 
 * Supports formats:
 *   1 Lightning Bolt
 *   1x Lightning Bolt
 *   4x Sol Ring
 *   1 Fell the Profane // Fell the Profane (split/modal cards)
 * 
 * Also handles section headers like:
 *   // Creatures
 *   Deck
 *   Sideboard
 *   Commander
 *   COMMANDER:
 */
function parseTextDeckList(text) {
  const lines = text.split('\n');
  const cards = [];
  const errors = [];

  console.log(`[PARSER] Parsing text deck list (${lines.length} lines)...`);

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    
    // Skip empty lines
    if (!line) continue;

    // Skip section headers
    if (
      line.startsWith('//') ||
      line.startsWith('#') ||
      /^(Deck|Sideboard|Commander|Companion|Maybeboard|About|COMMANDER:|SIDEBOARD:|MAINBOARD:)\s*$/i.test(line)
    ) {
      console.log(`[PARSER] Skipping header line ${i + 1}: "${line}"`);
      continue;
    }

    // Try to match: quantity + optional 'x' + card name
    // Also handle optional set code in parentheses or brackets at the end
    const match = line.match(/^(\d+)\s*x?\s+(.+?)(?:\s*[\(\[][\w\d]+[\)\]])?(?:\s+\*\w+\*)?(?:\s+#\S+)?$/i);
    
    if (match) {
      const quantity = parseInt(match[1], 10);
      let cardName = match[2].trim();

      // Handle double-faced / split cards - use the front face name
      // "Fell the Profane // Fell the Profane" -> "Fell the Profane"
      if (cardName.includes(' // ')) {
        cardName = cardName.split(' // ')[0].trim();
      }

      // Remove collector number if present at end (e.g., "Sol Ring (123)")
      cardName = cardName.replace(/\s*\(\d+\)\s*$/, '').trim();

      if (cardName && quantity > 0) {
        cards.push({ name: cardName, quantity });
      } else {
        errors.push({ line: i + 1, text: line, reason: 'Invalid quantity or empty card name' });
      }
    } else {
      // Maybe it's just a card name without quantity (assume 1)
      if (line.length > 1 && !line.match(/^\d+$/)) {
        let cardName = line;
        if (cardName.includes(' // ')) {
          cardName = cardName.split(' // ')[0].trim();
        }
        cards.push({ name: cardName, quantity: 1 });
      } else {
        errors.push({ line: i + 1, text: line, reason: 'Could not parse line' });
      }
    }
  }

  console.log(`[PARSER] Parsed ${cards.length} cards from text (${errors.length} errors)`);
  if (errors.length > 0) {
    console.log(`[PARSER] Parse errors:`, JSON.stringify(errors));
  }
  if (cards.length > 0) {
    console.log(`[PARSER] First few cards: ${cards.slice(0, 5).map(c => `${c.quantity}x ${c.name}`).join(', ')}`);
  }

  return { cards, errors };
}

/**
 * Fetch and parse a deck from Moxfield
 * Moxfield has a public API at api.moxfield.com
 */
async function parseMoxfieldUrl(url) {
  console.log(`[PARSER] Parsing Moxfield URL: ${url}`);

  // Extract deck ID from URL
  // URLs look like: https://www.moxfield.com/decks/DECK_ID
  const match = url.match(/moxfield\.com\/decks\/([a-zA-Z0-9_-]+)/);
  if (!match) {
    console.error(`[PARSER] Could not extract deck ID from Moxfield URL: ${url}`);
    throw new Error('Invalid Moxfield URL. Expected format: https://www.moxfield.com/decks/DECK_ID');
  }

  const deckId = match[1];
  console.log(`[PARSER] Moxfield deck ID: ${deckId}`);
  
  const apiUrl = `https://api2.moxfield.com/v3/decks/all/${deckId}`;
  console.log(`[PARSER] Fetching from Moxfield API: ${apiUrl}`);

  const response = await fetch(apiUrl, {
    headers: {
      'User-Agent': 'CardsurferDeckBuilder/1.0',
    },
  });

  console.log(`[PARSER] Moxfield API response status: ${response.status}`);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Deck not found on Moxfield. Make sure the deck is public and the URL is correct.');
    }
    const errorText = await response.text();
    console.error(`[PARSER] Moxfield API error: ${errorText}`);
    throw new Error(`Failed to fetch deck from Moxfield: ${response.status}`);
  }

  const deck = await response.json();
  console.log(`[PARSER] Moxfield deck name: "${deck.name}", format: ${deck.format}`);
  
  const cards = [];

  // Moxfield organizes cards into boards: mainboard, sideboard, commanders, companions
  const boards = ['mainboard', 'sideboard', 'commanders', 'companions'];
  
  for (const boardName of boards) {
    const board = deck[boardName];
    if (!board) continue;

    const boardCards = Object.entries(board);
    console.log(`[PARSER] Moxfield board "${boardName}": ${boardCards.length} cards`);

    for (const [cardName, cardData] of boardCards) {
      cards.push({
        name: cardData.card?.name || cardName,
        quantity: cardData.quantity || 1,
        board: boardName,
      });
    }
  }

  console.log(`[PARSER] Total cards from Moxfield: ${cards.length}`);

  return {
    cards,
    deckName: deck.name || 'Unnamed Deck',
    format: deck.format || 'unknown',
    errors: [],
  };
}

/**
 * Fetch and parse a deck from Archidekt
 */
async function parseArchidektUrl(url) {
  console.log(`[PARSER] Parsing Archidekt URL: ${url}`);

  // Extract deck ID from URL
  // URLs look like: https://archidekt.com/decks/123456
  const match = url.match(/archidekt\.com\/decks\/(\d+)/);
  if (!match) {
    console.error(`[PARSER] Could not extract deck ID from Archidekt URL: ${url}`);
    throw new Error('Invalid Archidekt URL. Expected format: https://archidekt.com/decks/123456');
  }

  const deckId = match[1];
  console.log(`[PARSER] Archidekt deck ID: ${deckId}`);

  const apiUrl = `https://archidekt.com/api/decks/${deckId}/`;
  console.log(`[PARSER] Fetching from Archidekt API: ${apiUrl}`);

  const response = await fetch(apiUrl, {
    headers: {
      'User-Agent': 'CardsurferDeckBuilder/1.0',
    },
  });

  console.log(`[PARSER] Archidekt API response status: ${response.status}`);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Deck not found on Archidekt. Make sure the deck is public and the URL is correct.');
    }
    const errorText = await response.text();
    console.error(`[PARSER] Archidekt API error: ${errorText}`);
    throw new Error(`Failed to fetch deck from Archidekt: ${response.status}`);
  }

  const deck = await response.json();
  console.log(`[PARSER] Archidekt deck name: "${deck.name}", format: ${deck.format?.name}`);
  
  const cards = [];

  if (deck.cards) {
    for (const cardEntry of deck.cards) {
      const card = cardEntry.card;
      cards.push({
        name: card?.oracleCard?.name || card?.name || 'Unknown',
        quantity: cardEntry.quantity || 1,
        board: cardEntry.category || 'mainboard',
      });
    }
  }

  console.log(`[PARSER] Total cards from Archidekt: ${cards.length}`);

  return {
    cards,
    deckName: deck.name || 'Unnamed Deck',
    format: deck.format?.name || 'unknown',
    errors: [],
  };
}

/**
 * Auto-detect input type and parse accordingly
 */
async function parseDeckInput(input) {
  const trimmed = input.trim();
  console.log(`[PARSER] Auto-detecting input type (length: ${trimmed.length})...`);
  console.log(`[PARSER] Input preview: "${trimmed.substring(0, 100)}${trimmed.length > 100 ? '...' : ''}"`);

  // Check if it's a Moxfield URL
  if (trimmed.includes('moxfield.com/decks/')) {
    console.log('[PARSER] Detected Moxfield URL');
    return await parseMoxfieldUrl(trimmed);
  }

  // Check if it's an Archidekt URL
  if (trimmed.includes('archidekt.com/decks/')) {
    console.log('[PARSER] Detected Archidekt URL');
    return await parseArchidektUrl(trimmed);
  }

  // Otherwise, treat as plain text deck list
  console.log('[PARSER] Treating input as plain text deck list');
  const result = parseTextDeckList(trimmed);
  return {
    ...result,
    deckName: 'Imported Deck',
    format: 'unknown',
  };
}

module.exports = { parseTextDeckList, parseMoxfieldUrl, parseArchidektUrl, parseDeckInput };
