const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

/**
 * Abre um browser headless, navega até a URL e retorna o texto capturado
 * @param {string} url URL da página
 * @param {(page: import('puppeteer').Page) => Promise<string|null>} extractor Função que extrai o preço da página
 * @returns {Promise<string|null>}
 */
async function scrapeWithPuppeteer(url, extractor) {
  const browser = await puppeteer.launch({ headless: "new", args: [
    '--no-sandbox',
    '--disable-setuid-sandbox'
  ] });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36'
    );
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const result = await extractor(page);
    return result;
  } catch (err) {
    console.error('Puppeteer scrape error:', err.message);
    return null;
  } finally {
    await browser.close();
  }
}

async function getSteamPrice(name) {
  const searchUrl = `https://store.steampowered.com/search/?term=${encodeURIComponent(name)}`;
  return scrapeWithPuppeteer(searchUrl, async (page) => {
    const selector = '.search_result_row:first-child .discount_final_price';
    await page.waitForSelector(selector, { timeout: 10000 }).catch(() => {});
    const price = await page.$eval(selector, el => el.textContent.trim()).catch(() => null);
    return price;
  });
}

async function getThunderPrice(name) {
  console.log(`Buscando preço Thunder Keys para: ${name}`);
  const searchUrl = `https://thunderkeys.com/search?q=${encodeURIComponent(name)}&type=product`;
  return scrapeWithPuppeteer(searchUrl, async (page) => {
    await page.waitForTimeout(3000); // garante carregamento
    try {
      // Tenta esperar pelo texto de preço em qualquer elemento
      await page.waitForFunction(() => {
        return /R\$\s?\d/.test(document.body.innerText);
      }, { timeout: 10000 });

      const price = await page.evaluate(() => {
        // Procura primeiro card de produto
        const card = document.querySelector('a[href*="/products/"]');
        const context = card || document;

        // Coleta todo o texto visível dentro do contexto
        const texts = context.innerText.split('\n').map(t => t.trim()).filter(Boolean);
        for (const t of texts) {
          const match = t.match(/R\$\s?[0-9\.]+,[0-9]{2}/);
          if (match) return match[0];
        }

        // Fallback: procura em elementos com classes comuns
        const candidates = context.querySelectorAll('.money, .price, span, div');
        for (const el of candidates) {
          const txt = el.textContent.trim();
          const m = txt.match(/R\$\s?[0-9\.]+,[0-9]{2}/);
          if (m) return m[0];
        }
        return null;
      });

      console.log(`Preço Thunder Keys obtido: ${price}`);
      return price;
    } catch (err) {
      console.error('Erro ao extrair preço Thunder Keys:', err.message);
      return null;
    }
  });
}

async function getKinguinPrice(name) {
  console.log(`Buscando preço Kinguin para: ${name}`);
  const searchUrl = `https://www.kinguin.net/category/search?sort=popularity&q=${encodeURIComponent(name)}`;
  return scrapeWithPuppeteer(searchUrl, async (page) => {
    // Adiciona delay para permitir que a página carregue completamente
    await page.waitForTimeout(2000);
    
    // Tenta vários seletores
    try {
      await page.waitForSelector('div.product-card, div[data-testid="product-card"], a[href*="/category/"]', { timeout: 10000 });
      
      const price = await page.evaluate(() => {
        const cards = document.querySelectorAll('div.product-card, div[data-testid="product-card"], a[href*="/category/"]');
        if (!cards || cards.length === 0) return null;
        
        // Pega o primeiro card
        const card = cards[0];
        
        // Tenta vários seletores de preço
        let priceEl = 
          card.querySelector('.price, .final-price, span.whitespace-nowrap, div[data-testid="main-price"]') || 
          card.querySelector('span:not([class])') ||
          card.querySelector('*[data-testid*="price"]');
        
        if (!priceEl) {
          // Se não encontrar, tenta pegar qualquer texto que pareça um preço (€xx.xx)
          const allSpans = card.querySelectorAll('span');
          for (const span of allSpans) {
            const text = span.textContent.trim();
            if (text.includes('€') || text.includes('$')) {
              priceEl = span;
              break;
            }
          }
        }
        
        return priceEl ? priceEl.textContent.trim() : null;
      });
      
      console.log(`Preço encontrado na Kinguin: ${price}`);
      return price;
    } catch (err) {
      console.error('Erro ao extrair preço da Kinguin:', err.message);
      return null;
    }
  });
}

