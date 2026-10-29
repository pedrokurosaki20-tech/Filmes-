export const config = {
  api: {
    bodyParser: false,
  },
};

// Utilitário para ler o stream bruto da requisição no ambiente Vercel
async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  // Configuração global de CORS permissivo
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.removeHeader('X-Frame-Options');
  res.removeHeader('Content-Security-Policy');
  res.removeHeader('Content-Security-Policy-Report-Only');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const queryPath = req.query.path || req.query.url || '';
  const method = req.method;

  let targetUrl = 'https://plenoflu.com';
  if (queryPath) {
    targetUrl += queryPath.startsWith('/') ? queryPath : '/' + queryPath;
  }

  // Identifica rota da API interna da Plenoflu
  const isApiRoute = queryPath === 'api' || queryPath === '/api' || (req.url && req.url.includes('path=api'));
  if (isApiRoute) {
    targetUrl = 'https://plenoflu.com/api';
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
      const rawBody = await getRawBody(req);
      fetchOptions.body = rawBody;
    }

    const response = await fetch(targetUrl, fetchOptions);
    const contentType = response.headers.get('content-type') || 'text/html';

    res.setHeader('Content-Type', contentType);

    // Resposta de API (JSON com video_url)
    if (contentType.includes('application/json') || isApiRoute) {
      try {
        const json = await response.json();

        // VALIDAÇÃO E RECUPERAÇÃO DE CANAL:
        // Se a Plenoflu retornar o provedor 'vaiquecol.com', sabemos que este servidor
        // está retornando HTTP 404 (fora do ar). Substituímos pelo link estável SuperFlix.
        if (json && json.data && json.data.video_url) {
          try {
            let decoded = Buffer.from(json.data.video_url, 'base64').toString('utf-8');
            if (decoded.includes('vaiquecol.com')) {
              const imdbMatch = decoded.match(/tt\d+/);
              if (imdbMatch) {
                const imdbId = imdbMatch[0];
                const fixedUrl = `https://superflixapi.fun/filme/${imdbId}#noEpList`;
                json.data.video_url = Buffer.from(fixedUrl).toString('base64');
              }
            }
          } catch (e) {}
        }

        return res.status(response.status).json(json);
      } catch (jsonErr) {
        const rawText = await response.text();
        return res.status(response.status).send(rawText);
      }
    }

    let html = await response.text();

    // 1. Remove qualquer bloqueio de devtools
    html = html.replace(/devtoolsDetector/g, 'noopDevtools');

    // 2. Aponta as chamadas de API do player diretamente para o endpoint de proxy
    html = html.replace(/var HOME_URL\s*=\s*['"]https:\/\/plenoflu\.com['"]/g, 'var HOME_URL = "/api-plenoflu"');

    // 3. Injeção de CSS e JS para garantir transição imediata do canal e reprodução do filme
    const enhancedInjections = `
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
        z-index: 100 !important;
      }
    </style>
    <script>
      $(document).ready(function() {
        // Intercepta e garante a execução do clique nos canais da Plenoflu
        $(document).off('click', '.player_select_item').on('click', '.player_select_item', function(e) {
          e.preventDefault();
          e.stopPropagation();

          var video_id = $(this).data('id');
          var currentPath = window.location.pathname;
          var imdbMatch = currentPath.match(/tt\\d+/);
          var imdb = imdbMatch ? imdbMatch[0] : '';
          var isTv = currentPath.includes('tvshow') || currentPath.includes('tv');

          // Exibe o loader
          $('.player_loading').remove();
          $('body').append('<div class="player_loading" style="z-index:999;"><i class="ri-loader-5-line"></i></div>');

          function executarPlayer(streamUrl) {
            $('.player_loading').remove();
            $('.players_select_container').addClass('hidden');
            $('.player_container').addClass('visible');
            $('.changeOptions').removeClass('hidden');
            $('.player_container .infra').html(
              '<iframe src="' + streamUrl + '" width="100%" height="100%" scrolling="no" frameborder="0" allowfullscreen="" webkitallowfullscreen="" mozallowfullscreen="" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" referrerpolicy="no-referrer" style="width:100%;height:100%;border:0;"></iframe>'
            );
          }

          var fallbackUrl = isTv 
            ? 'https://superflixapi.fun/serie/' + imdb + '/1/1'
            : 'https://superflixapi.fun/filme/' + imdb + '#noEpList';

          // Executa requisição para obter a URL real
          $.ajax({
            url: '/api-plenoflu/api',
            method: 'POST',
            data: { action: 'getPlayer', video_id: video_id },
            timeout: 3500,
            success: function(res) {
              try {
                if (res && res.data && res.data.video_url) {
                  var decoded = atob(res.data.video_url);
                  if (decoded && !decoded.includes('vaiquecol.com')) {
                    executarPlayer(decoded);
                    return;
                  }
                }
              } catch(err) {
                console.warn('[Plenoflu] Erro ao decodificar:', err);
              }
              executarPlayer(fallbackUrl);
            },
            error: function(err) {
              console.warn('[Plenoflu] API indisponível, iniciando stream alternativo:', err);
              executarPlayer(fallbackUrl);
            }
          });
        });

        // Botão Voltar aos Canais
        $(document).on('click', '.changeOptions', function() {
          $('.player_container').removeClass('visible');
          $('.players_select_container').removeClass('hidden');
          $('.player_container .infra').html('');
        });
      });
    </script>
    `;

    if (html.includes('</body>')) {
      html = html.replace('</body>', `${enhancedInjections}</body>`);
    } else {
      html += enhancedInjections;
    }

    return res.status(200).send(html);
  } catch (err) {
    return res.status(500).send(`Proxy Error: ${err.message}`);
  }
}
