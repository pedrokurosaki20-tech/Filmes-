import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

// Cache em memória para aceleração instantânea de títulos no Canal 1 (Plenoflu)
const playerDevCache = new Map<string, { contentType: string; data: string }>();

function cleanAndEnhancePlayerHtml(rawHtml: string): string {
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

  // Roteia chamadas relativas de /player/index.php para o proxy
  cleaned = cleaned.replace(/['"]\/player\/index\.php/g, '"/player/index.php');

  if (cleaned.includes('</head>')) {
    cleaned = cleaned.replace('</head>', `${antiAdCss}${antiAdScript}</head>`);
  } else {
    cleaned = antiAdCss + antiAdScript + cleaned;
  }

  return cleaned;
}

function plenofluDevPlugin() {
  return {
    name: 'plenoflu-dev-plugin',
    configureServer(server: any) {
      // Middleware dedicado para rotear requisições internas do player (/player/index.php e assets)
      server.middlewares.use('/player', async (req: any, res: any) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');
        res.removeHeader('X-Frame-Options');
        res.removeHeader('Content-Security-Policy');

        if (req.method === 'OPTIONS') {
          res.statusCode = 200;
          return res.end();
        }

        const rawUrl = req.url || '';
        const targetUrl = `https://vaiquecol.com/player${rawUrl}`;

        try {
          const fetchHeaders: Record<string, string> = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Referer': 'https://vaiquecol.com/',
            'Origin': 'https://vaiquecol.com',
            'X-Requested-With': 'XMLHttpRequest',
            'Accept': '*/*'
          };

          const fetchOptions: any = {
            method: req.method,
            headers: fetchHeaders
          };

          if (req.method === 'POST') {
            fetchHeaders['Content-Type'] = req.headers['content-type'] || 'application/x-www-form-urlencoded; charset=UTF-8';
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
              chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
            }
            fetchOptions.body = Buffer.concat(chunks);
          }

          const response = await fetch(targetUrl, fetchOptions);
          const contentType = response.headers.get('content-type') || 'application/json';

          res.writeHead(response.status, {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*'
          });
          const buffer = Buffer.from(await response.arrayBuffer());
          return res.end(buffer);
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          return res.end(`Player Proxy Error: ${err.message}`);
        }
      });

      // Middleware principal de transmissão SuperCDN / Plenoflu
      server.middlewares.use('/api-plenoflu', async (req: any, res: any) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');
        res.removeHeader('X-Frame-Options');
        res.removeHeader('Content-Security-Policy');
        res.removeHeader('Content-Security-Policy-Report-Only');

        if (req.method === 'OPTIONS') {
          res.statusCode = 200;
          return res.end();
        }

        const rawUrl = req.url || '';

        // Roteamento interno se vier por /api-plenoflu/player/...
        if (rawUrl.startsWith('/player')) {
          const sub = rawUrl.replace(/^\/player\/?/, '');
          const playerTarget = `https://vaiquecol.com/player/${sub}`;
          try {
            const fetchHeaders: Record<string, string> = {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
              'Referer': 'https://vaiquecol.com/',
              'Origin': 'https://vaiquecol.com',
              'X-Requested-With': 'XMLHttpRequest',
              'Accept': '*/*'
            };
            const fetchOptions: any = { method: req.method, headers: fetchHeaders };
            if (req.method === 'POST') {
              fetchHeaders['Content-Type'] = req.headers['content-type'] || 'application/x-www-form-urlencoded; charset=UTF-8';
              const chunks: Buffer[] = [];
              for await (const chunk of req) {
                chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
              }
              fetchOptions.body = Buffer.concat(chunks);
            }
            const pRes = await fetch(playerTarget, fetchOptions);
            const pContentType = pRes.headers.get('content-type') || 'application/json';
            res.writeHead(pRes.status, { 'Content-Type': pContentType, 'Access-Control-Allow-Origin': '*' });
            const buffer = Buffer.from(await pRes.arrayBuffer());
            return res.end(buffer);
          } catch (pErr: any) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            return res.end(`Player API Error: ${pErr.message}`);
          }
        }

        // Roteamento de páginas proxied do vaiquecol
        if (rawUrl.startsWith('/proxy-vaiquecol')) {
          const uParam = new URL(rawUrl, 'http://localhost').searchParams.get('url');
          const targetUrl = uParam ? decodeURIComponent(uParam) : 'https://vaiquecol.com';
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
            res.writeHead(200, {
              'Content-Type': 'text/html; charset=utf-8',
              'Access-Control-Allow-Origin': '*'
            });
            return res.end(vHtml);
          } catch (vErr: any) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            return res.end(`Vaiquecol Proxy Error: ${vErr.message}`);
          }
        }

        const isApi = rawUrl === '/api' || rawUrl.startsWith('/api?') || rawUrl === 'api';
        let targetUrl = 'https://plenoflu.com';
        if (isApi) {
          targetUrl = 'https://plenoflu.com/api';
        } else {
          targetUrl = `https://plenoflu.com${rawUrl}`;
        }

        const cacheKey = `${req.method}_${targetUrl}`;
        if (req.method === 'GET' && playerDevCache.has(cacheKey)) {
          const cached = playerDevCache.get(cacheKey)!;
          res.writeHead(200, {
            'Content-Type': cached.contentType,
            'Access-Control-Allow-Origin': '*'
          });
          return res.end(cached.data);
        }

        try {
          const fetchHeaders: Record<string, string> = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Referer': 'https://plenoflu.com/',
            'Origin': 'https://plenoflu.com',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8'
          };

          const fetchOptions: any = {
            method: req.method,
            headers: fetchHeaders
          };

          if (req.method === 'POST') {
            fetchHeaders['Content-Type'] = req.headers['content-type'] || 'application/x-www-form-urlencoded';
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
              chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
            }
            fetchOptions.body = Buffer.concat(chunks);
          }

          const response = await fetch(targetUrl, fetchOptions);
          const contentType = response.headers.get('content-type') || 'text/html';

          if (contentType.includes('application/json') || isApi) {
            const json: any = await response.json();
            if (json && json.data && json.data.video_url) {
              try {
                const rawVideoUrl = Buffer.from(json.data.video_url, 'base64').toString('utf-8');
                if (rawVideoUrl.includes('vaiquecol.com')) {
                  const proxiedUrl = `/api-plenoflu/proxy-vaiquecol?url=${encodeURIComponent(rawVideoUrl)}`;
                  json.data.video_url = Buffer.from(proxiedUrl).toString('base64');
                }
              } catch (_) {}
            }
            res.writeHead(response.status, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            });
            return res.end(JSON.stringify(json));
          }

          let html = await response.text();
          html = html.replace(/devtoolsDetector/g, 'noopDevtools');
          html = html.replace(/var HOME_URL\s*=\s*['"]https:\/\/plenoflu\.com['"]/g, 'var HOME_URL = "/api-plenoflu"');

          // Aceleração máxima: Tenta resolver o player direto do Plenoflu no servidor (zero delay no navegador)
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
              const apiJson: any = await apiRes.json();
              if (apiJson && apiJson.data && apiJson.data.video_url) {
                const rawVideoUrl = Buffer.from(apiJson.data.video_url, 'base64').toString('utf-8');

                if (rawVideoUrl.includes('vaiquecol.com')) {
                  // Busca o HTML do player no servidor e entrega diretamente (zero iframes aninhados e carregamento instantâneo)
                  const vaiqRes = await fetch(rawVideoUrl, {
                    headers: {
                      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                      'Referer': 'https://plenoflu.com/',
                      'Origin': 'https://plenoflu.com'
                    }
                  });
                  let directHtml = await vaiqRes.text();
                  directHtml = cleanAndEnhancePlayerHtml(directHtml);

                  // Salva em cache
                  playerDevCache.set(cacheKey, { contentType: 'text/html; charset=utf-8', data: directHtml });
                  setTimeout(() => playerDevCache.delete(cacheKey), 30 * 60 * 1000);

                  res.writeHead(200, {
                    'Content-Type': 'text/html; charset=utf-8',
                    'Access-Control-Allow-Origin': '*'
                  });
                  return res.end(directHtml);
                } else {
                  const directPlayerPage = `<!DOCTYPE html>
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
                  playerDevCache.set(cacheKey, { contentType: 'text/html; charset=utf-8', data: directPlayerPage });
                  res.writeHead(200, {
                    'Content-Type': 'text/html; charset=utf-8',
                    'Access-Control-Allow-Origin': '*'
                  });
                  return res.end(directPlayerPage);
                }
              }
            } catch (resolveErr) {
              // Continua com o fallback
            }
          }

          // Fallback / Séries: Oculta totalmente qualquer cabeçalho, capa e menu do Plenoflu desde o 1º frame
          const styles = `
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
            html = html.replace('</head>', `${styles}</head>`);
          } else {
            html = styles + html;
          }

          if (html.includes('</body>')) {
            html = html.replace('</body>', `${autoPlayScript}</body>`);
          } else {
            html = html + autoPlayScript;
          }

          res.writeHead(response.status, {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*'
          });
          return res.end(html);
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          return res.end(`Dev Proxy Error: ${err.message}`);
        }
      });
    }
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), plenofluDevPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      proxy: {
        '/api-torbox': {
          target: 'https://api.torbox.app',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api-torbox/, ''),
        },
        '/api-yts': {
          target: 'https://movies-api.accel.li',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api-yts/, ''),
        },
        '/api-apibay': {
          target: 'https://apibay.org',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api-apibay/, ''),
        },
        '/api-torrentio': {
          target: 'https://torrentio.strem.fun',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api-torrentio/, ''),
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          },
        },
        '/api-brazuca': {
          target: 'https://94c8cb9f702d-brazuca-torrents.baby-beamup.club',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api-brazuca/, ''),
        },
      },
    },
  };
});
