const express = require("express");
const cors = require("cors");
const cheerio = require("cheerio");
const puppeteerScraper = require('./puppeteerScraper');

// Usando o fetch global disponível no Node.js mais recente
// ou importando node-fetch para versões mais antigas do Node.js
let fetch;
if (!globalThis.fetch) {
  try {
    fetch = require("node-fetch");
  } catch (e) {
    console.error("node-fetch não está instalado. Por favor, instale com: npm install node-fetch");
    process.exit(1);
  }
} else {
  fetch = globalThis.fetch;
}

const app = express();
// Use environment port or default 3000
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Servir arquivos estáticos do frontend para desenvolvimento local
const path = require('path');
app.use(express.static(path.join(__dirname)));
// Rota da página inicial
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ----- CONFIGURAÇÕES DA TWITCH -----
const CLIENT_ID = "083qn0q19mcx8y2f4e6bxw3coatsr1";
const CLIENT_SECRET = "ejh2yuzmd30gvvza4kw6u2uhhlm8yw";
let ACCESS_TOKEN = "";

// CheapShark store cache
const CHEAPSHARK_STORES = {};
async function loadCheapSharkStores() {
  try {
    const resp = await fetch('https://www.cheapshark.com/api/1.0/stores');
    if (resp.ok) {
      const stores = await resp.json();
      stores.forEach(s => {
        CHEAPSHARK_STORES[s.storeID] = s.storeName;
      });
      console.log('CheapShark stores carregadas');
    }
  } catch (err) {
    console.error('Falha ao carregar lista de lojas do CheapShark:', err.message);
  }
}
async function ensureCheapSharkStores() {
  if (Object.keys(CHEAPSHARK_STORES).length === 0) {
    await loadCheapSharkStores();
  }
}
// faz pré-carregamento sem bloquear start
loadCheapSharkStores();
// Função para gerar token da Twitch
async function getAccessToken() {
  try {
    console.log("[TOKEN] Gerando token com:", CLIENT_ID, CLIENT_SECRET);
    const res = await fetch(
      `https://id.twitch.tv/oauth2/token?client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&grant_type=client_credentials`,
      { method: "POST" }
    );
    const data = await res.json();
    console.log("[TOKEN] Resposta da Twitch:", data);
    ACCESS_TOKEN = data.access_token;
    console.log("[TOKEN] Token gerado:", ACCESS_TOKEN);
  } catch (err) {
    console.error("[TOKEN] Erro ao gerar token:", err);
  }
}

getAccessToken();
setInterval(getAccessToken, 1000 * 60 * 60); // Atualiza token a cada 1 hora

// ----- ROTAS -----

// Busca por nome
app.get("/games", async (req, res) => {
  const search = req.query.search;
  console.log(`[API] /games chamada. Termo: ${search}`);
  if (!search) {
    console.log('[API] Termo de busca vazio.');
    return res.json([]);
  }
  try {
    console.log('[API] Token usado:', ACCESS_TOKEN);
    const response = await fetch("https://api.igdb.com/v4/games", {
      method: "POST",
      headers: {
        "Client-ID": CLIENT_ID,
        "Authorization": `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "text/plain",
      },
      body: `search "${search}"; fields name, cover.url, rating, first_release_date; limit 20;`,
    });
    console.log('[API] Status IGDB:', response.status);
    const jogos = await response.json();
    console.log('[API] Resposta IGDB:', jogos);
    if (Array.isArray(jogos)) {
      res.json(jogos);
    } else {
      res.json([]);
    }
  } catch (err) {
    console.error("[API] Erro ao buscar jogos:", err);
    res.json([]);
  }
});

// Nova rota /api/search que atua como proxy para /games
app.get("/api/search", async (req, res) => {
  const search = req.query.query; // O frontend usa 'query' para o termo de busca
  console.log(`[API] /api/search chamada. Termo: ${search}`);
  if (!search) {
    console.log('[API] Termo de busca vazio.');
    return res.json([]);
  }
  try {
    console.log('[API] Token usado:', ACCESS_TOKEN);
    const response = await fetch("https://api.igdb.com/v4/games", {
      method: "POST",
      headers: {
        "Client-ID": CLIENT_ID,
        "Authorization": `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "text/plain",
      },
      body: `search "${search}"; fields name, cover.url, rating, first_release_date; limit 20;`,
    });
    console.log('[API] Status IGDB:', response.status);
    const jogos = await response.json();
    console.log('[API] Resposta IGDB:', jogos);
    if (Array.isArray(jogos)) {
      res.json(jogos);
    } else {
      res.json([]);
    }
  } catch (err) {
    console.error("[API] Erro ao buscar jogos na rota /api/search:", err);
    res.json([]);
  }
});

