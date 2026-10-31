import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

function plenofluDevPlugin() {
  return {
    name: 'plenoflu-dev-plugin',
    configureServer(server: any) {
      server.middlewares.use('/api-plenoflu', async (req: any, res: any, next: any) => {
        // Headers globais de CORS e remoção de restrições de iframe
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
        const isApi = rawUrl === '/api' || rawUrl.startsWith('/api?') || rawUrl === 'api';
        let targetUrl = 'https://plenoflu.com';
        if (rawUrl.startsWith('/proxy-vaiquecol')) {
          const uParam = new URL(rawUrl, 'http://localhost').searchParams.get('url');
          targetUrl = uParam ? decodeURIComponent(uParam) : 'https://vaiquecol.com';
        } else if (isApi) {
          targetUrl = 'https://plenoflu.com/api';
        } else {
          targetUrl = `https://plenoflu.com${rawUrl}`;
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
                // Canal 1: Mantém o canal oficial do SuperCDN/Plenoflu roteando pelo proxy local para enviar o Referer plenoflu.com
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
          html = html.replace(
            '<iframe allowfullscreen frameborder="0" src="${msg.data.video_url}"></iframe>',
            '<iframe allowfullscreen frameborder="0" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin" src="${msg.data.video_url}" style="width:100%;height:100%;border:0;"></iframe>'
          );

          const styles = `
          <style>
            .player_container.visible {
              top: 0 !important;
              z-index: 99 !important;
              display: block !important;
              width: 100% !important;
              height: 100% !important;
              background: #000 !important;
            }
            .players_select_container.hidden {
              display: none !important;
              top: -100% !important;
            }
            .player_container .infra,
            .player_container .infra iframe {
              width: 100% !important;
              height: 100% !important;
              border: 0 !important;
            }
            .changeOptions {
              background: #14ce008c !important;
              color: #fff !important;
              padding: 8px 16px !important;
              border-radius: 0 0 10px 10px !important;
              font-weight: 700 !important;
              font-size: 13px !important;
              position: absolute !important;
              top: 0 !important;
              left: 50% !important;
              transform: translateX(-50%) !important;
              z-index: 9999 !important;
              cursor: pointer !important;
              transition: opacity .2s ease !important;
            }
            .changeOptions:hover {
              opacity: .8 !important;
            }
          </style>
          `;

          const autoPlayScript = `
          <script>
            $(document).ready(function() {
              setTimeout(function() {
                var firstItem = $('.player_select_item').first();
                if (firstItem.length && !$('.player_container').hasClass('visible')) {
                  firstItem.trigger('click');
                }
              }, 120);
            });
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
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
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


