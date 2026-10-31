export const config = {
  api: {
    bodyParser: false,
  },
};

// Cache em memória para aceleração instantânea (0ms)
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
  // Headers globais de permissão, CORS e remoção de restrições de iframe
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.removeHeader('X-Frame-Options');
  res.removeHeader('Content-Security-Policy');
  res.removeHeader('Content-Security-Policy-Report-Only');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Extrai query string preservada sem o parâmetro interno 'path'
  const urlObj = new URL(req.url, 'http://localhost');
  const pathParam = urlObj.searchParams.get('path') || '';
  urlObj.searchParams.delete('path');
  const queryStr = urlObj.searchParams.toString();

  const queryPath = (pathParam || req.query.path || '').toString();
  const method = req.method;

  // 1. ROTEAMENTO DE MANIFESTO HLS (/player/m3u8?url=...)
  if (queryPath === 'player/m3u8' || queryPath === 'm3u8' || req.url.includes('/player/m3u8')) {
    const rawTargetUrl = urlObj.searchParams.get('url') || req.query.url;
    if (!rawTargetUrl) {
      return res.status(400).send('Missing url param for m3u8');
    }
    const targetUrl = decodeURIComponent(rawTargetUrl);
    try {
      const mRes = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Referer': 'https://vaiquecol.com/',
          'Origin': 'https://vaiquecol.com'
        }
      });
      let m3u8Text = await mRes.text();

      // Reescreve URLs internas do manifesto
      const rewrittenM3u8 = m3u8Text.replace(/(https:\/\/[^\s"\r\n]+)/g, (matchedUrl) => {
        if (matchedUrl.includes('.m3u8') || matchedUrl.includes('/m3/') || matchedUrl.includes('/hls/') || matchedUrl.includes('master.txt')) {
          return `/player/m3u8?url=${encodeURIComponent(matchedUrl)}`;
        }
        return `/player/seg?url=${encodeURIComponent(matchedUrl)}`;
      });

      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      return res.status(200).send(rewrittenM3u8);
    } catch (mErr) {
      return res.status(500).send(`M3U8 Proxy Error: ${mErr.message}`);
    }
  }

  // 2. ROTEAMENTO DE SEGMENTOS DE VÍDEO E ÁUDIO TS (/player/seg?url=...)
  if (queryPath === 'player/seg' || queryPath === 'seg' || req.url.includes('/player/seg')) {
    const rawTargetUrl = urlObj.searchParams.get('url') || req.query.url;
    if (!rawTargetUrl) {
      return res.status(400).send('Missing url param for segment');
    }
    const targetUrl = decodeURIComponent(rawTargetUrl);
    try {
      const sRes = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Referer': 'https://vaiquecol.com/'
        }
      });
      let contentType = sRes.headers.get('content-type') || 'video/mp2t';
      if (targetUrl.includes('/Video/') || targetUrl.includes('/480p') || targetUrl.includes('/720p') || targetUrl.includes('/1080p') || targetUrl.endsWith('.ts') || targetUrl.endsWith('.html') || targetUrl.endsWith('.js')) {
        contentType = 'video/mp2t';
      } else if (targetUrl.includes('subtitle') || targetUrl.endsWith('.vtt')) {
        contentType = 'text/vtt; charset=utf-8';
      } else if (targetUrl.includes('/Audio/')) {
        contentType = 'audio/mp4';
      }
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      const buffer = Buffer.from(await sRes.arrayBuffer());
      return res.status(200).send(buffer);
    } catch (sErr) {
      return res.status(500).send(`Segment Proxy Error: ${sErr.message}`);
    }
  }

  // 3. ROTEAMENTO DE CHAMADAS INTERNAS DO PLAYER (/player/index.php e assets)
  if (queryPath.startsWith('player/') || queryPath === 'player' || req.url.includes('/player/')) {
    const playerSubPath = queryPath.replace(/^player\/?/, '');
    const playerTarget = `https://vaiquecol.com/player/${playerSubPath}${queryStr ? '?' + queryStr : ''}`;
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

      // Se for a resposta de vídeo do player, reescreve as fontes para nosso proxy HLS (evita CORS e Erro 233011)
      if (playerSubPath.includes('index.php') && (queryStr.includes('getVideo') || (req.url && req.url.includes('getVideo')))) {
        try {
          const json = await pRes.json();
          if (json && (json.videoSource || json.securedLink)) {
            if (json.videoSource) {
              json.videoSource = `/player/m3u8?url=${encodeURIComponent(json.videoSource)}`;
            }
            if (json.securedLink) {
              json.securedLink = `/player/m3u8?url=${encodeURIComponent(json.securedLink)}`;
            }
          }
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          return res.status(pRes.status).json(json);
        } catch (_) {}
      }

      res.setHeader('Content-Type', pContentType);
      const buffer = Buffer.from(await pRes.arrayBuffer());
      return res.status(pRes.status).send(buffer);
    } catch (pErr) {
      return res.status(500).send(`Player API Error: ${pErr.message}`);
    }
  }

  // 4. ROTEAMENTO DE PÁGINAS PROXIED DO VAIQUECOL
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

  // 5. ROTEAMENTO PRINCIPAL DO PLENOFLU (SUPERCDN OFICIAL)
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

    // Desativa detector de devtools e ajusta referências
    html = html.replace(/devtoolsDetector/g, 'noopDevtools');
    html = html.replace(/var HOME_URL\s*=\s*['"]https:\/\/plenoflu\.com['"]/g, 'var HOME_URL = "/api-plenoflu"');

    // Se o HTML já for o player direto do vaiquecol / pobre play
    if (html.includes('vaiquecol.com') || html.includes('FirePlayer')) {
      html = cleanAndEnhancePlayerHtml(html);
      playerCache.set(cacheKey, { contentType: 'text/html; charset=utf-8', data: html });
      setTimeout(() => playerCache.delete(cacheKey), 30 * 60 * 1000);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(html);
    }

    // Resolução direta do player no servidor (caso haja menu .player_select_item)
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
            const vaiqRes = await fetch(rawVideoUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Referer': 'https://plenoflu.com/',
                'Origin': 'https://plenoflu.com'
              }
            });
            let directHtml = await vaiqRes.text();
            directHtml = cleanAndEnhancePlayerHtml(directHtml);

            playerCache.set(cacheKey, { contentType: 'text/html; charset=utf-8', data: directHtml });
            setTimeout(() => playerCache.delete(cacheKey), 30 * 60 * 1000);

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.status(200).send(directHtml);
          } else {
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
        // Fallback continua
      }
    }

    // Fallback com estilos e auto-play
    html = cleanAndEnhancePlayerHtml(html);
    return res.status(200).send(html);
  } catch (err) {
    return res.status(500).send(`Proxy Error: ${err.message}`);
  }
}