// Busca detalhes de um jogo específico por ID
app.get("/games/:id", async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: "ID do jogo não fornecido" });
  
  try {
    const response = await fetch("https://api.igdb.com/v4/games", {
      method: "POST",
      headers: {
        "Client-ID": CLIENT_ID,
        "Authorization": `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "text/plain",
      },
      body: `where id = ${id}; fields name, cover.image_id, rating, first_release_date, summary, storyline, genres.name, platforms.name, involved_companies.company.name, involved_companies.developer, involved_companies.publisher, screenshots.image_id, videos.video_id; limit 1;`,
    });
    
    const jogos = await response.json();
    
    if (jogos.length === 0) {
      return res.status(404).json({ error: "Jogo não encontrado" });
    }
    
    const jogo = jogos[0];
    
    // Construir URL da capa no formato correto
    if (jogo.cover && jogo.cover.image_id) {
      jogo.coverUrl = `https://images.igdb.com/igdb/image/upload/t_cover_big/${jogo.cover.image_id}.jpg`;
    } else {
      jogo.coverUrl = null;
    }
    
    // Construir URLs dos screenshots
    if (jogo.screenshots && jogo.screenshots.length > 0) {
      jogo.screenshotUrls = jogo.screenshots.map(screenshot => 
        `https://images.igdb.com/igdb/image/upload/t_screenshot_huge/${screenshot.image_id}.jpg`
      );
    } else {
      jogo.screenshotUrls = [];
    }
    
    res.json(jogo);
  } catch (err) {
    console.error("Erro ao buscar detalhes do jogo:", err);
    res.status(500).json({ error: "Erro ao buscar detalhes do jogo" });
  }
});

// Rota POST /games/query para queries customizadas IGDB
app.post("/games/query", async (req, res) => {
  try {
    const query = req.body.query;
    if (!query) return res.status(400).json({ error: "Query não fornecida" });

    if (!ACCESS_TOKEN) {
      return res.status(500).json({ error: "Token IGDB não disponível" });
    }

    const igdbRes = await fetch("https://api.igdb.com/v4/games", {
      method: "POST",
      headers: {
        "Client-ID": CLIENT_ID,
        "Authorization": `Bearer ${ACCESS_TOKEN}`,
        "Accept": "application/json",
        "Content-Type": "text/plain"
      },
      body: query
    });

    if (!igdbRes.ok) {


// Inicializa o servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
      const errText = await igdbRes.text();
      return res.status(igdbRes.status).json({ error: "Erro IGDB", details: errText });
    }

    const jogos = await igdbRes.json();
    res.json(jogos);
  } catch (err) {
    console.error("Erro /games/query:", err);
    res.status(500).json({ error: "Erro interno", details: err.message });
  }
});

// Rota para obter preço de jogo no SteamDB
const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36"
};

async function fetchWithTimeout(url, timeout = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { headers: DEFAULT_HEADERS, signal: controller.signal });
    clearTimeout(id);
    if (!res.ok) throw new Error(`Falha ao acessar ${url}`);
    return await res.text();
  } catch (err) {
    console.error("Erro fetch timeout:", err.message);
    return null;
  }
}

// -------- Scrapers --------
async function scrapeSteamDB(name) {
  try {
    const html = await fetchWithTimeout(`https://steamdb.info/search/?a=app&q=${encodeURIComponent(name)}&type=1&category=0`);
    if (!html) return null;
    const $ = cheerio.load(html);
    const firstRow = $("table.table-products tbody tr").first();
    if (!firstRow || firstRow.length === 0) return null;

    // Tenta capturar diferentes colunas de preço
    let price = firstRow.find('td.price-discount-final, td.price.final, td:last-child').first().text().trim();
    price = price.replace(/\s+/g, ' ');
    return price || null;
  } catch (err) {
    console.error("SteamDB scrape error:", err.message);
    return null;
  }
}

async function scrapeInstantGaming(name) {
  try {
    const html = await fetchWithTimeout(`https://www.instant-gaming.com/pt/pesquisar/?q=${encodeURIComponent(name)}`);
    if (!html) return null;
    const $ = cheerio.load(html);
    const firstCard = $(".searchResults .item, .search-wrapper .item").first();
    let price = firstCard.find(".price, .price-value, .price-old").first().text().trim();
    if (!price) {
      price = firstCard.find('[itemprop="price"]').attr("content") || "";
    }
    price = price.replace(/\s+/g, ' ').trim();
    return price || null;
  } catch (err) {
    console.error("InstantGaming scrape error:", err.message);
    return null;
  }
}

