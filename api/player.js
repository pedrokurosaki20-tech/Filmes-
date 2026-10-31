export const config = {
  api: {
    bodyParser: false,
  },
};

// Cache em memória para acelerar instantaneamente (0ms) requisições subsequentes
const playerCache = new Map();

// Utilitário para ler o stream bruto da requisição no ambiente Vercel
async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  // Headers globais de permissão, CORS e remoção de travas de iframe
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.removeHeader('X-Frame-Options');
  res.removeHeader('Content-Security-Policy');
  res.removeHeader('Content-Security-Policy-Report-Only');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const queryPath = (req.query.path || req.query.url || '').toString();
  const method = req.method;

  // 1. Roteamento de chamadas internas do player (/player/index.php e assets do vaiquecol)
  if (queryPath.startsWith('player/') || queryPath === 'player' || (req.url && req.url.includes('/player/'))) {
    const playerSubPath = queryPath.replace(/^player\/?/, '');
    const playerTarget = `https://vaiquecol.com/player/${playerSubPath}`;
    try {
      const fetchHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Referer': 'https://vaiquecol.com/',
        'Origin': 'https://vaiquecol.com',
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': '*/*'
      };
      const fetchOptions = {
        method: method,
        headers: fetchHeaders
      };
      if (method === 'POST') {
        fetchHeaders['Content-Type'] = req.headers['content-type'] || 'application/x-www-form-urlencoded; charset=UTF-8';
        fetchOptions.body = await getRawBody(req);
      }
      const pRes = await fetch(playerTarget, fetchOptions);
      const pContentType = pRes.headers.get('content-type') || 'application/json';
      res.setHeader('Content-Type', pContentType);
      const buffer = Buffer.from(await pRes.arrayBuffer());
      return res.status(pRes.status).send(buffer);
    } catch (pErr) {
      return res.status(500).send(`Player API Error: ${pErr.message}`);
    }
  }

  // 2. Roteamento de páginas proxied do vaiquecol
  if (queryPath.startsWith('proxy-vaiquecol')) {
    const targetUrl = req.query.url ? decodeURIComponent(req.query.url) : 'https://vaiquecol.com';
    try {
      const vRes = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Referer': 'https://vaiquecol.com/',
          'Origin': 'https://vaiquecol.com'
        }
      });
      let vHtml = await vRes.text();
      vHtml = cleanAndEnhancePlayerHtml(vHtml);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(vHtml);
    } catch (vErr) {
      return res.status(500).send(`Vaiquecol Proxy Error: ${vErr.message}`);
    }
  }

  // 3. Roteamento principal do Plenoflu (SuperCDN Oficial)
  let targetUrl = 'https://plenoflu.com';
  const isApiRoute = queryPath === 'api' || queryPath === '/api' || (req.url && req.url.includes('path=api'));

  if (isApiRoute) {
    targetUrl = 'https://plenoflu.com/api';
  } else if (queryPath) {
    targetUrl += queryPath.startsWith('/') ? queryPath : '/' + queryPath;
  }

  // Cache hit para páginas completas já resolvidas
  const cacheKey = `${method}_${targetUrl}`;
  if (method === 'GET' && playerCache.has(cacheKey)) {
    const cached = playerCache.get(cacheKey);
    res.setHeader('Content-Type', cached.contentType);
    return res.status(200).send(cached.data);
  }

  try {
    const fetchHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Referer': 'https://plenoflu.com/',
      'Origin': 'https://plenoflu.com',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8'
    };

    const fetchOptions = {
      method: method,
      headers: fetchHeaders
    };

    if (method === 'POST') {
      fetchHeaders['Content-Type'] = req.headers['content-type'] || 'application/x-www-form-urlencoded';
      fetchOptions.body = await getRawBody(req);
    }

    const response = await fetch(targetUrl, fetchOptions);
    const contentType = response.headers.get('content-type') || 'text/html';
    res.setHeader('Content-Type', contentType);

    // Resposta de API interna do SuperCDN (POST /api com getPlayer e video_id)
    if (contentType.includes('application/json') || isApiRoute) {
      const json = await response.json();
      if (json && json.data && json.data.video_url) {
        try {
          const rawUrl = Buffer.from(json.data.video_url, 'base64').toString('utf-8');
          if (rawUrl.includes('vaiquecol.com')) {
            const proxiedUrl = `/api-plenoflu/proxy-vaiquecol?url=${encodeURIComponent(rawUrl)}`;
            json.data.video_url = Buffer.from(proxiedUrl).toString('base64');
          }
        } catch (_) {}
      }
      return res.status(response.status).json(json);
    }

    let html = await response.text();

    // Desativa detector de devtools
    html = html.replace(/devtoolsDetector/g, 'noopDevtools');
    html = html.replace(/var HOME_URL\s*=\s*['"]https:\/\/plenoflu\.com['"]/g, 'var HOME_URL = "/api-plenoflu"');

    // Resolução direta do player no servidor (Aceleração máxima sem iframes aninhados)
    const matchItem = html.match(/class="player_select_item"\s+data-id="(\d+)"/) || html.match(/data-id="(\d+)"/);
    if (matchItem && matchItem[1]) {
      try {
        const apiRes = await fetch('https://plenoflu.com/api', {
          method: 'POST',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://plenoflu.com/',
            'Origin': 'https://plenoflu.com',
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: `action=getPlayer&video_id=${matchItem[1]}`
        });
        const apiJson = await apiRes.json();
        if (apiJson && apiJson.data && apiJson.data.video_url) {
          const rawVideoUrl = Buffer.from(apiJson.data.video_url, 'base64').toString('utf-8');

          if (rawVideoUrl.includes('vaiquecol.com')) {
            // Busca o HTML real do player no servidor e o serve diretamente (zero delays e zero iframes extras)
            const vaiqRes = await fetch(rawVideoUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Referer': 'https://plenoflu.com/',
                'Origin': 'https://plenoflu.com'
              }
            });
            let directHtml = await vaiqRes.text();
            directHtml = cleanAndEnhancePlayerHtml(directHtml);

            // Salva no cache por 30 minutos
            playerCache.set(cacheKey, { contentType: 'text/html; charset=utf-8', data: directHtml });
            setTimeout(() => playerCache.delete(cacheKey), 30 * 60 * 1000);

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.status(200).send(directHtml);
          } else {
            // Outro player embed direto
            const cleanEmbedPage = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Canal 1 - SuperCDN Plenoflu</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    html, body { width:100%; height:100%; overflow:hidden; background:#000; }
    iframe { width:100%; height:100%; border:0; display:block; }
  </style>
</head>
<body>
  <iframe src="${rawVideoUrl}" width="100%" height="100%" scrolling="no" frameborder="0" allowfullscreen allow="autoplay; encrypted-media; fullscreen; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin"></iframe>
</body>
</html>`;
            playerCache.set(cacheKey, { contentType: 'text/html; charset=utf-8', data: cleanEmbedPage });
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.status(200).send(cleanEmbedPage);
          }
        }
      } catch (resolveErr) {
        // Fallback continua abaixo
      }
    }

    // Fallback para Séries com injeção de CSS restritivo e auto-play instantâneo
    const fallbackStyles = `
    <style>
      .players_select_container,
      .player_select_header,
      .select_languages,
      .languages_selector,
      .select_language,
      .players_select,
      .player_select_item,
      .player_bg,
      .player_bg_container,
      .changeOptions,
      .embedder_info,
      .without_players_warning {
        display: none !important;
        opacity: 0 !important;
        visibility: hidden !important;
        pointer-events: none !important;
        position: absolute !important;
        top: -9999px !important;
        left: -9999px !important;
        width: 0 !important;
        height: 0 !important;
      }
      .player_container {
        position: fixed !important;
        inset: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        background: #000 !important;
        z-index: 999999 !important;
        display: block !important;
      }
      .player_container .infra,
      .player_container .infra iframe {
        width: 100% !important;
        height: 100% !important;
        border: 0 !important;
        display: block !important;
      }
    </style>
    `;

    const autoPlayScript = `
    <script>
      (function() {
        var clicked = false;
        function triggerAutoPlay() {
          if (clicked) return true;
          var el = document.querySelector('.player_select_item');
          if (el && typeof $ !== 'undefined') {
            clicked = true;
            $(el).trigger('click');
            return true;
          }
          return false;
        }
        triggerAutoPlay();
        if (typeof MutationObserver !== 'undefined') {
          var observer = new MutationObserver(function() {
            if (triggerAutoPlay()) {
              observer.disconnect();
            }
          });
          observer.observe(document.documentElement, { childList: true, subtree: true });
        }
        var pollInterval = setInterval(function() {
          if (triggerAutoPlay()) {
            clearInterval(pollInterval);
          }
        }, 10);
        setTimeout(function() { clearInterval(pollInterval); }, 6000);
      })();
    </script>
    `;

    if (html.includes('</head>')) {
      html = html.replace('</head>', `${fallbackStyles}</head>`);
    } else {
      html = fallbackStyles + html;
    }

    if (html.includes('</body>')) {
      html = html.replace('</body>', `${autoPlayScript}</body>`);
    } else {
      html = html + autoPlayScript;
    }

    return res.status(200).send(html);
  } catch (err) {
    return res.status(500).send(`Proxy Error: ${err.message}`);
  }
}

// Limpeza profunda de anúncios, bloqueio de popups e aceleração do player vaiquecol
function cleanAndEnhancePlayerHtml(rawHtml) {
  let cleaned = rawHtml;

  // 1. Desativa popups e abas invasivas
  const antiAdScript = `
  <script>
    (function() {
      // Bloqueio rigoroso de redirecionamentos e pop-ups forçados
      window.open = function() { return null; };
      window.alert = function() { return null; };
      
      // Auto-início do carregamento sem aguardar cliques redundantes
      document.addEventListener('DOMContentLoaded', function() {
        var playBtn = document.querySelector('.play-button-outer');
        if (playBtn) {
          playBtn.style.display = 'none';
          if (typeof fireload === 'function') {
            try { fireload(); } catch(_) {}
          }
        }
      });
    })();
  </script>
  `;

  // 2. CSS para remover qualquer banner de propaganda, contadores ou sobreposições de clique
  const antiAdCss = `
  <style>
    /* Ocultação de camadas de propaganda e interceptores invisíveis */
    .pppx,
    .rek,
    .rek_close,
    .rek_counter,
    .dropdown,
    #QualityText {
      display: none !important;
      opacity: 0 !important;
      visibility: hidden !important;
      pointer-events: none !important;
      width: 0 !important;
      height: 0 !important;
    }

    /* Player ocupando 100% da tela */
    html, body {
      width: 100% !important;
      height: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
      overflow: hidden !important;
      background: #000 !important;
    }
    #player, #playerbase, #playerjs {
      position: fixed !important;
      inset: 0 !important;
      width: 100% !important;
      height: 100% !important;
      z-index: 10 !important;
    }
  </style>
  `;

  // 3. Roteia chamadas de /player/ para o proxy com referer correto
  cleaned = cleaned.replace(/['"]\/player\/index\.php/g, '"/player/index.php');

  if (cleaned.includes('</head>')) {
    cleaned = cleaned.replace('</head>', `${antiAdCss}${antiAdScript}</head>`);
  } else {
    cleaned = antiAdCss + antiAdScript + cleaned;
  }

  return cleaned;
}