async function getNuuvemPrice(name) {
  const searchUrl = `https://www.nuuvem.com/br-pt/catalog/search?q=${encodeURIComponent(name)}`;
  return scrapeWithPuppeteer(searchUrl, async (page) => {
    await page.waitForSelector('.product-card', { timeout: 10000 }).catch(() => {});
    const price = await page.$$eval('.product-card:first-child .price-card--price, .product-card:first-child .product-price-current', els => els.length ? els[0].textContent.trim() : null);
    return price;
  });
}

async function getAllPrices(name) {
  const [steam, kinguin, nuuvem] = await Promise.all([
    getSteamPrice(name),
    getKinguinPrice(name),
    getNuuvemPrice(name)
  ]);
  return { steam, kinguin, nuuvem };
}

async function getGGDealsPrices(name) {
  console.log(`Buscando preços na GG.deals para: ${name}`);
  const searchUrl = `https://gg.deals/search/?query=${encodeURIComponent(name)}`;
  return scrapeWithPuppeteer(searchUrl, async (page) => {
    try {
      // Espera aparecer qualquer link de resultado
      await page.waitForSelector('a[href*="/game/"], a.search-result-link, a.game-info__title', { timeout: 10000 });
      // Pega link do primeiro resultado
      const gameHref = await page.evaluate(() => {
        const link = document.querySelector('a.search-result-link, a[href*="/game/"], a.game-info__title');
        return link ? (link.href.startsWith('http') ? link.href : `${location.origin}${link.getAttribute('href')}`) : null;
      });
      if (!gameHref) return {};

      // Navega para a página do jogo
      await page.goto(gameHref, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForSelector('.offers-table, .offers-table-row, .offer-row', { timeout: 10000 });

      const prices = await page.evaluate(() => {
        const mapping = {};
        // Seleciona linhas de oferta – podem variar de classe
        const rows = document.querySelectorAll('.offers-table-row, .offer-row, tr');
        rows.forEach(row => {
          const storeEl = row.querySelector('[data-original-title], .shop-logo img, .shop-logo');
          const priceEl = row.querySelector('.price, .price-new, .price__current');
          if (!storeEl || !priceEl) return;
          const store = (storeEl.getAttribute('data-original-title') || storeEl.alt || storeEl.title || storeEl.textContent || '').trim().toLowerCase();
          const priceText = priceEl.textContent.trim();
          if (!store || !priceText) return;
          // Normaliza alguns nomes
          if (store.includes('steam')) mapping.steam = priceText;
          else if (store.includes('instant')) mapping.instant = priceText;
          else if (store.includes('epic')) mapping.epic = priceText;
          else if (store.includes('gog')) mapping.gog = priceText;
          else if (store.includes('playstation')) mapping.playstation = priceText;
          else if (store.includes('xbox')) mapping.xbox = priceText;
        });
        return mapping;
      });

      console.log('Preços coletados GG.deals:', prices);
      return prices;
    } catch (err) {
      console.error('Erro ao extrair preços da GG.deals:', err.message);
      return {};
    }
  });
}
async function getSteamDBPrice(name) {
  console.log(`Buscando preço SteamDB (Puppeteer) para: ${name}`);
  const searchUrl = `https://steamdb.info/search/?a=app&q=${encodeURIComponent(name)}&type=1&category=0`;
  return scrapeWithPuppeteer(searchUrl, async (page) => {
    try {
      await page.waitForSelector('table.table-products tbody tr', { timeout: 10000 });
      const price = await page.$$eval('table.table-products tbody tr:first-child td', tds => {
        if (!tds || tds.length === 0) return null;
        // Normalmente o preço está na última coluna
        const last = tds[tds.length - 1].textContent.trim();
        return last || null;
      });
      console.log(`Preço SteamDB obtido: ${price}`);
      return price;
    } catch (err) {
      console.error('Erro ao extrair preço SteamDB via Puppeteer:', err.message);
      return null;
    }
  });
}

module.exports = {
  getSteamPrice,
  getThunderPrice,
  getKinguinPrice,
  getNuuvemPrice,
  getAllPrices,
  getGGDealsPrices,
  getSteamDBPrice
};