// Novo scraper Thunder Keys (substitui Nuuvem)
async function scrapeThunder(name) {
  try {
    const searchUrl = `https://thunderkeys.com/search?q=${encodeURIComponent(name)}&type=product`;
    const html = await fetchWithTimeout(searchUrl);
    if (!html) return null;
    const $ = cheerio.load(html);

    // O primeiro resultado costuma estar em um card com classe que contém preço em .money ou .price
    const firstCard = $('a[href*="/products/"]').first();
    if (!firstCard || firstCard.length === 0) return null;

    let price = firstCard.find('.money, .price').first().text().trim();
    price = price.replace(/\s+/g, ' ').trim();
    return price || null;
  } catch (err) {
    console.error('Thunder Keys scrape error:', err.message);
    return null;
  }
}

// Adiciona chave e helper da GG.deals
const GGDEALS_KEY = '0GTvjgzvPhVSkbiFL6Enkh60UwsgyfK1';

async function getSteamAppIdByName(gameName) {
  try {
    const resp = await fetch(`https://store.steampowered.com/api/storesearch?term=${encodeURIComponent(gameName)}&cc=us&l=english`);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.items && data.items.length) {
      return data.items[0].id;
    }
    return null;
  } catch (e) {
    console.error('Erro ao buscar AppID Steam:', e.message);
    return null;
  }
}

// Função para normalizar nomes de jogos para melhor busca
function normalizeGameName(name) {
  if (!name) return '';
  
  // Remove caracteres especiais e normaliza espaços
  let normalized = name
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  
  // Trata variações comuns
  const variations = {
    'delta': ['delta', 'Δ', 'd'],
    'metal gear solid': ['mgs', 'metal gear solid', 'metal gear'],
    'final fantasy': ['ff', 'final fantasy'],
    'call of duty': ['cod', 'call of duty'],
    'grand theft auto': ['gta', 'grand theft auto']
  };
  
  // Aplica substituições inteligentes
  for (const [key, values] of Object.entries(variations)) {
    for (const value of values) {
      if (normalized.includes(value.toLowerCase())) {
        normalized = normalized.replace(new RegExp(value.toLowerCase(), 'g'), key);
      }
    }
  }
  
  return normalized;
}

// Função para gerar variações de busca
function generateSearchVariations(name) {
  const base = name.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const variations = [base];
  
  // Adiciona variações sem subtítulos
  const parts = base.split(' ');
  if (parts.length > 2) {
    variations.push(parts.slice(0, 2).join(' '));
    variations.push(parts.slice(0, 3).join(' '));
  }
  
  // Remove números romanos
  const withoutRoman = base.replace(/\b(?:[IVXLCDM]+)\b/g, '').trim();
  if (withoutRoman !== base) {
    variations.push(withoutRoman);
  }
  
  return [...new Set(variations)]; // Remove duplicatas
}