// Limpeza profunda de anúncios, bloqueio de popups e auto-start do player
function cleanAndEnhancePlayerHtml(rawHtml) {
  let cleaned = rawHtml;

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

      // Monitor de erros do JWPlayer para comunicação instantânea com o app
      window.addEventListener('load', function() {
        var checkJwInterval = setInterval(function() {
          if (typeof jwplayer === 'function') {
            try {
              var p = jwplayer('player');
              if (p && typeof p.on === 'function') {
                clearInterval(checkJwInterval);
                p.on('error', function(e) {
                  console.warn('[Player JW Error]', e);
                  try {
                    window.parent.postMessage({ type: 'PLAYER_STREAM_ERROR', message: e.message || 'Erro no player' }, '*');
                  } catch(_) {}
                });
                p.on('setupError', function(e) {
                  console.warn('[Player Setup Error]', e);
                  try {
                    window.parent.postMessage({ type: 'PLAYER_STREAM_ERROR', message: e.message || 'Erro de setup' }, '*');
                  } catch(_) {}
                });
              }
            } catch(_) {}
          }
        }, 300);
        setTimeout(function() { clearInterval(checkJwInterval); }, 8000);
      });
    })();
  </script>
  `;

  const antiAdCss = `
  <style>
    /* Ocultação total de camadas de propaganda e interceptores invisíveis */
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
      width: 0 !important;
      height: 0 !important;
    }

    /* Player ocupando 100% da viewport */
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

  // Roteia chamadas de /player/index.php para o proxy
  cleaned = cleaned.replace(/['"]\/player\/index\.php/g, '"/player/index.php');

  if (cleaned.includes('</head>')) {
    cleaned = cleaned.replace('</head>', `${antiAdCss}${antiAdScript}</head>`);
  } else {
    cleaned = antiAdCss + antiAdScript + cleaned;
  }

  return cleaned;
}