// Rota para obter preços de múltiplos sites
// Nova rota /price usando CheapShark
app.get('/price', async (req, res) => {
  const { name, title } = req.query;
  const gameSearchName = name || title; // Prioriza 'name', mas usa 'title' se 'name' não estiver presente
  if (!gameSearchName) return res.status(400).json({ error: 'Nome do jogo não fornecido' });
  const variations = generateSearchVariations(gameSearchName);
  let mapping = {};
  
  try {
    await ensureCheapSharkStores();
    
    // Verifica se é um jogo não lançado (como MGS Delta)
    const availability = await checkGameAvailability(gameSearchName);
    if (availability.message) {
      return res.json({
        ...mapping,
        message: availability.message,
        unavailable: true
      });
    }
    
    // Busca jogo exato com validação de título
    const exactGame = await getExactGamePrice(gameSearchName);
    
    if (exactGame) {
      const gameID = exactGame.gameID;
      const dealsUrl = `https://www.cheapshark.com/api/1.0/games?id=${gameID}`;
      const data = await fetch(dealsUrl).then(r => r.json());
      
      if (data?.deals) {
        data.deals.forEach(d => {
          const storeID = d.storeID;
          const price = `US$ ${d.price}`;
          
          switch (storeID) {
            case '1': // Steam
              mapping.steam = price; break;
            case '11': // Epic Games
              mapping.epic = price; break;
            case '7': // GOG
              mapping.gog = price; break;
            default:
              const nameFromMap = CHEAPSHARK_STORES[storeID];
              if (nameFromMap) {
                mapping[nameFromMap] = price;
              } else {
                mapping[`Loja ${storeID}`] = price;
              }
          }
        });
      }
    }
    
    // Se não encontrou com nenhuma variação, continua com scraping e GG.deals
    if (Object.keys(mapping).length === 0) {
      // ------ GG.deals fallback ------
      try {
        const appid = await getSteamAppIdByName(gameSearchName);
        if (appid) {
          const ggUrl = `https://api.gg.deals/v1/prices/by-steam-app-id/?ids=${appid}&key=${GGDEALS_KEY}&region=br`;
          const ggResp = await fetch(ggUrl);
          if (ggResp.ok) {
            const ggData = await ggResp.json();
            const priceInfo = ggData?.data?.[appid]?.prices;
            if (priceInfo) {
              if (priceInfo.currentRetail) mapping.retail = `R$ ${priceInfo.currentRetail}`;
              if (priceInfo.currentKeyshops) mapping.keyshop = `R$ ${priceInfo.currentKeyshops}`;
            }
          }
        }
      } catch (e) {
        console.error('Erro GG.deals:', e.message);
      }

      // Se ainda não temos preços, tenta scrapers via Puppeteer Stealth
      if (Object.keys(mapping).length === 0) {
        const [steamPupp, kinguinPupp, thunderPupp] = await Promise.all([
          puppeteerScraper.getSteamDBPrice(name),
          puppeteerScraper.getKinguinPrice ? puppeteerScraper.getKinguinPrice(name) : Promise.resolve(null),
          puppeteerScraper.getThunderPrice(name)
        ]);
        if (steamPupp) mapping.steam = steamPupp;
        if (kinguinPupp) mapping.kinguin = kinguinPupp;
        if (thunderPupp) mapping.thunder = thunderPupp;
      }
    }

    // Função para buscar jogo específico com validação de título
    async function findExactGame(name, games) {
      if (!games || games.length === 0) return null;
      
      const normalizedSearch = name.toLowerCase().replace(/[^\w\s]/g, '').trim();
      
      // Procura por correspondência exata ou muito próxima
      for (const game of games) {
        const gameTitle = game.external || game.name || '';
        const normalizedTitle = gameTitle.toLowerCase().replace(/[^\w\s]/g, '').trim();
        
        // Verifica se é exatamente o jogo procurado
        if (normalizedTitle.includes(normalizedSearch) || normalizedSearch.includes(normalizedTitle)) {
          return game;
        }
        
        // Verifica variações específicas para Metal Gear
        if (normalizedSearch.includes('metal gear solid') && normalizedTitle.includes('metal gear solid')) {
          // Prioriza versões com "delta" ou "snake eater"
          if (normalizedTitle.includes('delta') || normalizedTitle.includes('snake eater')) {
            return game;
          }
        }
      }
      
      // Se não encontrou exato, retorna o primeiro mas com log
      console.log(`Jogo encontrado: ${games[0].external || games[0].name} para busca: ${name}`);
      return games[0];
    }
    
    // Função para buscar preços com validação e mensagem informativa
    async function getExactGamePrice(name) {
      const variations = [
        name,
        "Metal Gear Solid Delta: Snake Eater",
        "Metal Gear Solid Delta",
        "MGS Delta",
        "MGS Delta Snake Eater"
      ];
      
      let foundGames = [];
      
      for (const variation of variations) {
        const sanitizedName = variation.replace(/[^a-zA-Z0-9\s]/g, ' ').replace(/\s+/g,' ').trim();
        const searchUrl = `https://www.cheapshark.com/api/1.0/games?title=${encodeURIComponent(sanitizedName)}&limit=10`;
        
        try {
          const games = await fetch(searchUrl).then(r => r.json());
          
          if (games && games.length > 0) {
            // Verifica se é o remake do Delta especificamente
            for (const game of games) {
              const gameTitle = (game.external || game.name || '').toLowerCase();
              if (gameTitle.includes('delta') && gameTitle.includes('snake')) {
                return game;
              }
            }
            foundGames = [...foundGames, ...games];
          }
        } catch (e) {
          console.error(`Erro ao buscar ${variation}:`, e.message);
        }
      }
      
      // Se não encontrou variações específicas, tenta retornar o melhor candidato encontrado
      if (foundGames.length > 0) {
        return findExactGame(name, foundGames);
      }
      // Não encontrou nada adequado
      return null;
    }
    
    // Função para verificar disponibilidade em múltiplas fontes
    async function checkGameAvailability(name) {
      const checkResults = {
        cheapshark: false,
        steam: false,
        message: ''
      };
      
      // Verifica se é o Metal Gear Solid Delta
      if (name.toLowerCase().includes('metal gear solid delta')) {
        checkResults.message = 'Metal Gear Solid Delta: Snake Eater (remake) ainda não está disponível nas APIs de preços. O jogo será lançado em 2024/2025.';
        return checkResults;
      }
      
      return checkResults;
    }
    
    // Retorna mapeamento (poderá estar vazio)
    return res.json(mapping);
  } catch (err) {
    console.error('Erro ao consultar CheapShark:', err.message);
    return res.status(500).json({ error: 'Erro ao obter preços' });
  }
});
// Rota desativada temporariamente: sempre retorna objeto vazio
// app.get("/price", (req, res) => {
//   return res.json({});
// });

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
